# Pilot Rollout Workflow

This runbook defines how to deploy PharmaSync Desktop to initial real users safely.

## Pilot Goals

1. confirm day-to-day usability in low-connectivity conditions
2. validate sync reliability across at least 2 devices per pilot site
3. prove backup and recovery operations with local staff

## Pilot Scope

- sites: 1 to 2 pharmacies/clinics
- users per site: 2 to 4
- devices per site: minimum 2
- duration: 14 days

## Roles

- Pilot Lead: approves go/no-go decisions
- Field Operator: performs install, training, and daily check-ins
- Support Engineer: triages logs, sync errors, and conflicts
- Site Admin: local business owner or supervisor

## Entry Criteria (Must Be True Before Day 1)

- clean-machine validation passed (`P0` all green)
- backend HTTPS endpoint stable for 72h
- backup export tested on current build
- support channel defined (phone/WhatsApp/email)

## Rollout Phases

### Phase A: Preparation (Day -3 to Day 0)

1. provision site accounts and credentials
2. preconfigure backend URL and sync interval defaults
3. prepare installer and portable fallback
4. print one-page quick-start sheet

Deliverables:

- site readiness checklist signed by Pilot Lead
- artifact bundle:
  - installer `.exe`
  - portable `.exe`
  - release notes

### Phase B: Onsite Onboarding (Day 1)

1. install on primary and secondary devices
2. verify login and first sync
3. train staff on:
   - client create/edit
   - appointment scheduling
   - conflict center
   - backup export

Required drill:

- offline create/edit workflow
- reconnect sync workflow

### Phase C: Assisted Operation (Day 2 to Day 4)

1. daily check-in (15-20 min)
2. collect logs and user friction points
3. resolve any `P0/P1` issue within same day

### Phase D: Monitored Operation (Day 5 to Day 14)

1. check-ins every 2 days
2. review operational metrics
3. run final backup/restore drill

## Operational Metrics

Track these at minimum:

- sync success rate (`target >= 98%`)
- unresolved conflict count (`target = 0 P0, <= 3 P1`)
- data-loss incidents (`target = 0`)
- median app startup time (`target <= 15s`)
- backup completion rate (`target = daily`)

## Incident Handling

### Severity

- `P0`: data loss, startup failure, unrecoverable sync corruption
- `P1`: repeated sync failures, unresolved conflicts blocking workflow
- `P2`: UX friction without data risk

### Response SLA

- `P0`: response in 30 minutes, mitigation same day
- `P1`: response in 4 hours, fix within 24 hours
- `P2`: backlog for next pilot patch

### Immediate Actions for `P0`

1. stop new writes on affected device
2. export backup immediately
3. collect logs:
   - `runtime/logs/error.log`
   - `runtime/logs/sync.log`
4. recover from last known good backup if required

## Daily Pilot Checklist

| Item | Owner | Complete |
|---|---|---|
| Verify app launches on all pilot devices | Site Admin |  |
| Confirm sync status reaches `SYNCED` at least once | Site Admin |  |
| Export backup and copy off-device | Site Admin |  |
| Review unresolved conflicts | Field Operator |  |
| Review logs for repeated errors | Support Engineer |  |

## Exit Criteria (Go/No-Go for Wider Deployment)

Go only if all are true:

- zero `P0` incidents in final 7 days
- no unresolved critical conflicts
- backup drill successful at each site
- users can complete core daily tasks without support intervention

No-Go if any are true:

- any unrecovered data-loss incident
- repeated startup failure pattern
- sync convergence not reliable across devices

## Post-Pilot Artifacts

- pilot findings report
- prioritized fix list (`P0/P1/P2`)
- updated training material
- rollout decision memo (`Go`, `Go with constraints`, `No-Go`)

