const fs = require('node:fs');
const path = require('node:path');

function loadEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

function databaseConfig(env = process.env) {
  const ssl = env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: true } : undefined;
  if (env.DATABASE_URL) return { connectionString: env.DATABASE_URL, ssl, connectionTimeoutMillis: 10000 };
  if (!env.POSTGRES_DB || !env.POSTGRES_USER || !env.POSTGRES_PASSWORD) {
    throw new Error('Set DATABASE_URL or POSTGRES_DB, POSTGRES_USER and POSTGRES_PASSWORD explicitly.');
  }
  return {
    host: env.POSTGRES_HOST || 'localhost', port: Number(env.POSTGRES_PORT || 5432),
    user: env.POSTGRES_USER, password: env.POSTGRES_PASSWORD, database: env.POSTGRES_DB,
    ssl, connectionTimeoutMillis: 10000,
  };
}

function pgToolEnvironment(config, targetDatabase) {
  let options = config;
  if (config.connectionString) {
    const url = new URL(config.connectionString);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Expected a PostgreSQL database URL.');
    options = {
      host: url.hostname, port: url.port || 5432, user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password), database: decodeURIComponent(url.pathname.slice(1)),
      sslmode: url.searchParams.get('sslmode'),
    };
  }
  const env = {
    ...process.env, PGHOST: String(options.host || 'localhost'), PGPORT: String(options.port || 5432),
    PGUSER: options.user, PGPASSWORD: options.password, PGDATABASE: targetDatabase || options.database,
    PGCONNECT_TIMEOUT: '10',
  };
  if (options.sslmode) env.PGSSLMODE = options.sslmode;
  else if (config.ssl) env.PGSSLMODE = 'verify-full';
  return env;
}

const defaultEnvPath = path.resolve(__dirname, '..', '.env');
module.exports = { loadEnvFile, databaseConfig, pgToolEnvironment, defaultEnvPath };
