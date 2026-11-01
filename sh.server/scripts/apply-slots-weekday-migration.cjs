// Compatibility entrypoint: migrations are now applied in a single versioned sequence.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
console.warn('Legacy migration alias: applying all pending versioned migrations.');
const result = spawnSync(process.execPath, [path.join(__dirname, 'migrate.cjs')], { stdio: 'inherit', windowsHide: true });
if (result.error) console.error('Cannot start the versioned migration runner.');
process.exitCode = result.status ?? 1;
