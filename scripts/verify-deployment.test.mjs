import assert from 'node:assert/strict';
import test from 'node:test';
import { deploymentUrl, verifyDeployment } from './verify-deployment.mjs';

const sha = 'a'.repeat(40), old = 'b'.repeat(40), repository = 'fixture/SmartHospital';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function fixture({ mutate, currentMain = () => sha, ci = true } = {}) {
  const calls = [], logs = [];
  let clock = 0;
  const fetchImpl = async (input, options) => {
    const url = new URL(input); calls.push({ url, options });
    const changed = await mutate?.(url, options, calls);
    if (changed) return changed;
    if (url.hostname === 'api.github.com') {
      if (url.pathname.endsWith('/git/ref/heads/main')) return json({ object: { sha: currentMain() } });
      return json({ workflow_runs: ci ? [{ id: 12, head_sha: sha, head_branch: 'main', event: 'push',
        conclusion: 'success', head_repository: { full_name: repository } }] : [] });
    }
    if (url.pathname === '/health/ready') return json({ status: 'ready' });
    if (url.pathname === '/health/version' || url.pathname === '/deployment.json') return json({ revision: sha });
    return new Response('<html><div id="root"></div></html>', { headers: { 'content-type': 'text/html' } });
  };
  return { calls, logs, run: overrides => verifyDeployment({ sha, repository, token: 'fixture-github-token',
    fetchImpl, timeoutMs: 4, intervalMs: 1, now: () => clock,
    sleep: async ms => { clock += ms; }, log: value => logs.push(value), ...overrides }) };
}

test('accepts only public HTTPS targets without embedded secrets', () => {
  assert.equal(deploymentUrl('https://api.example.com/'), 'https://api.example.com');
  for (const value of ['not-a-url', 'http://api.example.com', 'https://user:password@api.example.com',
    'https://api.example.com?secret=private', 'https://api.example.com#private', 'https://localhost', 'https://127.0.0.1', 'https://[::1]']) {
    assert.throws(() => deploymentUrl(value));
  }
});

test('verifies CI and both exact release identities, without sending GitHub credentials to production', async () => {
  const f = fixture();
  assert.deepEqual(await f.run(), { status: 'verified', revision: sha, ciRunId: 12 });
  for (const { url, options } of f.calls) {
    assert.equal(options.redirect, 'error');
    if (url.hostname === 'api.github.com') assert.equal(options.headers.Authorization, 'Bearer fixture-github-token');
    else { assert.equal(options.headers.Authorization, undefined); assert.equal(options.cache, 'no-store'); }
  }
  assert.equal(f.calls.filter(c => c.url.pathname === '/health/version').length, 2);
});

test('refuses production probes when there is no passing main-push CI for that SHA', async () => {
  const f = fixture({ ci: false });
  await assert.rejects(f.run(), /No successful main push CI/);
  assert.equal(f.calls.every(c => c.url.hostname === 'api.github.com'), true);
});

test('ignores fork/PR CI and a passing CI on another revision', async () => {
  for (const changed of [{ event: 'pull_request' }, { head_sha: old },
    { head_repository: { full_name: 'fork/SmartHospital' } }, { head_branch: 'other' }, { conclusion: 'failure' }]) {
    const f = fixture({ mutate: url => url.pathname.endsWith('/ci.yml/runs') ? json({ workflow_runs: [{ id: 1,
      head_sha: sha, event: 'push', head_branch: 'main', conclusion: 'success', head_repository: { full_name: repository }, ...changed }] }) : undefined });
    await assert.rejects(f.run(), /No successful main push CI/);
  }
});

test('does not mistake a healthy older backend/frontend for the tested release', async () => {
  for (const path of ['/health/version', '/deployment.json']) {
    const f = fixture({ mutate: url => url.pathname === path ? json({ revision: old }) : undefined });
    await assert.rejects(f.run(), /timed out/);
    assert.ok(f.logs.some(line => line.includes('revision_mismatch')));
  }
});

test('retries a deployment still starting, then verifies it', async () => {
  let readinessCalls = 0;
  const f = fixture({ mutate: url => url.pathname === '/health/ready' && readinessCalls++ === 0 ? json({ status: 'not_ready' }, 503) : undefined });
  assert.equal((await f.run()).status, 'verified');
  assert.equal(readinessCalls, 2);
});

test('fails closed when release metadata is missing, malformed, oversized or rewritten to SPA HTML', async () => {
  for (const response of [() => json({ revision: null }), () => json({ revision: sha + '\n' }),
    () => new Response('private detail', { status: 404 }),
    () => new Response('x'.repeat(131073)),
    () => new Response('<html><div id="root"></div></html>', { headers: { 'content-type': 'text/html' } })]) {
    const f = fixture({ mutate: url => url.pathname === '/deployment.json' ? response() : undefined });
    await assert.rejects(f.run(), /timed out/);
    assert.equal(JSON.stringify(f.logs).includes('private detail'), false);
  }
});

test('requires actual readiness and the frontend HTML shell', async () => {
  for (const path of ['/health/ready', '/']) {
    const f = fixture({ mutate: url => url.hostname !== 'api.github.com' && url.pathname === path ? json({ status: 'ok' }) : undefined });
    await assert.rejects(f.run(), /timed out/);
  }
});

test('stops obsolete runs before probes or while waiting for deployments', async () => {
  const initial = fixture({ currentMain: () => old });
  assert.equal((await initial.run()).status, 'superseded');
  assert.equal(initial.calls.length, 1);
  let mainCalls = 0;
  const waiting = fixture({ currentMain: () => ++mainCalls < 3 ? sha : old,
    mutate: url => url.pathname === '/health/ready' ? json({}, 503) : undefined });
  assert.equal((await waiting.run()).status, 'superseded');
});

test('does not claim success when an identity changes after readiness was checked', async () => {
  let backendVersions = 0;
  const f = fixture({ mutate: url => url.pathname === '/health/version' && ++backendVersions > 1 ? json({ revision: old }) : undefined });
  await assert.rejects(f.run(), /timed out/);
});

test('marks a successful probe as superseded if main moves before the final result', async () => {
  let mainCalls = 0;
  const f = fixture({ currentMain: () => ++mainCalls < 3 ? sha : old });
  assert.equal((await f.run()).status, 'superseded');
});

test('sanitizes GitHub/network failures and never trusts redirects', async () => {
  const f = fixture({ mutate: () => { throw new Error('https://fixture-token@private.example.invalid'); } });
  await assert.rejects(f.run(), error => /Cannot verify GitHub/.test(error.message) && !error.message.includes('fixture-token'));
});

test('rejects malformed inputs before sending requests', async () => {
  for (const overrides of [{ sha: sha + '\n' }, { sha: 'bad' }, { repository: '../private' },
    { repository: 'fixture/SmartHospital\n' }, { token: '' }, { timeoutMs: 0 }]) {
    const f = fixture();
    await assert.rejects(f.run(overrides));
    assert.equal(f.calls.length, 0);
  }
});
