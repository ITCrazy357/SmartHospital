# Deployment and CI

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

After deployment, verify the root page, static assets, and a direct URL such as
`/login`. A Vercel deployment marked Ready proves the build completed; it does
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

Alternatively, on a plan supporting Pre-Deploy Commands, use `npm run db:migrate`
and keep Start Command `npm run start:prod`; choose one migration entry point.
Set Auto-Deploy to **After CI Checks Pass** and check the exact deployed commit.
Adding a script to Git does not change the dashboard commands of an existing
Render service. Do not put production migrations in GitHub's test database job.

Set `CLIENT_APP_URL` to the public Vercel origin and `TRUST_PROXY_HOPS` to the
verified proxy count. Supply Redis through backend-only `REDIS_URL`, with
`REDIS_REQUIRED=true` after confirming connectivity. Do not copy the local
Compose Redis port or test URLs into Render.

Reference: [Render deploy steps and CI integration](https://render.com/docs/deploys).

## Verified baseline (2026-11-02)

The public frontend `https://smart-hospital-rouge.vercel.app/` returned HTTP 200.
Its public JavaScript referenced
`https://smart-hospital-api-6y6v.onrender.com`, without the localhost API fallback.
Direct `/login` and `/patient/appointments` requests returned HTTP 404 before
the SPA rewrite configuration. After pushing that configuration, all three
public routes returned HTTP 200 and the SPA shell. This was a routing defect
even though earlier GitHub Actions and Vercel builds reported success.
The backend returned `/health/live` 200 and `/health/ready` 503; the supplied
Render logs confirm the missing schema described above. Deployment commands
and Redis environment settings on the existing Render service have not been
changed from this workspace. Authentication and clinical acceptance testing
remain separate checks; no patient data was accessed for this baseline.

Local verification after clean `npm ci`: 143 backend unit tests, 84 integration
tests using real disposable PostgreSQL/Redis, 11 deployment/migration script
tests, 4 frontend tests, and both production builds passed. The full HTTP module
also passed with Redis disabled (2 tests). The built backend started through
`start:deploy` against the migrated disposable database and reached readiness
200; an unreachable test database stopped deployment before API startup.

Reference: [Vercel's Vite SPA configuration](https://vercel.com/docs/frameworks/frontend/vite#using-vite-to-make-spas).
