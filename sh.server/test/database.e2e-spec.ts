import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
const { runMigrations, prepareBaseline } = require('../scripts/migrate.cjs');

const testUrl = process.env.TEST_DATABASE_URL;
const integration = testUrl ? describe : describe.skip;

integration('versioned migrations on an isolated PostgreSQL schema', () => {
  let client: Client;
  let schema: string;

  beforeAll(async () => {
    const url = new URL(testUrl!);
    if (!url.pathname.toLowerCase().includes('test')) throw new Error('TEST_DATABASE_URL must name a disposable test database.');
    client = new Client({ connectionString: testUrl, connectionTimeoutMillis: 10000 });
    await client.connect();
    // Install extension outside the per-test schema so dropping it never removes shared types.
    await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await client.query('CREATE EXTENSION IF NOT EXISTS vector');
  });

  beforeEach(async () => {
    schema = `sh_test_${randomUUID().replace(/-/g, '')}`;
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}", public`);
  });

  afterEach(async () => {
    if (schema) {
      await client.query('SET search_path TO public');
      await client.query(`DROP SCHEMA "${schema}" CASCADE`);
    }
  });

  afterAll(async () => { if (client) await client.end(); });

  it('bootstraps from empty, repeats safely, and preserves rows', async () => {
    const applied = await runMigrations(client, { log() {} });
    expect(applied).toContain('000_baseline.sql');
    const patient = await client.query("INSERT INTO users(full_name,email,password_hash) VALUES ('Fixture patient','fixture@example.invalid','fixture-hash') RETURNING id");
    expect(await runMigrations(client, { log() {} })).toEqual([]);
    expect((await client.query('SELECT token_version FROM users WHERE id=$1', [patient.rows[0].id])).rows[0].token_version).toBe(0);
  });

  it('bootstraps even when a different schema already has an identically named enum', async () => {
    const shadow = `sh_shadow_${randomUUID().replace(/-/g, '')}`;
    await client.query(`CREATE SCHEMA "${shadow}"`);
    try {
      await client.query(`CREATE TYPE "${shadow}".slot_status AS ENUM ('available','booked','on_leave')`);
      await runMigrations(client, { log() {} });
      const own = await client.query("SELECT 1 FROM pg_type WHERE typname='slot_status' AND typnamespace=$1::regnamespace", [schema]);
      expect(own.rows).toHaveLength(1);
    } finally { await client.query(`DROP SCHEMA "${shadow}" CASCADE`); }
  });

  it('upgrades an unversioned baseline without losing existing patient data', async () => {
    const fs = require('node:fs');
    const path = require('node:path');
    await prepareBaseline(client);
    await client.query(fs.readFileSync(path.join(__dirname, '../migrations/000_baseline.sql'), 'utf8'));
    const patient = await client.query("INSERT INTO users(full_name,email,password_hash) VALUES ('Existing fixture','existing@example.invalid','fixture-hash') RETURNING id");
    await runMigrations(client, { log() {} });
    expect((await client.query('SELECT id FROM users WHERE id=$1', [patient.rows[0].id])).rows).toHaveLength(1);
  });

  it('rejects duplicate phones and duplicate doctor slots at database boundary', async () => {
    await runMigrations(client, { log() {} });
    const doctor = await client.query("INSERT INTO users(full_name,email,password_hash,phone,role) VALUES ('Fixture doctor','doctor@example.invalid','fixture-hash','0901234567','doctor') RETURNING id");
    await expect(client.query("INSERT INTO users(full_name,email,password_hash,phone) VALUES ('Other fixture','other@example.invalid','fixture-hash','0901234567')")).rejects.toMatchObject({ code: '23505' });
    await client.query("INSERT INTO appointment_slots(doctor_id,slot_time) VALUES ($1,'2030-01-07 09:00:00')", [doctor.rows[0].id]);
    await expect(client.query("INSERT INTO appointment_slots(doctor_id,slot_time) VALUES ($1,'2030-01-07 09:00:00')", [doctor.rows[0].id])).rejects.toMatchObject({ code: '23505' });
  });

  it('stops an unsafe upgrade with duplicates and leaves rows intact', async () => {
    const fs = require('node:fs');
    const path = require('node:path');
    await prepareBaseline(client);
    await client.query(fs.readFileSync(path.join(__dirname, '../migrations/000_baseline.sql'), 'utf8'));
    await client.query("INSERT INTO users(full_name,email,password_hash,phone) VALUES ('Fixture A','a@example.invalid','fixture-hash','0901234567'),('Fixture B','b@example.invalid','fixture-hash','0901234567')");
    await expect(runMigrations(client, { log() {} })).rejects.toMatchObject({ code: 'P0001' });
    expect((await client.query('SELECT count(*)::int AS count FROM users')).rows[0].count).toBe(2);
    expect((await client.query("SELECT count(*)::int AS count FROM schema_migrations WHERE name='001_integrity.sql'")).rows[0].count).toBe(0);
  });
});
