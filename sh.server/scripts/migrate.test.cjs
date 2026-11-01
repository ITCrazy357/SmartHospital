const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readMigrations, runMigrations } = require('./migrate.cjs');
const { databaseConfig, pgToolEnvironment } = require('./database-config.cjs');

function fixture(files = { '001_first.sql': 'SELECT 1;' }) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'smarthospital-migrate-'));
  for (const [name, sql] of Object.entries(files)) fs.writeFileSync(path.join(directory, name), sql);
  const statements = [];
  const client = { query: async (sql, params) => {
    statements.push({ sql, params });
    if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: true }] };
    return { rows: [] };
  } };
  return { directory, client, statements, cleanup: () => { for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name)); fs.rmdirSync(directory); } };
}

test('migrations are ordered and checksum ignores Windows line endings', () => {
  const f = fixture({ '002_second.sql': 'SELECT 2;\r\n', '001_first.sql': 'SELECT 1;\n', 'README.md': 'skip' });
  try {
    const first = readMigrations(f.directory);
    assert.deepEqual(first.map(m => m.name), ['001_first.sql', '002_second.sql']);
    fs.writeFileSync(path.join(f.directory, '002_second.sql'), 'SELECT 2;\n');
    assert.equal(first[1].checksum, readMigrations(f.directory)[1].checksum);
  } finally { f.cleanup(); }
});

test('runner wraps migration and history write in a transaction', async () => {
  const f = fixture();
  try {
    await runMigrations(f.client, { directory: f.directory, log() {} });
    const sql = f.statements.map(s => s.sql);
    assert.ok(sql.indexOf('BEGIN') < sql.indexOf('SELECT 1;'));
    assert.ok(sql.findIndex(s => s.startsWith('INSERT INTO schema_migrations')) < sql.indexOf('COMMIT'));
    assert.ok(sql.at(-1).includes('pg_advisory_unlock'));
  } finally { f.cleanup(); }
});

test('failure rolls back and does not log private database error detail', async () => {
  const f = fixture({ '001_first.sql': 'FAIL;' });
  const query = f.client.query;
  f.client.query = async (sql, params) => {
    if (sql === 'FAIL;') throw Object.assign(new Error('PRIVATE PATIENT DETAIL'), { code: '23505' });
    return query(sql, params);
  };
  try {
    await assert.rejects(runMigrations(f.client, { directory: f.directory, log() {} }), error => error.code === '23505' && !error.message.includes('PRIVATE'));
    assert.ok(f.statements.some(s => s.sql === 'ROLLBACK'));
    assert.ok(!f.statements.some(s => s.sql.startsWith('INSERT INTO schema_migrations')));
    assert.ok(f.statements.at(-1).sql.includes('pg_advisory_unlock'));
  } finally { f.cleanup(); }
});

test('changed applied migration fails before pending SQL executes', async () => {
  const f = fixture();
  const query = f.client.query;
  f.client.query = (sql, params) => sql.startsWith('SELECT name, checksum')
    ? Promise.resolve({ rows: [{ name: '001_first.sql', checksum: 'changed' }] }) : query(sql, params);
  try {
    await assert.rejects(runMigrations(f.client, { directory: f.directory, log() {} }), /has changed/);
    assert.ok(!f.statements.some(s => s.sql === 'BEGIN'));
  } finally { f.cleanup(); }
});

test('another migration lock prevents writes', async () => {
  const f = fixture();
  f.client.query = async sql => { f.statements.push({ sql }); return { rows: [{ acquired: false }] }; };
  try {
    await assert.rejects(runMigrations(f.client, { directory: f.directory }), /Another SmartHospital/);
    assert.equal(f.statements.length, 1);
  } finally { f.cleanup(); }
});

test('database scripts require explicit credentials and keep them in environment', () => {
  assert.throws(() => databaseConfig({}), /Set DATABASE_URL/);
  const config = databaseConfig({ DATABASE_URL: 'postgresql://fixture_user:fixture%40password@localhost:5433/smarthospital_test' });
  const env = pgToolEnvironment(config, 'smarthospital_restore');
  assert.equal(env.PGPASSWORD, 'fixture@password');
  assert.equal(env.PGDATABASE, 'smarthospital_restore');
  assert.equal(env.PGPORT, '5433');
});
