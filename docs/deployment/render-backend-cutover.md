# Render Backend Cutover (PostgreSQL + Sync)

This runbook deploys the backend API to Render for multi-device sync.

## 1) Prerequisites

- GitHub repo is up to date.
- `render.yaml` exists at repo root.
- Backend Dockerfile exists at repo root and uses `${PORT:-10000}`.

## 2) Create Render resources

1. In Render, create a new Blueprint from this repository.
2. Confirm service and DB names:
   - web service: `pharmasync-backend`
   - database: `pharmasync-db`
3. Region: `frankfurt` (already in `render.yaml`).

## 3) Required environment variables

`render.yaml` handles generated and linked values for:

- `PHARMASYNC_DATABASE_URL` (from managed Postgres)
- `PHARMASYNC_JWT_SECRET` (generated)
- `PHARMASYNC_DEFAULT_ADMIN_PASSWORD` (generated)

Database variable policy (strict):

- Set only `PHARMASYNC_DATABASE_URL`.
- Remove `DATABASE_URL` if present.
- If you use Supabase, set the pooler URI in `PHARMASYNC_DATABASE_URL` with `sslmode=require`.
- If Render env history contains malformed URL-shaped keys from older deploys, delete them from the service environment page before redeploy.

Set these manually in Render if not already set:

- `PHARMASYNC_REDIS_URL` (recommended for production)
- `PHARMASYNC_REDIS_KEY_PREFIX=pharmasync`
- `PHARMASYNC_SECURITY_ALERT_WEBHOOK_URL` (optional)
- `ENV=production`

## 4) Deploy and verify

After deploy, verify:

1. `https://<service>.onrender.com/health` returns `{"status":"ok"}`
2. `https://<service>.onrender.com/ready` returns database `ok`
3. Auth endpoint responds successfully:
   - `GET /auth/me` (with a valid bearer token)
4. Login API responds successfully:
   - `POST /auth/login`

## 5) Desktop cutover

In desktop settings:

1. Set backend URL to Render endpoint.
2. Save settings.
3. Trigger sync.
4. Confirm status becomes synced with no retry growth.

## 6) Post-cutover checks

- Two devices can create records and sync to same backend.
- No duplicate invoices under retry.
- Inventory deductions remain non-negative.
- Appointment conflicts are visible and resolvable.
