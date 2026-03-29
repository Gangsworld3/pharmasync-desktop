# Clean-Machine Validation Run (2026-03-29)

## Result

`No-Go` for pilot start. Validation was executed on a development machine, not a true clean machine.

## Blocking Conditions

1. Render backend is not yet deployed/reachable from this environment.
2. Full clean-machine conditions were not met (existing runtime and dev tooling present).

## Executed Evidence

- installer artifacts present:
  - `dist/PharmaSync Desktop Setup 1.0.0.exe`
  - `dist/PharmaSync Desktop 1.0.0.exe`
- local desktop API booted and responded:
  - `GET /api/local/app-meta` passed
- settings write passed:
  - backend URL persisted as `https://pharmasync-backend.onrender.com`
- offline local operations passed:
  - client create
  - appointment create
- backup export passed:
  - `runtime/backups/pharmasync-backup-2026-03-28T22-36-08-589Z.db`
  - file size `172032` bytes

## Failed / Not Verifiable in This Run

- clean installer behavior on a fresh Windows profile (`not executed`)
- authenticated first sync against live backend (`failed`)
- reconnect convergence to `SYNCED` on deployed backend (`not executed`)
- conflict resolution behavior in real pilot network path (`not executed`)

## Mandatory Next Action

Run the checklist on an actual clean Windows account or separate PC after Render deploy is live.

