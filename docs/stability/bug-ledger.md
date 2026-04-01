# PharmaSync Stability Bug Ledger

Date: 2026-04-02  
Scope: behavior anomalies under stress (not crash-only defects)

## Run Set
- `npm run simulate:pharmacy-day` (failed)
- `npm run simulate:sync:high-failure` (passed thresholds)
- `npm run simulate:sync:high-conflict` (passed thresholds)
- `npm run test:desktop-chaos-matrix` (all workflows passed)
- Targeted load probe: 140 rapid `GET_SYSTEM_TRACES` IPC calls
- Targeted recovery probe: injected `db.connection.fail`, `sync.fail.rate`, `event.loop.lag`

## Ledger Entries

### BL-001: Pharmacy-Day timeout on invoice creation
- What happened:
  - `simulate:pharmacy-day` failed with Prisma `P1008` timeout during `invoice.create`.
- Evidence:
  - Error in runner output: `Operation has timed out` in `salesRepo.js` via local transaction path.
- Why the system behaved this way:
  - Local DB operation exceeded adapter timeout in long-running mixed workload path.
- Was behavior correct:
  - No. This is an operational anomaly for real usage flow.
- Immediate tuning action:
  - Increase transaction timeout budget for pharmacy-day path or split invoice creation from heavyweight operations.
  - Add dedicated timeout/retry guard around local invoice creation.
- Status: Open (P1)

### BL-002: Trace endpoint throttles under load spike
- What happened:
  - During rapid load, `GET_SYSTEM_TRACES` returned throttled payload instead of trace array.
  - Load probe results: `normal=100`, `throttle=40`, `failed=0`.
- Evidence:
  - Probe output from orchestrator stress script.
- Why the system behaved this way:
  - Decision engine uses global pressure metric; monitor endpoint is not exempt from throttle policy.
- Was behavior correct:
  - Partially. Throttling is correct; throttling observability endpoint is undesirable.
- Immediate tuning action:
  - Exempt `GET_SYSTEM_TRACES` and `GET_LEARNING_AUDIT` from throttle path.
  - Keep throttle for mutating/expensive operations.
- Status: Open (P1)

### BL-003: Recovery triggers warnings but recovery actions are no-op
- What happened:
  - Injected failures triggered `orchestrator.recovery.warn` events (`3` warnings), but no state repair occurred.
- Evidence:
  - Recovery probe output; placeholder implementation in `recovery-engine.js`.
- Why the system behaved this way:
  - Recovery methods are currently stubs (`reconnectDB`, `resetSyncQueue`, `applyBackpressure`).
- Was behavior correct:
  - No for production; yes for current scaffold stage.
- Immediate tuning action:
  - Implement concrete recovery actions incrementally:
  - DB reconnect verification + retry window
  - Sync queue reset policy with audit trail
  - Backpressure controls (request delay / cap)
- Status: Open (P0)

### BL-004: Learning audit remains empty in normal stress runs
- What happened:
  - `GET_LEARNING_AUDIT` returned array length `0` after stress probes.
- Evidence:
  - Probe output: `learningAudit.count=0`.
- Why the system behaved this way:
  - Pattern-application pipeline did not run in exercised paths, so no learning records emitted.
- Was behavior correct:
  - Technically correct; operationally weak for tuning visibility.
- Immediate tuning action:
  - Wire pattern detector + learning engine into periodic decision loop.
  - Record explicit "no-adjustment" audit events to show pipeline activity.
- Status: Open (P1)

### BL-005: Conflict storm handled correctly without data corruption
- What happened:
  - High-conflict simulation completed with no duplicates, no dead-letter, convergence achieved.
- Evidence:
  - `simulate:sync:high-conflict`:
  - `successRate=1`
  - `duplicateEffects=0`
  - `DEAD_LETTER=0`
- Why the system behaved this way:
  - Existing conflict/state/retry policies are stable in current synthetic profile.
- Was behavior correct:
  - Yes.
- Immediate tuning action:
  - Keep current conflict thresholds; monitor in real deployment before tightening.
- Status: Closed (Observed healthy)

## Tuning Plan (Refine, Do Not Expand)
- Thresholds:
  - Raise throttle pressure threshold for observability reads or exempt monitor channels.
  - Keep safe-mode instability threshold unchanged until real-user traces confirm false positives.
- Retry timing:
  - Increase local transaction timeout for invoice path used in pharmacy-day flow.
  - Keep sync retry backoff unchanged (current chaos matrix is stable).
- Safe-mode triggers:
  - Ensure safe-mode does not suppress diagnostic endpoints.

## Next Validation Pass
- Re-run:
  - `simulate:pharmacy-day`
  - `simulate:sync:high-failure`
  - Load probe with monitor endpoint exemption
- Success criteria:
  - No Prisma timeout in pharmacy-day
  - Traces endpoint always returns array under load
  - Recovery performs at least one concrete corrective action
