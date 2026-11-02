import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { validateDeploymentEnv } from './deployment-env.mjs';

const clientDirectory = fileURLToPath(new URL('../', import.meta.url));
const deployment = process.argv.includes('--deployment') || process.env.VERCEL === '1';

if (deployment) {
  try {
    validateDeploymentEnv(loadEnv('production', clientDirectory, 'VITE_'));
  } catch (error) {
    console.error(`Deployment configuration: ${error.message}`);
    process.exit(1);
  }
}

for (const [entry, args] of [
  ['typescript/bin/tsc', ['--noEmit']],
  ['vite/bin/vite.js', ['build']],
]) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(`../node_modules/${entry}`, import.meta.url)), ...args], {
    cwd: clientDirectory,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
