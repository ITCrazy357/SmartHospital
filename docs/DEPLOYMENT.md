# Deployment, CI and CD

SmartHospital has two applications: `sh.client` is a Vite static frontend and
`sh.server` is a long-running NestJS backend. Vercel deploys the frontend only.
The backend needs PostgreSQL (with pgvector) and the configured Redis service.
Both packages declare Node 22.x so CI, builds and backend startup use the same
supported major version.

## Vercel frontend

The repository supports both Vercel Root Directory settings:

| Root Directory | Configuration | Build output |
| --- | --- | --- |
| Repository root | `/vercel.json` | `sh.client/dist` |
| `sh.client` | `/sh.client/vercel.json` | `dist` |

Both configurations install with `npm ci`, run `build:deploy`, and rewrite SPA
deep links to `index.html`. Existing files such as `/assets/*.js` are served
normally. Select Node.js **22.x** in the Vercel project settings; the frontend
package also declares this engine. Remove conflicting dashboard command/output
overrides so the checked-in configuration controls the build.

Set `VITE_API_URL` in the Vercel environments that will be deployed (Production
and Preview). It must be the reachable HTTPS backend URL, without a trailing
slash, credentials, query string, or fragment. Do not use `localhost`: that
would address the visitor's computer. Variables beginning with `VITE_` are
public and embedded in the JavaScript build; never put API keys or backend
credentials in them. Changing these variables requires a new deployment.
Configure the backend CORS allowlist for the frontend domains actually used.

`npm run build` performs TypeScript checks and a Vite production build for local
development. `npm run build:deploy` additionally validates the deployment API
URL before compiling. Both checked-in Vercel configurations use this stricter
entry point; the same validation applies to `npm run build` when Vercel sets
`VERCEL=1`.

After deployment, verify the root page, static assets, and real application
links such as `/?view=search`. The application currently selects screens using
the `view` query parameter, not pathname routes. `/login` and
`/patient/appointments` can check the server's SPA fallback only; HTTP 200 on
those paths does not prove the login screen or patient workspace is rendered.
A Vercel deployment marked Ready proves the build completed; it does
not prove the backend is reachable or that login/clinical workflows work.
Protected preview deployments may redirect anonymous checks to Vercel SSO.

## GitHub Actions

`.github/workflows/ci.yml` runs independent frontend and backend jobs using Node
22. The Actions themselves use a Node 24 compatible runtime. New pushes cancel
superseded checks for the same branch; each job has a time limit.

The frontend job runs workflow/deployment configuration tests and the exact
`build:deploy` entry point used by Vercel. Its `VITE_API_URL` is explicitly
`https://api.example.invalid`, a build fixture that never receives API requests.
CI therefore verifies compilation/configuration and does not claim production
API connectivity or deploy that fixture artifact.

The backend job provisions isolated PostgreSQL/pgvector and Redis services,
then runs script tests, unit tests, integration tests, and the application
build. `TEST_DATABASE_URL` and `TEST_REDIS_URL` point only to these CI services.
Production connection strings belong in the deployment environment, never in
the workflow or frontend variables.

Use the check/deployment attached to the exact commit being investigated.
A failed historical run remains failed after a later commit fixes its cause.

## Continuous deployment verification

Render and Vercel already deploy through their Git integrations. The selected
model keeps this native auto-deploy and adds `.github/workflows/cd.yml`: after
successful main-push CI it checks live backend/frontend revisions (or proves
unchanged app source for a skipped monorepo deploy), API readiness and the
frontend page. No new deploy token is required. See
[CD configuration and retry instructions](CD.md).

## Render backend

The reported production logs show missing `doctor_schedule_rules` and
`appointment_reminders.status`: the API connected to an older database schema.
`npm run start:prod` starts the built API only; it does not migrate the database.
Take a verified backup and rehearse the versioned migrations on a copy before
upgrading the clinic database (see `OPERATIONS.md`).

For the existing Node service, set Root Directory to `sh.server`, Build Command
to `npm ci && npm run build`, Start Command to `npm run start:deploy`, and Health
Check Path to `/health/ready`. `start:deploy` runs the existing transactional,
checksum-checked migration runner before loading the API. Migration failure
stops startup; it never seeds or resets the database. A service configured with
Root Directory at the repository root must use the equivalent `npm --prefix
sh.server ...` commands. Docker users can override the command to
`npm run start:deploy` after completing the same backup/rehearsal steps.

Startup logs must include `[deploy] Running database migrations.` followed by
`[deploy] Migrations completed; starting API.` before Nest starts. If migration
fails, the second marker and API startup do not occur. Compare the deployment
commit and its own deploy logs: application logs may still come from a previous
instance after a failed deployment.

Readiness retains a generic public 503 response. Private logs identify `redis`,
`database_schema`, `migration_files` or `migration_history`, with SQLSTATE only
for database errors. Identical failures are logged once until recovery or a
different failure. The schema probe includes doctor scheduling tables and
reminder state, so a complete migration ledger alone cannot hide that drift.

Alternatively, on a plan supporting Pre-Deploy Commands, use `npm run db:migrate`
and keep Start Command `npm run start:prod`; choose one migration entry point.
Keep Auto-Deploy **On Commit** for the selected native-deploy/observer model;
the observer itself waits for deployment and must not be a prerequisite for
starting that deployment. Check the exact deployed commit. See [CD.md](CD.md).
Adding a script to Git does not change the dashboard commands of an existing
Render service. Do not put production migrations in GitHub's test database job.

Set `CLIENT_APP_URL` to the public Vercel origin and `TRUST_PROXY_HOPS` to the
verified proxy count. Supply Redis through backend-only `REDIS_URL`, with
`REDIS_REQUIRED=true` after confirming connectivity. Do not copy the local
Compose Redis port or test URLs into Render.

Reference: [Render deploy steps and CI integration](https://render.com/docs/deploys).

## Supabase certificate trust on Render

`Database migration failed (SELF_SIGNED_CERT_IN_CHAIN)` is a TLS trust failure
before migrations execute. It is not a Redis error. The deployment entry point
must keep refusing API startup when the database connection is not verified.
API and migration TLS now both verify server certificates when SSL is enabled.

For a Supabase CA that is not in Node's built-in trust store:

1. In the **correct Supabase project**, open Database Settings, find SSL
   Configuration and download the CA certificate using Download Certificate.
   This is the certificate of the database used by the Render backend, which
   may differ from a developer's local configuration or Storage project.
2. In Render's SmartHospital backend, open Environment, Secret Files, Add Secret
   File. Use Filename `supabase-ca.crt`; paste the complete downloaded PEM,
   including its BEGIN CERTIFICATE and END CERTIFICATE lines, as Contents.
3. Set backend environment variables `POSTGRES_SSL=true` and
   `NODE_EXTRA_CA_CERTS=/etc/secrets/supabase-ca.crt`. Save and deploy. Node reads
   the latter at process startup: putting it only in an application `.env`
   loaded after Node starts does not extend the trust store. The migration child
   inherits the same process environment and certificate file.
4. If `DATABASE_URL` contains an `sslmode` parameter, use `sslmode=verify-full`.
   Remove conflicting `ssl` query parameters such as `ssl=0` or
   `ssl=no-verify`; URL TLS options can override `POSTGRES_SSL=true`.
   Preserve the connection credentials and host. If it includes `sslrootcert`,
   ensure that parameter points to the same trusted CA file: an explicitly
   supplied CA overrides Node's default/extra CA store.
5. Keep Start Command `npm run start:deploy` and Health Check Path
   `/health/ready`. Check the migration markers, then readiness, after deploy.

Do not disable TLS verification to get past the error. A missing, invalid or
wrong CA should fail the deployment. This procedure supplies trust; it does not
claim that production migrations have succeeded. Schema/data migration errors
must be handled separately after a verified TLS connection succeeds.

References: [Supabase SSL and CA download](https://supabase.com/docs/guides/platform/ssl-enforcement),
[Render Secret Files](https://render.com/docs/configure-environment-variables#secret-files),
[Node extra CA certificates](https://nodejs.org/api/cli.html#node_extra_ca_certsfile).

## Verified baseline (2026-11-02)

The public frontend `https://smart-hospital-rouge.vercel.app/` returned HTTP 200.
Its public JavaScript referenced
`https://smart-hospital-api-6y6v.onrender.com`, without the localhost API fallback.
Direct `/login` and `/patient/appointments` requests returned HTTP 404 before
the SPA rewrite configuration. After pushing that configuration, all three
URLs returned HTTP 200 and the SPA shell. These pathname checks verify only
fallback hosting: neither pathname is a defined application screen route.
The backend returned `/health/live` 200 and `/health/ready` 503; the supplied
Render logs confirm the missing schema described above. Deployment commands
and Redis environment settings on the existing Render service have not been
changed from this workspace. Authentication and clinical acceptance testing
remain separate checks; no patient data was accessed for this baseline.
The real `/?view=search` screen rendered its search field and filters in a
browser without a JavaScript page error. The anonymous login dialog opened
with email/password fields; no credentials were entered or submitted.

Local verification after clean `npm ci`: 143 backend unit tests, 84 integration
tests using real disposable PostgreSQL/Redis, 11 deployment/migration script
tests, 4 frontend tests, and both production builds passed. The full HTTP module
also passed with Redis disabled (2 tests). The built backend started through
`start:deploy` against the migrated disposable database and reached readiness
200; an unreachable test database stopped deployment before API startup.

Reference: [Vercel's Vite SPA configuration](https://vercel.com/docs/frameworks/frontend/vite#using-vite-to-make-spas).
