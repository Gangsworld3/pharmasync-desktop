# Chaos Test Matrix

This matrix validates sync invariants under failure, not endpoint availability.

## Invariants

- No lost operations
- No duplicate effects
- No invalid state transitions
- Eventual convergence
- Deterministic retry scheduling

## Matrix

| Area | Scenario | Injection | Expected invariant |
|---|---|---|---|
| Network | Full offline | Drop outbound traffic | Operations move to `RETRY_SCHEDULED`, nothing lost |
| Network | Flaky network | Partial request failures | Retries increase, no duplicate effects |
| Network | Mid-batch cut | Fail after first batch | Partial success preserved; retry resumes remainder |
| Backend | Periodic 500 | Every nth push fails | Backoff works, no dead-letter before max attempts |
| Backend | Partial success | Success followed by error | Idempotency prevents duplicate writes |
| Concurrency | Parallel sync | Same entity from two devices | Conflict generated with deterministic metadata |
| Client | Crash mid-sync | Force `IN_PROGRESS` then restart | Recovery to `RETRY_SCHEDULED`, replay once |
| Data integrity | Retry storm | Repeated retry pressure | No duplicate effects |
| Data integrity | Max retry reached | Exceed attempt cap | `DEAD_LETTER` reached, no infinite loop |
| Time model | Timezone edge | Offset-sensitive slot data | Offset-aware slot metadata remains deterministic |

## Execution

- Full desktop chaos run:
  - `npm run test:desktop-chaos`
- Matrix-only run:
  - `npm run test:desktop-chaos-matrix`
- Large replay simulation (1000+ operations by default):
  - `npm run simulate:sync`
  - Optional overrides:
    - `npm run simulate:sync -- --ops 5000 --batchSize 50 --failEvery 13 --throwRate 0.05 --conflictRate 0.03`
  - Profiles:
    - `npm run simulate:sync:high-failure`
    - `npm run simulate:sync:high-conflict`
    - `npm run simulate:sync:latency`

## CI Guardrail Thresholds

The simulation exits non-zero when thresholds are violated:

```json
{
  "maxDeadLetter": 0,
  "maxDuplicate": 0,
  "minSuccessRate": 0.95
}
```

Override thresholds per run:

- `--maxDeadLetter <int>`
- `--maxDuplicate <int>`
- `--minSuccessRate <0..1>`

## CI Reliability Gates

GitHub Actions reliability gate workflow:

- [reliability-gates.yml](C:/Users/hp/Documents/GitHub/pharmasync-desktop/.github/workflows/reliability-gates.yml)

Profiles enforced in CI:

- `default` with `minSuccessRate=0.95`
- `high-failure` with `minSuccessRate=0.85`
- `high-conflict` with `minSuccessRate=0.70`
- `latency` with `minSuccessRate=0.95`

All CI profiles enforce:

- `maxDeadLetter=0`
- `maxDuplicate=0`

### Drift Regression Gate

CI also compares current profile metrics to per-profile baselines in:

- [ci-baselines/default.json](C:/Users/hp/Documents/GitHub/pharmasync-desktop/ci-baselines/default.json)
- [ci-baselines/high-failure.json](C:/Users/hp/Documents/GitHub/pharmasync-desktop/ci-baselines/high-failure.json)
- [ci-baselines/high-conflict.json](C:/Users/hp/Documents/GitHub/pharmasync-desktop/ci-baselines/high-conflict.json)
- [ci-baselines/latency.json](C:/Users/hp/Documents/GitHub/pharmasync-desktop/ci-baselines/latency.json)

Default regression tolerance:

- `SIM_BASELINE_DROP_TOLERANCE=0.02`

Gate rule:

- fail if current `syncRate` or `successRate` drops by more than 2% vs profile baseline.

## Trend Tracking

Simulation scorecards are persisted under:

- `runs/YYYY-MM-DD-sim-<id>.json`

Use these files to track reliability drift and regressions over time.

## Scorecard

Track after each run:

```json
{
  "operationsProcessed": 0,
  "synced": 0,
  "conflicts": 0,
  "retryScheduled": 0,
  "deadLetters": 0,
  "inProgress": 0
}
```

`inProgress` must be `0` at test end.
