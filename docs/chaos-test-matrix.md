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
