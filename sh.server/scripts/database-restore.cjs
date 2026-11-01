const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require('pg');
const { loadEnvFile, databaseConfig, pgToolEnvironment, defaultEnvPath } = require('./database-config.cjs');

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 6 || args[0] !== '--input' || args[2] !== '--target' || args[4] !== '--confirm-restore' || args[3] !== args[5]) {
    throw new Error('Usage: node scripts/database-restore.cjs --input <backup.dump> --target <empty-database> --confirm-restore <same-database>');
  }
  const input = path.resolve(args[1]);
  if (!fs.statSync(input).isFile()) throw new Error('Backup input must be a file.');
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(args[3])) throw new Error('Target database name is invalid.');
  loadEnvFile(defaultEnvPath);
  const config = databaseConfig();
  const env = pgToolEnvironment(config, args[3]);
  const source = pgToolEnvironment(config).PGDATABASE;
  if (source === args[3]) throw new Error('Restore target must differ from the configured application database. Restore to a new database, verify, then switch configuration.');
  let targetConfig = { ...config, database: args[3] };
  if (config.connectionString) {
    const targetUrl = new URL(config.connectionString);
    targetUrl.pathname = `/${args[3]}`;
    targetConfig = { ...config, connectionString: targetUrl.toString() };
  }
  const client = new Client(targetConfig);
  try {
    await client.connect();
    const existing = await client.query("SELECT count(*)::int AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%' AND c.relkind IN ('r','p','v','m','f','S')");
    if (existing.rows[0].count > 0) throw new Error('Restore target is not empty. Existing tables, views and sequences must be preserved; choose a new empty database.');
  } finally {
    await client.end();
  }
  const child = spawn(process.env.PG_RESTORE_BIN || 'pg_restore', ['--exit-on-error', '--single-transaction', '--no-owner', '--no-acl', '--dbname', args[3], input], { env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  child.stderr.resume();
  await new Promise((resolve, reject) => {
    child.once('error', () => reject(new Error('Cannot run pg_restore. Install PostgreSQL client tools and check PATH.')));
    child.once('close', code => code === 0 ? resolve() : reject(new Error('pg_restore failed; restore transaction rolled back. Inspect configuration and backup privately.')));
  });
  console.log('Restore completed in the separate target database. Run schema/readiness checks and UAT before switching the application.');
}

if (require.main === module) main().catch(error => {
  console.error(error.code ? `Database restore failed (${error.code}); no automatic retry or cleanup was performed.` : error.message);
  process.exitCode = 1;
});
