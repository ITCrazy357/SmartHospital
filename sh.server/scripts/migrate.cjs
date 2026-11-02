const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Client } = require('pg');
const { loadEnvFile, databaseConfig, defaultEnvPath } = require('./database-config.cjs');

const MIGRATION_LOCK = 746835201;
const defaultDirectory = path.resolve(__dirname, '..', 'migrations');

async function prepareBaseline(client) {
  // The immutable legacy baseline checks pg_type globally. Prepare its types
  // in the actual target namespace so another application's schema cannot
  // cause it to skip CREATE TYPE and then fail resolving ALTER TYPE.
  const definitions = {
    slot_status: ['available', 'booked', 'on_leave'],
    ad_type: ['banner', 'promo'],
    ad_status: ['draft', 'active', 'paused', 'archived', 'expired'],
    ad_placement: ['home_hero', 'home_below_search', 'doctor_detail', 'dashboard_user'],
  };
  for (const [name, labels] of Object.entries(definitions)) {
    await client.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='${name}' AND typnamespace=current_schema()::regnamespace) THEN
        CREATE TYPE ${name} AS ENUM (${labels.map(label => `'${label}'`).join(',')});
      END IF;
    END $$`);
  }
}

function readMigrations(directory = defaultDirectory) {
  return fs.readdirSync(directory).filter(name => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort().map(name => {
    const sql = fs.readFileSync(path.join(directory, name), 'utf8').replace(/\r\n/g, '\n');
    return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  });
}

async function runMigrations(client, { directory = defaultDirectory, log = console.log } = {}) {
  const files = readMigrations(directory);
  if (!files.length) throw new Error('No versioned SQL migrations found.');
  const lock = await client.query('SELECT pg_try_advisory_lock($1) AS acquired', [MIGRATION_LOCK]);
  if (!lock.rows[0].acquired) throw new Error('Another SmartHospital migration is running. Retry after it finishes.');
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, checksum varchar(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const history = await client.query('SELECT name, checksum FROM schema_migrations ORDER BY name');
    const byName = new Map(files.map(file => [file.name, file]));
    for (const previous of history.rows) {
      const current = byName.get(previous.name);
      if (!current || current.checksum !== previous.checksum) {
        throw new Error(`Applied migration ${previous.name} is missing or has changed. Restore the original file and add a new migration.`);
      }
    }
    const applied = new Set(history.rows.map(row => row.name));
    const latest = history.rows.at(-1)?.name;
    const pending = files.filter(file => !applied.has(file.name));
    if (latest && pending.some(file => file.name < latest)) throw new Error('A migration was inserted before an already applied version. Add a higher version instead.');
    for (const file of pending) {
      await client.query('BEGIN');
      try {
        await client.query("SET LOCAL lock_timeout = '10s'");
        await client.query("SET LOCAL statement_timeout = '120s'");
        if (file.name === '000_baseline.sql') await prepareBaseline(client);
        await client.query(file.sql);
        await client.query('INSERT INTO schema_migrations(name, checksum) VALUES ($1, $2)', [file.name, file.checksum]);
        await client.query('COMMIT');
        log(`Applied ${file.name}`);
      } catch (error) {
        await client.query('ROLLBACK');
        // Do not dump PostgreSQL errors: detail/query can contain patient data.
        const failure = new Error(`Migration ${file.name} failed${error.code ? ` (SQLSTATE ${error.code})` : ''}. Transaction rolled back. Inspect the database privately; do not delete existing clinical data.`);
        failure.code = error.code;
        throw failure;
      }
    }
    log(pending.length ? `Applied ${pending.length} migration(s).` : 'Database is up to date.');
    return pending.map(file => file.name);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]);
  }
}

async function main() {
  loadEnvFile(defaultEnvPath);
  const client = new Client(databaseConfig());
  try {
    await client.connect();
    await runMigrations(client);
  } finally {
    await client.end();
  }
}

if (require.main === module) main().catch(error => {
  const safeMessage = error.message?.startsWith('Migration ') || error.message?.startsWith('Applied migration ') || error.message?.startsWith('Another SmartHospital') || error.message?.startsWith('Set DATABASE_URL') || error.message?.startsWith('A migration was inserted')
    ? error.message : `Database migration failed${error.code ? ` (${error.code})` : ''}. Check connectivity/configuration without publishing credentials.`;
  console.error(safeMessage);
  process.exitCode = 1;
});

module.exports = { readMigrations, runMigrations, prepareBaseline };
