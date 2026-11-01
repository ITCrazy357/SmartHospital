const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { loadEnvFile, databaseConfig, pgToolEnvironment, defaultEnvPath } = require('./database-config.cjs');

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--output') throw new Error('Usage: node scripts/database-backup.cjs --output <new-file.dump>');
  loadEnvFile(defaultEnvPath);
  const env = pgToolEnvironment(databaseConfig());
  const output = path.resolve(args[1]);
  // wx preserves an existing backup even if the operator repeats a command.
  const descriptor = fs.openSync(output, 'wx', 0o600);
  let completed = false;
  try {
    const child = spawn(process.env.PG_DUMP_BIN || 'pg_dump', ['--format=custom', '--no-owner', '--no-acl'], { env, stdio: ['ignore', descriptor, 'pipe'], windowsHide: true });
    child.stderr.resume(); // provider/tool errors may include connection details
    await new Promise((resolve, reject) => {
      child.once('error', () => reject(new Error('Cannot run pg_dump. Install PostgreSQL client tools and check PATH.')));
      child.once('close', code => code === 0 ? resolve() : reject(new Error('pg_dump failed. No valid backup was created. Check access/connectivity privately.')));
    });
    completed = true;
    console.log(`Backup created: ${output}. Verify by restoring into a separate empty database.`);
  } finally {
    fs.closeSync(descriptor);
    if (!completed) fs.unlinkSync(output);
  }
}

if (require.main === module) main().catch(error => { console.error(error.code === 'EEXIST' ? 'Backup file already exists; choose a new filename.' : error.message); process.exitCode = 1; });
