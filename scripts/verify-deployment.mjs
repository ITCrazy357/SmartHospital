import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_API = 'https://smart-hospital-api-6y6v.onrender.com';
const DEFAULT_WEB = 'https://smart-hospital-rouge.vercel.app';
const isRevision = value => typeof value === 'string' && value.length === 40 && /^[a-f0-9]+$/i.test(value);

export function deploymentUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Production URL must be an absolute HTTPS URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      ['localhost', '[::1]', '0.0.0.0'].includes(url.hostname) ||
      url.hostname.endsWith('.localhost') || /^127\./.test(url.hostname)) {
    throw new Error('Production URL must use public HTTPS without credentials, query or fragment.');
  }
  return url.href.replace(/\/$/, '');
}

async function readBody(response, maximumBytes = 131072) {
  if (!response.body) throw new Error('empty_body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0, result = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) throw new Error('body_too_large');
      result += decoder.decode(value, { stream: true });
    }
    return result + decoder.decode();
  } finally { await reader.cancel().catch(() => {}); }
}

// Secrets are sent only to the fixed GitHub API origin. Public probes never
// carry an Authorization header, follow redirects or print response bodies.
async function githubJson(path, { fetchImpl, token, requestMs }) {
  let response;
  try {
    response = await fetchImpl(`https://api.github.com${path}`, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28' },
      redirect: 'error', signal: AbortSignal.timeout(requestMs),
    });
    if (!response.ok) throw new Error();
    return JSON.parse(await readBody(response, 2097152));
  } catch {
    throw new Error('Cannot verify GitHub CI/main metadata; production verification stopped.');
  }
}

async function probe(url, kind, expected, { fetchImpl, requestMs }) {
  try {
    const response = await fetchImpl(url, { redirect: 'error', cache: 'no-store',
      headers: { Accept: kind === 'html' ? 'text/html' : 'application/json' },
      signal: AbortSignal.timeout(requestMs) });
    if (response.status !== 200) return { ok: false, reason: `HTTP_${response.status}` };
    const body = await readBody(response);
    if (kind === 'html') {
      return /text\/html/i.test(response.headers.get('content-type') || '') && /id=["']root["']/.test(body)
        ? { ok: true, reason: 'ok' } : { ok: false, reason: 'invalid_html' };
    }
    if (!/application\/json/i.test(response.headers.get('content-type') || '')) return { ok: false, reason: 'not_json' };
    const data = JSON.parse(body);
    if (kind === 'ready') return data?.status === 'ready' ? { ok: true, reason: 'ok' } : { ok: false, reason: 'not_ready' };
    if (!isRevision(data?.revision)) return { ok: false, reason: 'revision_invalid' };
    const revision = data.revision.toLowerCase();
    return { ok: revision === expected, reason: revision === expected ? 'ok' : 'revision_mismatch', revision };
  } catch { return { ok: false, reason: 'request_or_body_failed' }; }
}

export async function verifyDeployment({
  sha, repository, token, apiUrl = DEFAULT_API, webUrl = DEFAULT_WEB,
  timeoutMs = 900000, intervalMs = 15000, requestMs = 10000,
  fetchImpl = fetch, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  log = console.log,
}) {
  if (!isRevision(sha)) throw new Error('Expected revision must be a full Git commit SHA.');
  sha = sha.toLowerCase();
  if (typeof repository !== 'string' || repository !== repository.trim() ||
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
      repository.split('/').some(part => part === '.' || part === '..')) throw new Error('Invalid GitHub repository.');
  if (!token) throw new Error('GITHUB_TOKEN is required to verify CI/main metadata.');
  if (![timeoutMs, intervalMs, requestMs].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('Invalid verification timing.');
  apiUrl = deploymentUrl(apiUrl);
  webUrl = deploymentUrl(webUrl);
  const settings = { fetchImpl, token, requestMs };
  const repoPath = repository.split('/').map(encodeURIComponent).join('/');
  const main = async () => {
    const data = await githubJson(`/repos/${repoPath}/git/ref/heads/main`, settings);
    if (!isRevision(data?.object?.sha)) throw new Error('GitHub main did not return a valid revision.');
    return data.object.sha.toLowerCase();
  };
  const superseded = () => ({ status: 'superseded', revision: sha });
  if (await main() !== sha) return superseded();
  const runs = await githubJson(`/repos/${repoPath}/actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&status=success&per_page=10`, settings);
  const passed = runs?.workflow_runs?.find(run => run.head_sha === sha && run.head_branch === 'main' &&
    run.event === 'push' && run.conclusion === 'success' && run.head_repository?.full_name === repository);
  if (!passed) throw new Error('No successful main push CI run exists for the requested revision.');

  // Native monorepo deployments may skip CI/docs-only commits. Accept a prior
  // revision only after proving ancestry and identical Git source inputs.
  // Cache immutable Git objects/promises, not a mutable main-branch result.
  const roots = new Map(), ancestors = new Map();
  const memo = (cache, key, create) => {
    if (!cache.has(key)) cache.set(key, create());
    return cache.get(key);
  };
  const rootAt = revision => memo(roots, revision, async () => {
    const commit = await githubJson(`/repos/${repoPath}/git/commits/${revision}`, settings);
    if (commit?.sha !== revision || !isRevision(commit?.tree?.sha)) throw new Error('Cannot verify application source identity.');
    const root = await githubJson(`/repos/${repoPath}/git/trees/${commit.tree.sha}`, settings);
    if (root?.sha !== commit.tree.sha || root.truncated !== false || !Array.isArray(root.tree)) throw new Error('Cannot verify application source identity.');
    return root.tree;
  });
  const signature = (entries, component) => {
    const app = entries.find(entry => entry.path === (component === 'backend' ? 'sh.server' : 'sh.client'));
    if (app?.type !== 'tree' || !isRevision(app.sha)) throw new Error('Cannot verify application source identity.');
    if (component === 'backend') return app.sha;
    const config = entries.find(entry => entry.path === 'vercel.json');
    if (config && (config.type !== 'blob' || !isRevision(config.sha))) throw new Error('Cannot verify application source identity.');
    return `${app.sha}:${config?.sha || 'absent'}`;
  };
  const sourceMatch = async (result, component) => {
    if (result.ok) return { ...result, source: 'exact' };
    if (!result.revision) return result;
    const ancestor = await memo(ancestors, result.revision, async () => {
      const comparison = await githubJson(`/repos/${repoPath}/compare/${result.revision}...${sha}?per_page=1`, settings);
      return comparison?.status === 'ahead' && comparison.merge_base_commit?.sha === result.revision;
    });
    if (!ancestor) return result;
    const [expectedRoot, observedRoot] = await Promise.all([rootAt(sha), rootAt(result.revision)]);
    return signature(expectedRoot, component) === signature(observedRoot, component)
      ? { ...result, ok: true, reason: 'source_equivalent', source: 'equivalent' } : result;
  };

  const deadline = now() + timeoutMs;
  let lastState;
  while (now() < deadline) {
    if (await main() !== sha) return superseded();
    let [backendVersion, backendReady, frontendVersion, frontendPage] = await Promise.all([
      probe(`${apiUrl}/health/version`, 'revision', sha, settings),
      probe(`${apiUrl}/health/ready`, 'ready', sha, settings),
      probe(`${webUrl}/deployment.json`, 'revision', sha, settings),
      probe(`${webUrl}/`, 'html', sha, settings),
    ]);
    [backendVersion, frontendVersion] = await Promise.all([
      sourceMatch(backendVersion, 'backend'), sourceMatch(frontendVersion, 'frontend'),
    ]);
    const checks = { backendVersion, backendReady, frontendVersion, frontendPage };
    const state = Object.entries(checks).map(([name, result]) => `${name}=${result.reason}`).join(', ');
    if (state !== lastState) { log(`Production verification: ${state}`); lastState = state; }
    if (Object.values(checks).every(result => result.ok)) {
      // Recheck identity after readiness/page requests, which can overlap a
      // rolling deploy or a production alias change. The actual observed
      // identities must stay stable, including source-equivalent ancestors.
      const stable = await Promise.all([
        probe(`${apiUrl}/health/version`, 'revision', backendVersion.revision, settings),
        probe(`${webUrl}/deployment.json`, 'revision', frontendVersion.revision, settings),
      ]);
      if (await main() !== sha) return superseded();
      if (stable.every(result => result.ok)) return { status: 'verified', revision: sha, ciRunId: passed.id,
        backendRevision: backendVersion.revision, frontendRevision: frontendVersion.revision,
        backendSource: backendVersion.source, frontendSource: frontendVersion.source };
    }
    if (now() >= deadline) break;
    await sleep(Math.min(intervalMs, deadline - now()));
  }
  if (await main() !== sha) return superseded();
  throw new Error('Production verification timed out: the tested revision is not healthy on both providers. Check Render/Vercel deployment logs.');
}

async function main() {
  const { DEPLOY_SHA: sha, GITHUB_REPOSITORY: repository, GITHUB_TOKEN: token,
    PRODUCTION_API_URL: apiUrl, PRODUCTION_WEB_URL: webUrl } = process.env;
  const result = await verifyDeployment({ sha, repository, token, apiUrl: apiUrl || DEFAULT_API, webUrl: webUrl || DEFAULT_WEB });
  const message = result.status === 'verified'
    ? `Verified production source for CI revision ${result.revision}. Backend: ${result.backendRevision} (${result.backendSource}); frontend: ${result.frontendRevision} (${result.frontendSource}). Readiness and page checks passed.`
    : `Superseded revision ${result.revision}: main has advanced; this run does not claim a verified deployment.`;
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    // All public errors are fixed, sanitized messages; no driver/network body.
    console.error(error.message);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      'Production verification failed. Inspect the CD job and provider deployment logs; no rollback or database mutation was attempted.\n');
    process.exitCode = 1;
  });
}
