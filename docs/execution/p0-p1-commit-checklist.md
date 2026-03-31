# P0-P1 Execution Checklist (Commit-by-Commit)

## Scope lock
- Repo: `C:\Users\hp\Documents\GitHub\pharmasync-desktop`
- Order: `P0` first, then `P1`
- Rule: one concern per commit, full gate run before next commit

## P0-C1: Deterministic desktop test isolation
- Goal: prevent sync/chaos flake from shared SQLite runtime collisions
- Files:
  - `scripts/run-desktop-suite.js`
  - `package.json`
- Change:
  - Introduce isolated per-suite runtime dir via `PHARMASYNC_DATA_DIR=runtime/test-runs/<suite>-<pid>`
  - Route `test:desktop-sync`, `test:desktop-chaos`, `test:desktop-chaos-matrix`, `test:architecture` through isolated runner
- Validation:
  - `npm run test:desktop-sync`
  - `npm run test:desktop-chaos`
  - `python -m pytest -q` (in `backend/`)
- Rollback point:
  - `git revert <P0-C1-commit-sha>`

## P0-C2: Idempotent-safe local operation transition writes
- Goal: ensure retry/update paths are no-op safe under races
- Files:
  - `src/db/repositories.js`
  - `src/services/ports/operation-repo.port.js`
  - `src/services/sync-push/push-orchestrator.js`
- Change:
  - Keep `P2025` as safe no-op
  - Ensure caller paths that update transitions tolerate already-removed operations deterministically
- Validation:
  - `npm run test:desktop-sync`
  - `npm run test:desktop-chaos`
  - `python -m pytest -q` (in `backend/`)
- Rollback point:
  - `git revert <P0-C2-commit-sha>`

## P0-C3: Deterministic ordering enforcement in push/sync paths
- Goal: guarantee stable ordering by `createdAt,id,operationId` before processing
- Files:
  - `src/services/sync-shared/batching.js`
  - `src/services/sync-push/push-batcher.js`
  - `src/services/sync-cycle-runner.js`
- Change:
  - Enforce ordering at plan boundary and keep iteration stable in loops
- Validation:
  - `npm run test:desktop-sync`
  - `npm run test:desktop-chaos`
  - `python -m pytest -q` (in `backend/`)
- Rollback point:
  - `git revert <P0-C3-commit-sha>`

## P1-C1: Desktop internal HTTP bypass hardening
- Goal: no desktop local flow depends on `fetch("http://localhost...")`
- Files:
  - `electron/main.js`
  - `server.js` (adapter-only verification, no deletion)
  - `src/services/*` (only if extraction is required)
- Change:
  - Direct service calls from IPC handlers for local desktop flows
- Validation:
  - `npm run test:desktop-sync`
  - `npm run test:desktop-chaos`
  - `python -m pytest -q` (in `backend/`)
- Rollback point:
  - `git revert <P1-C1-commit-sha>`

## P1-C2: Repository modular split without behavior change
- Goal: reduce repository hotspot while preserving signatures
- Files:
  - `src/db/repositories/index.js`
  - `src/db/repositories/inventoryRepo.js`
  - `src/db/repositories/salesRepo.js`
  - `src/db/repositories/clientRepo.js`
  - `src/db/repositories/syncRepo.js`
  - `src/db/repositories.js` (compat export shim during migration)
- Change:
  - move-only extraction, no API/signature changes
- Validation:
  - `npm run test:desktop-sync`
  - `npm run test:desktop-chaos`
  - `python -m pytest -q` (in `backend/`)
- Rollback point:
  - `git revert <P1-C2-commit-sha>`
