# Pilot Day 1 Validation Log

## Site Info
- Location: Local rehearsal environment
- Operator Name: Codex automated run
- Devices: 1 local runtime instance
- Date: 2026-03-29

---

## Installation

- [x] Installer launched successfully (artifact build verified)
- [x] App opened without errors (local desktop API booted)
- [x] No antivirus/system blocks (none observed in local run)

Notes:
- This was not executed on a clean machine profile.

---

## Initial Setup

- [x] Backend URL configured
- [ ] Login successful
- [x] Device initialized

Notes:
- Backend set to `https://pharmasync-backend.onrender.com`.
- Login not executed because backend is currently unreachable.

---

## First Sync

- [x] Sync started automatically
- [ ] Sync completed
- [ ] Status shows "SYNCED"

Server Revision: `40` (previous local state)
Time Taken: `<1s` for failed attempt

Notes:
- Sync failed with: `Remote authentication required. Sign in from desktop settings.`

---

## Core Flows Tested

### Client

- [x] Create client
- [ ] Edit client
- [x] Changes reflected locally

Notes:
- Created `client-6dc7dc5c-4d93-435f-949e-c3dc76e773d2`.

---

### Appointment

- [x] Create appointment
- [x] No crash/errors

Notes:
- Created `appt-11f5cdd5-8f58-456c-ab23-f9158e909f04`.

---

### Inventory (Quick Sale)

- [ ] Sale recorded
- [ ] Stock updated locally

Notes:
- Not executed in this rehearsal run.

---

## Offline Test

- [x] Internet effectively unavailable for backend
- [x] Client created offline
- [x] Appointment created offline
- [ ] UI shows "Saved locally • syncing…"

Notes:
- API behavior confirmed; visual UI text not captured in this API-only run.

---

## Reconnect Sync

- [ ] Internet restored
- [ ] Sync triggered automatically
- [ ] No duplicate records
- [ ] Status returns to "SYNCED"

Notes:
- Blocked by backend not reachable.

---

## Conflict Handling (if occurred)

- [ ] Conflict appeared in UI
- [ ] User understood issue
- [ ] Resolution action worked

Type:
Resolution:

Notes:
- Not executed in this rehearsal run.

---

## Backup

- [x] Backup exported
- [x] File exists and is non-zero size

Path:
`C:\Users\hp\Documents\New project\pharmasync-desktop\runtime\backups\pharmasync-backup-2026-03-28T22-36-08-589Z.db`

File Size:
`172032`

---

## User Feedback

- Did the user hesitate at any point?
  - Not applicable (automated local rehearsal)

- Did they ask "Did it save?"
  - Not applicable (automated local rehearsal)

- What confused them?
  - Not applicable (automated local rehearsal)

---

## Issues (if any)

| Severity | Description | Action |
|---------|------------|--------|
| P0 | Backend unreachable; no authenticated sync path | Deploy backend on Render and retest |

---

## Final Status

- [ ] System usable
- [ ] Operator confident
- [ ] Ready for Day 2 use

---

## Go / No-Go

Decision: `No-Go`
Reason: Live backend deployment and authenticated sync verification are not complete.

