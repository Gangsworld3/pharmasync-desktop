# Clean-Machine Install Validation

This validation is the release gate for Windows deployment.

If any `P0` check fails, do not distribute the build.

## Scope

- target artifact: `dist/PharmaSync Desktop Setup 1.0.0.exe`
- optional artifact: `dist/PharmaSync Desktop 1.0.0.exe` (portable)
- target OS: Windows 10/11 x64
- backend mode: reachable and unreachable network states

## Test Environment Requirements

- fresh Windows profile (new local user is acceptable)
- no pre-existing PharmaSync runtime directory
- no node/npm/python required on validator machine
- internet toggling available (Wi-Fi on/off)

## Pre-Validation Inputs

- backend URL (production or staging)
- test credentials:
  - `admin@pharmasync.local`
  - `Admin123!`
- installer checksum and build timestamp

## Pass/Fail Severity

- `P0` blocks release
- `P1` fix before pilot expansion
- `P2` track as backlog

## Validation Steps

### 1. Installer Integrity (`P0`)

1. Verify installer file opens without SmartScreen corruption warning.
2. Verify checksum matches release artifact list.
3. Start install with default path.

Expected:

- installer completes with no crash
- app shortcut created

### 2. First Launch Bootstrap (`P0`)

1. Launch app from shortcut.
2. Wait for first render and initial runtime creation.
3. Open app metadata endpoint from local runtime:
   - `http://localhost:4173/api/local/app-meta`

Expected:

- app loads in under 15s on baseline machine
- metadata endpoint responds with `version` and `runtimePaths`
- runtime files exist:
  - `runtime/data/pharmasync.db`
  - `runtime/settings.json`
  - `runtime/logs/sync.log`

### 3. Authentication Persistence (`P0`)

1. Sign in through desktop settings using test credentials.
2. Trigger manual sync.
3. Close and reopen app.

Expected:

- session remains authenticated after restart
- sync status endpoint reports `authenticated: true`

### 4. Offline Safety (`P0`)

1. Turn off internet.
2. Create one client and edit same client twice.
3. Create one appointment.
4. Restart app while still offline.

Expected:

- offline banner/status shown
- data remains present after restart
- no crash and no data loss

### 5. Reconnect + Convergence (`P0`)

1. Turn internet on.
2. Run manual sync.
3. Confirm sync status reaches `SYNCED`.

Expected:

- pending local operations eventually reach zero
- local edits are preserved (not overwritten unexpectedly)
- no unresolved `ERROR` state

### 6. Conflict Capture + Resolution (`P1`)

1. Create an appointment overlap scenario from another device/user.
2. Sync validator machine.
3. Open conflict center and resolve using suggestion.
4. Sync again.

Expected:

- conflict appears with actionable payload
- resolution creates follow-up local operation
- post-resolution sync clears conflict

### 7. Backup Export + Restore Drill (`P0`)

1. Execute `Export Database` in settings.
2. Confirm backup `.db` file appears in `runtime/backups/`.
3. Copy backup to external folder.
4. Replace local DB with exported copy on a throwaway profile.
5. Relaunch app.

Expected:

- backup file is generated
- restored app boots and data is readable

### 8. Logging + Supportability (`P1`)

1. Force one sync error (bad backend URL).
2. Restore backend URL and sync successfully.
3. Inspect:
   - `runtime/logs/error.log`
   - `runtime/logs/sync.log`

Expected:

- error is logged once with useful context
- recovery path also logged

### 9. Portable Build Validation (`P1`)

1. Copy `PharmaSync Desktop 1.0.0.exe` to another folder/USB-like path.
2. Launch without installation.
3. Repeat first-launch bootstrap checks.

Expected:

- app launches successfully in portable mode
- runtime data still writes to user runtime path

## Release Gate Decision

Release is approved only if:

- all `P0` checks pass
- no unresolved crash
- no data-loss behavior observed

## Validation Record Template

Use this table per machine:

| Check | Severity | Result (Pass/Fail) | Notes | Evidence Path |
|---|---|---|---|---|
| Installer Integrity | P0 |  |  |  |
| First Launch Bootstrap | P0 |  |  |  |
| Authentication Persistence | P0 |  |  |  |
| Offline Safety | P0 |  |  |  |
| Reconnect + Convergence | P0 |  |  |  |
| Conflict Capture + Resolution | P1 |  |  |  |
| Backup Export + Restore | P0 |  |  |  |
| Logging + Supportability | P1 |  |  |  |
| Portable Build Validation | P1 |  |  |  |

