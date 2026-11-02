const { spawnSync } = require('node:child_process');
const path = require('node:path');

// Opt-in deployment entry point: the ordinary API startup performs no DDL.
// A failed migration must stop this deployment before HTTP/cron workers start.
function startDeployment({
  migrate = () => spawnSync(process.execPath, [path.join(__dirname, 'migrate.cjs')], {
    stdio: 'inherit', env: process.env,
  }),
  start = () => require('../dist/main.js'),
  log = console.error,
  info = console.log,
} = {}) {
  info('[deploy] Running database migrations.');
  const result = migrate();
  if (result.error || result.signal || result.status !== 0) {
    log('Deployment stopped: database migration did not complete. API was not started.');
    return Number.isInteger(result.status) && result.status > 0 ? result.status : 1;
  }
  info('[deploy] Migrations completed; starting API.');
  start();
  return 0;
}

if (require.main === module) process.exitCode = startDeployment();
module.exports = { startDeployment };
