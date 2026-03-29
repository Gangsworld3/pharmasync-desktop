import "../src/db/init-sqlite.js";

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { prisma } from "../src/db/client.js";
import { appendLocalOperation, ensureDeviceState } from "../src/db/repositories.js";
import { pushPendingChanges } from "../src/services/sync-engine.js";
import { saveDesktopSession } from "../src/services/desktop-runtime.js";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith("--")) {
      continue;
    }
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      args[key.slice(2)] = "true";
      continue;
    }
    args[key.slice(2)] = value;
    i += 1;
  }
  return args;
}

function toInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toFloat(value, fallback) {
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bounded(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function buildConfig() {
  const args = parseArgs(process.argv.slice(2));
  const profile = String(args.profile ?? process.env.SIM_PROFILE ?? "default").toLowerCase();
  const profileDefaults = resolveProfileDefaults(profile);
  const thresholdDefaults = resolveProfileThresholds(profile);

  return {
    profile,
    operations: bounded(
      toInt(args.ops ?? process.env.SIM_OPS, profileDefaults.operations),
      1000,
      200000
    ),
    seed: toInt(args.seed ?? process.env.SIM_SEED, Date.now()),
    batchSize: bounded(toInt(args.batchSize ?? process.env.SIM_BATCH_SIZE, profileDefaults.batchSize), 1, 500),
    maxCycles: bounded(toInt(args.maxCycles ?? process.env.SIM_MAX_CYCLES, profileDefaults.maxCycles), 1, 5000),
    failEvery: bounded(toInt(args.failEvery ?? process.env.SIM_FAIL_EVERY, profileDefaults.failEvery), 0, 1000),
    throwRate: bounded(toFloat(args.throwRate ?? process.env.SIM_THROW_RATE, profileDefaults.throwRate), 0, 1),
    conflictRate: bounded(toFloat(args.conflictRate ?? process.env.SIM_CONFLICT_RATE, profileDefaults.conflictRate), 0, 1),
    cleanup: String(args.cleanup ?? process.env.SIM_CLEANUP ?? "false").toLowerCase() === "true",
    writeRuns: String(args.writeRuns ?? process.env.SIM_WRITE_RUNS ?? "true").toLowerCase() !== "false",
    thresholds: {
      maxDeadLetter: bounded(
        toInt(args.maxDeadLetter ?? process.env.SIM_MAX_DEAD_LETTER, thresholdDefaults.maxDeadLetter),
        0,
        200000
      ),
      maxDuplicate: bounded(
        toInt(args.maxDuplicate ?? process.env.SIM_MAX_DUPLICATE, thresholdDefaults.maxDuplicate),
        0,
        200000
      ),
      minSuccessRate: bounded(
        toFloat(args.minSuccessRate ?? process.env.SIM_MIN_SUCCESS_RATE, thresholdDefaults.minSuccessRate),
        0,
        1
      ),
    },
    baseline: {
      enforce: String(args.enforceBaseline ?? process.env.SIM_ENFORCE_BASELINE ?? "true").toLowerCase() !== "false",
      file: String(args.baselineFile ?? process.env.SIM_BASELINE_FILE ?? ".ci/reliability-baseline.json"),
      dropTolerance: bounded(
        toFloat(args.baselineDropTolerance ?? process.env.SIM_BASELINE_DROP_TOLERANCE, 0.02),
        0,
        1
      ),
    },
  };
}

function resolveProfileDefaults(profile) {
  const defaults = {
    default: {
      operations: 1200,
      batchSize: 25,
      maxCycles: 120,
      failEvery: 11,
      throwRate: 0.03,
      conflictRate: 0.04,
    },
    "high-failure": {
      operations: 1200,
      batchSize: 20,
      maxCycles: 200,
      failEvery: 4,
      throwRate: 0.12,
      conflictRate: 0.04,
    },
    "high-conflict": {
      operations: 1200,
      batchSize: 25,
      maxCycles: 200,
      failEvery: 11,
      throwRate: 0.03,
      conflictRate: 0.22,
    },
    latency: {
      operations: 1200,
      batchSize: 15,
      maxCycles: 220,
      failEvery: 0,
      throwRate: 0.0,
      conflictRate: 0.04,
    },
  };
  return defaults[profile] ?? defaults.default;
}

function resolveProfileThresholds(profile) {
  const defaults = {
    default: { maxDeadLetter: 0, maxDuplicate: 0, minSuccessRate: 0.95 },
    "high-failure": { maxDeadLetter: 0, maxDuplicate: 0, minSuccessRate: 0.85 },
    "high-conflict": { maxDeadLetter: 0, maxDuplicate: 0, minSuccessRate: 0.70 },
    latency: { maxDeadLetter: 0, maxDuplicate: 0, minSuccessRate: 0.95 },
  };
  return defaults[profile] ?? defaults.default;
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function buildIdempotencyKey(operationId, entityId, operation) {
  return createHash("sha256")
    .update(`${operationId}|${entityId}|${operation}`)
    .digest("hex");
}

async function seedOperations(prefix, total) {
  for (let index = 0; index < total; index += 1) {
    const operationId = `${prefix}-op-${index}`;
    const entityId = `${prefix}-inv-${index % 150}`;
    const payload = {
      sku: `${prefix}-SKU-${index % 150}`,
      name: `Simulation Item ${index % 150}`,
      category: "Simulation",
      quantity_on_hand: Number(1000 - (index % 37)),
      reorder_level: 10,
      unit_cost_minor: 100,
      sale_price_minor: 150,
      batch_number: `${prefix}-BATCH-${Math.floor(index / 150)}`,
      expires_on: "2027-12-31T00:00:00Z"
    };

    await appendLocalOperation({
      operationId,
      idempotencyKey: buildIdempotencyKey(operationId, entityId, "UPDATE"),
      entityType: "InventoryItem",
      entityId,
      operation: "UPDATE",
      localRevision: 1,
      payload,
      status: "PENDING",
    });
  }
}

function makeConflict(change, revision) {
  return {
    type: "SIMULATED_CONFLICT",
    entityId: change.entityId,
    local: {
      operationId: change.operationId,
      data: change.data,
    },
    server: {
      server_revision: revision,
      quantity_on_hand: Math.max(0, Number(change?.data?.quantity_on_hand ?? 0) - 1),
    },
    serverRevision: revision,
    resolution: "Manual resolution required in simulation",
  };
}

async function countByStatus(prefix) {
  const rows = await prisma.localOperation.groupBy({
    by: ["status"],
    where: { operationId: { startsWith: `${prefix}-` } },
    _count: { status: true },
  });

  const out = {
    PENDING: 0,
    RETRY: 0,
    RETRY_SCHEDULED: 0,
    IN_PROGRESS: 0,
    SYNCED: 0,
    CONFLICT: 0,
    DEAD_LETTER: 0,
  };

  for (const row of rows) {
    out[row.status] = row._count.status;
  }
  return out;
}

async function run() {
  const config = buildConfig();
  const prefix = `sim-${Date.now()}`;
  const rng = mulberry32(config.seed);

  process.env.PHARMASYNC_SYNC_PUSH_BATCH_SIZE = String(config.batchSize);
  process.env.PHARMASYNC_SYNC_REQUEST_RETRIES = "1";
  process.env.PHARMASYNC_SYNC_RETRY_BASE_MS = "5";
  process.env.PHARMASYNC_SYNC_RETRY_MAX_MS = "50";
  process.env.PHARMASYNC_SYNC_MAX_OPERATION_ATTEMPTS = "12";

  saveDesktopSession({ accessToken: "simulation-token", email: "simulation@local" });
  await ensureDeviceState();
  await seedOperations(prefix, config.operations);

  let requestCount = 0;
  let revision = 0;
  let thrownRequests = 0;
  let httpFailures = 0;
  let responseConflicts = 0;
  let responseApplied = 0;
  let responseReplays = 0;
  const effectByIdempotencyKey = new Set();
  let duplicateEffects = 0;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (!String(url).includes("/sync/push")) {
      throw new Error(`Unexpected URL in simulation: ${url}`);
    }
    if (String(url).includes("/sync/pull")) {
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: { serverChanges: [] }, meta: { revision } }),
      };
    }

    requestCount += 1;

    if (config.profile === "latency") {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    if (rng() < config.throwRate) {
      thrownRequests += 1;
      throw new TypeError("simulated network throw");
    }

    if (config.failEvery > 0 && requestCount % config.failEvery === 0) {
      httpFailures += 1;
      return {
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ error: "simulated 500" }),
      };
    }

    const body = JSON.parse(String(init.body ?? "{}"));
    const changes = Array.isArray(body.changes) ? body.changes : [];
    const results = [];
    const conflicts = [];

    for (const change of changes) {
      const idempotencyKey = change.idempotencyKey ?? change.operationId;
      if (rng() < config.conflictRate) {
        responseConflicts += 1;
        results.push({ operationId: change.operationId, status: "CONFLICT" });
        conflicts.push(makeConflict(change, revision + 1));
        continue;
      }

      if (effectByIdempotencyKey.has(idempotencyKey)) {
        responseReplays += 1;
        results.push({ operationId: change.operationId, status: "IDEMPOTENT_REPLAY" });
      } else {
        effectByIdempotencyKey.add(idempotencyKey);
        responseApplied += 1;
        results.push({ operationId: change.operationId, status: "APPLIED" });
      }
    }

    revision += 1;
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          data: { results, conflicts, serverChanges: [] },
          meta: { revision },
        }),
    };
  };

  let cycles = 0;
  let hardFailures = 0;

  try {
    for (; cycles < config.maxCycles; cycles += 1) {
      try {
        await pushPendingChanges();
      } catch {
        hardFailures += 1;
      }

      await prisma.localOperation.updateMany({
        where: {
          operationId: { startsWith: `${prefix}-` },
          status: "RETRY_SCHEDULED",
        },
        data: { nextAttemptAt: new Date() },
      });

      const counts = await countByStatus(prefix);
      const remaining =
        counts.PENDING + counts.RETRY + counts.RETRY_SCHEDULED + counts.IN_PROGRESS;

      if (remaining === 0) {
        break;
      }
    }

    const counts = await countByStatus(prefix);
    duplicateEffects = responseApplied - effectByIdempotencyKey.size;
    const total = config.operations;
    const successRate = total > 0 ? (counts.SYNCED + counts.CONFLICT) / total : 0;
    const thresholdViolations = [];
    if (counts.DEAD_LETTER > config.thresholds.maxDeadLetter) {
      thresholdViolations.push(
        `dead_letter=${counts.DEAD_LETTER} exceeds maxDeadLetter=${config.thresholds.maxDeadLetter}`
      );
    }
    if (duplicateEffects > config.thresholds.maxDuplicate) {
      thresholdViolations.push(
        `duplicate_effects=${duplicateEffects} exceeds maxDuplicate=${config.thresholds.maxDuplicate}`
      );
    }
    if (successRate < config.thresholds.minSuccessRate) {
      thresholdViolations.push(
        `success_rate=${successRate.toFixed(4)} below minSuccessRate=${config.thresholds.minSuccessRate}`
      );
    }

    const syncRate = total > 0 ? counts.SYNCED / total : 0;
    const finalConflictRate = total > 0 ? counts.CONFLICT / total : 0;
    const scorecard = {
      prefix,
      config,
      cyclesExecuted: cycles + 1,
      requests: {
        total: requestCount,
        thrown: thrownRequests,
        http500: httpFailures,
        hardFailures,
      },
      outcomes: {
        appliedResponses: responseApplied,
        replayResponses: responseReplays,
        conflictResponses: responseConflicts,
      },
      operationStatus: counts,
      rates: {
        successRate,
        syncRate,
        finalConflictRate,
      },
      thresholds: {
        ...config.thresholds,
      },
      thresholdViolations,
      invariants: {
        noDuplicateEffects: duplicateEffects === 0,
        duplicateEffects,
        noInProgressLeft: counts.IN_PROGRESS === 0,
        eventualConvergence:
          counts.PENDING + counts.RETRY + counts.RETRY_SCHEDULED + counts.IN_PROGRESS === 0,
      },
    };

    const currentFilePath = fileURLToPath(import.meta.url);
    const repoRoot = path.resolve(path.dirname(currentFilePath), "..");
    if (config.baseline.enforce) {
      const baselinePath = path.resolve(repoRoot, config.baseline.file);
      try {
        const raw = await readFile(baselinePath, "utf8");
        const baselineDoc = JSON.parse(raw);
        const baselineProfiles = baselineDoc?.profiles ?? {};
        const baseline = baselineProfiles[config.profile];
        if (baseline && typeof baseline.syncRate === "number") {
          if (syncRate < baseline.syncRate - config.baseline.dropTolerance) {
            thresholdViolations.push(
              `regression_sync_rate=${syncRate.toFixed(4)} below baseline=${baseline.syncRate.toFixed(4)} by > ${config.baseline.dropTolerance}`
            );
          }
        }
        if (baseline && typeof baseline.successRate === "number") {
          if (successRate < baseline.successRate - config.baseline.dropTolerance) {
            thresholdViolations.push(
              `regression_success_rate=${successRate.toFixed(4)} below baseline=${baseline.successRate.toFixed(4)} by > ${config.baseline.dropTolerance}`
            );
          }
        }
        scorecard.baseline = {
          file: path.relative(repoRoot, baselinePath).replace(/\\/g, "/"),
          dropTolerance: config.baseline.dropTolerance,
          profile: config.profile,
          reference: baseline ?? null,
        };
      } catch (error) {
        thresholdViolations.push(`baseline_read_error=${String(error?.message ?? error)}`);
      }
    }

    if (config.writeRuns) {
      const runsDir = path.join(repoRoot, "runs");
      await mkdir(runsDir, { recursive: true });
      const runFilePath = path.join(runsDir, `${new Date().toISOString().slice(0, 10)}-${prefix}.json`);
      await writeFile(runFilePath, JSON.stringify(scorecard, null, 2), "utf8");
      scorecard.runFile = path.relative(repoRoot, runFilePath).replace(/\\/g, "/");
    }

    console.log(JSON.stringify(scorecard, null, 2));
    if (thresholdViolations.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (config.cleanup) {
      await prisma.localOperation.deleteMany({
        where: { operationId: { startsWith: `${prefix}-` } },
      });
    }
    await prisma.$disconnect();
  }
}

run().catch(async (error) => {
  console.error("Simulation runner failed:", error);
  try {
    await prisma.$disconnect();
  } catch {
    // ignore
  }
  process.exitCode = 1;
});
