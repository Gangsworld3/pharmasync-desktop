# PharmaSync Desktop

PharmaSync Desktop is a desktop-first management platform foundation for pharmacies, drug stores, clinics, and adjacent service businesses operating in South Sudan and similar low-connectivity markets.

This repository includes:

- a premium desktop product shell with pharmacy-specific workflows
- architecture and implementation documentation
- a production-oriented data model and API surface
- an offline-first sync strategy tailored for weak connectivity

## Run

```powershell
cd "C:\Users\hp\Documents\GitHub\pharmasync-desktop"
npm start
```

Then open [http://localhost:4173](http://localhost:4173).

## Desktop packaging

The desktop runtime now includes an Electron wrapper and packaging configuration for Windows-first distribution.

Development desktop shell:

```powershell
cd "C:\Users\hp\Documents\GitHub\pharmasync-desktop"
npm run electron:dev
```

Windows installer and portable build:

```powershell
cd "C:\Users\hp\Documents\GitHub\pharmasync-desktop"
npm run dist
```

Outputs are written to `dist/` and target:

- NSIS installer (`.exe`)
- portable Windows build

Deployment runbooks:

- clean-machine validation: `docs/deployment/clean-machine-install-validation.md`
- pilot rollout workflow: `docs/deployment/pilot-rollout-workflow.md`
- field operator checklist: `docs/deployment/field-operator-checklist.md`
- day 1 pilot log: `docs/deployment/day-1-validation-log.md`
- executed clean-machine run (2026-03-29): `docs/deployment/clean-machine-validation-run-2026-03-29.md`
- executed day 1 rehearsal (2026-03-29): `docs/deployment/day-1-validation-log-2026-03-29.md`

Render deployment manifest:

- `render.yaml` (deploys FastAPI + managed PostgreSQL on Render)

## Runtime settings, backup, and logs

The desktop app now persists runtime settings and operational files under:

- settings: `runtime/settings.json`
- session: `runtime/session.json`
- local SQLite: `runtime/data/pharmasync.db`
- logs: `runtime/logs/`
- backups: `runtime/backups/`

Settings available from the desktop UI:

- backend URL
- sync interval
- device info
- app version
- export local database backup

Operator-safe backup endpoint:

- `POST /api/local/backup/export`

Runtime settings endpoints:

- `GET /api/local/settings`
- `POST /api/local/settings`
- `GET /api/local/app-meta`
- `POST /api/local/auth/login`
- `POST /api/local/auth/logout`

Log files currently written by the desktop runtime:

- `runtime/logs/sync.log`
- `runtime/logs/error.log`

Authentication notes:

- the desktop sync engine no longer embeds fallback admin credentials
- sync requires either an explicit desktop sign-in or externally provided environment credentials
- successful desktop sign-in stores a persistent session in `runtime/session.json`

Backup notes:

- desktop backup export now uses a SQLite-safe export flow against the live WAL database
- exported backups are written as standalone `.db` files into `runtime/backups/`

## Offline-first local database

This phase adds a real local SQLite database through Prisma.

- SQLite file: `prisma/dev.db`
- ORM: Prisma
- Local tables: clients, invoices, inventory items, appointments, messages
- Soft-delete support on operational tables via `deletedAt`
- Offline fields on every model: `dirty`, `syncStatus`, `localRevision`, `lastSyncedAt`
- Sync support tables: `SyncQueue`, `AuditLog`

Database commands:

```powershell
cd "C:\Users\hp\Documents\GitHub\pharmasync-desktop"
npm run db:generate
npm run db:push
npm run db:seed
```

Local API endpoints:

- `GET /api/local/summary`
- `GET /api/local/clients`
- `GET /api/local/invoices`
- `GET /api/local/inventory`
- `GET /api/local/appointments`
- `GET /api/local/messages`
- `GET /api/local/sync-queue`
- `GET /api/local/audit-logs`
- `POST /api/local/invoices`
- `POST /api/local/sync/retry`
- `POST /api/local/sync/conflicts/:queueId`

## Safety guarantees now implemented

- API write flow is now `API -> service layer -> repository -> database`
- Invoice creation is transactional and atomic with inventory deduction
- Every transactional invoice write creates sync queue records for invoice and inventory changes
- Every transactional invoice write creates an audit log entry
- Soft-delete fields exist for all requested operational tables

Example transactional invoice payload:

```json
{
  "invoiceNumber": "INV-2026-2099",
  "clientId": "cmnahdsw800007298b6qqg5j1",
  "inventorySku": "AMOX-500",
  "quantity": 5,
  "totalMinor": 1200000,
  "paymentMethod": "cash"
}
```

## FastAPI backend

Phase 3 adds a real Python backend under `backend/` with JWT auth, CRUD APIs, and service-layer business rules.

Critical architecture correction:

- `SQLite` is local-only for the desktop app
- `FastAPI` must never point at `prisma/dev.db`
- `FastAPI` is server-only and must use `PostgreSQL`
- synchronization happens between the desktop local store and the remote API, not by sharing one database file

Required deployment topology:

```text
[Desktop App]
   -> [Local SQLite]
   -> sync ->
[FastAPI Remote API]
   -> [PostgreSQL]
```

## Phase 4 server canonical store

The backend now targets a canonical PostgreSQL schema with:

- `server_revision` on every business table
- `created_at`, `updated_at`, `deleted_at` on every business table
- `sync_events` as the authoritative revision log
- Alembic migration scaffolding under `backend/migrations/`

Local development Postgres:

```powershell
docker run -d --name pharmasync-postgres -e POSTGRES_USER=pharma -e POSTGRES_PASSWORD=secure123 -e POSTGRES_DB=pharmasync -p 5432:5432 postgres:15
```

Or use:

```powershell
docker compose -f backend/docker-compose.postgres.yml up -d
```

Run:

```powershell
cd "C:\Users\hp\Documents\GitHub\pharmasync-desktop"
py -3 -m uvicorn app.main:app --app-dir backend --reload --port 8090
```

Before starting the backend, copy `backend/.env.example` to `backend/.env` and set a real PostgreSQL connection string.

Render environment keys (backend expects `PHARMASYNC_*`):

- `PHARMASYNC_DATABASE_URL`
- `PHARMASYNC_JWT_SECRET`

Alembic workflow:

```powershell
cd "C:\Users\hp\Documents\GitHub\pharmasync-desktop"
py -3 -m alembic upgrade head
```

Rule:

- never change the backend database schema manually
- always add or modify schema via Alembic migrations

Default admin bootstrap:

- email: `admin@pharmasync.local`
- password: `Admin123!`

Core backend routes:

- `POST /auth/login`
- `GET|POST|PUT|DELETE /clients`
- `GET|POST|PUT|DELETE /inventory`
- `GET|POST|PUT|DELETE /appointments`
- `GET|POST|PUT|DELETE /messages`
- `GET|POST|DELETE /invoices`
- `POST /sync/push`
- `GET /sync/pull?since=revision`

Canonical success response shape:

```json
{
  "status": "success",
  "data": {},
  "meta": {}
}
```

Sync responses use:

```json
{
  "status": "success",
  "data": {
    "applied": [],
    "conflicts": [],
    "serverChanges": [],
    "results": []
  },
  "meta": {
    "revision": 123
  }
}
```

Conflict strategies:

- `Client`: field-level auto-merge with `resolution = AUTO_MERGED`
- `InventoryItem`: strict rejection on stale or unsafe stock mutations
- `Appointment`: conflict response includes suggested next slots and `resolution = REQUIRES_USER_ACTION`
- `Message`: append-oriented sync path with no special stale-write rejection strategy

Backend business rules:

- invoice totals are computed from invoice line items
- invoice creation deducts stock atomically
- appointment creation rejects overlapping staff bookings
- protected CRUD routes require JWT bearer auth
- sync push rejects stale device writes when `localRevision < server_revision`
- sync pull returns canonical server changes since a revision

Safety guard:

- the backend now refuses to start unless `PHARMASYNC_DATABASE_URL` uses `postgresql+psycopg://`

Verification status:

- backend Python modules compile
- Alembic environment and initial migration file are present
- Docker/PostgreSQL runtime could not be verified in this workspace because local Docker commands did not return

## Phase 5 integration tests

The backend now has a real PostgreSQL-backed integration test suite under `backend/tests/`.

Test guarantees currently encoded:

- insufficient stock rejects invoice sync and preserves inventory
- cross-device inventory conflicts stay strict and never allow negative stock
- appointment overlaps are rejected on the server during sync
- soft deletes propagate through `/sync/pull`
- replaying the same operation is idempotent
- multi-operation sync batches return per-operation results
- global revision integrity is preserved in `sync_events`
- backend lifespan startup initializes the system without deprecated startup events
- decimal-backed inventory quantities are serialized safely without float coercion
- randomized multi-device sync sequences preserve revision integrity, inventory safety, and operation uniqueness

Test database:

- `pharmasync_test`
- never reuse the main dev database for integration tests

Run locally:

```powershell
cd "C:\Users\hp\Documents\GitHub\pharmasync-desktop"
docker compose -f backend/docker-compose.postgres.yml up -d
& "C:\Users\hp\AppData\Local\Python\bin\python.exe" -m pytest backend\tests -q
```

CI:

- GitHub Actions workflow: `.github/workflows/backend-tests.yml`

## Structure

- `desktop/` desktop-first product shell that can later be wrapped by Tauri
- `docs/architecture.md` system design and service boundaries
- `docs/database-schema.sql` local and cloud schema baseline
- `docs/api-design.md` versioned API surface and sync contracts
- `docs/ui-wireframes.md` key screen descriptions
- `docs/roadmap.md` MVP vs full platform rollout

## Recommended production stack

- Desktop shell: Tauri + React + TypeScript
- Local persistence: encrypted SQLite
- Cloud API: FastAPI + PostgreSQL + Redis
- Sync model: append-only change log with server reconciliation
- Notifications: SMS-first provider adapter with email fallback

## Current state

This is an implementation foundation and executable product shell, not a finished commercial release. It is designed to reduce architecture risk and accelerate the real build.
