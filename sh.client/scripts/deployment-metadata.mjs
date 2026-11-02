import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function deploymentRevision(env) {
  const revision = env.VERCEL_GIT_COMMIT_SHA ?? env.GITHUB_SHA ?? env.APP_REVISION;
  return typeof revision === 'string' && revision.length === 40 && /^[0-9a-f]{40}$/i.test(revision)
    ? revision.toLowerCase() : null;
}

export function writeDeploymentMetadata(outputDirectory, env) {
  writeFileSync(join(outputDirectory, 'deployment.json'), JSON.stringify({ revision: deploymentRevision(env) }) + '\n');
}
