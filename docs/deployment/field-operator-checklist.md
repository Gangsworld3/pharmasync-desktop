# Field Operator Checklist (1 Page)

Use this checklist onsite for first deployment.

## Before Arrival

- installer available: `PharmaSync Desktop Setup 1.0.0.exe`
- portable fallback available: `PharmaSync Desktop 1.0.0.exe`
- backend URL confirmed and reachable
- test login confirmed
- external backup destination ready (USB or secure folder)

## Onsite Setup

- install app on device 1
- install app on device 2
- open app and verify first launch
- configure backend URL in settings
- sign in on both devices
- run first sync on both devices

## Functional Test

- create one client
- create one appointment
- confirm sync status reaches `SYNCED`
- disable internet
- edit client while offline
- confirm user sees local-save feedback
- reconnect internet
- confirm pending changes clear

## Data Safety Test

- export database backup from settings
- confirm `.db` file exists and size is greater than 0
- verify `runtime/logs/sync.log` exists
- verify `runtime/logs/error.log` exists

## Exit Check

- both devices show `SYNCED` at least once
- no unresolved critical conflicts
- backup file copied off-device
- site admin confirms confidence in daily use

## Operator Record

| Item | Result (Pass/Fail) | Notes |
|---|---|---|
| Device 1 install |  |  |
| Device 2 install |  |  |
| First sync complete |  |  |
| Offline edit + reconnect |  |  |
| Backup export |  |  |
| Logs present |  |  |
| Final sync healthy |  |  |

