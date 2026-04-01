import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const renderPath = join(repoRoot, "render.yaml");
const raw = readFileSync(renderPath, "utf8");

const errors = [];
const warnings = [];

const keyMatches = [...raw.matchAll(/^\s*-\s+key:\s*(.+?)\s*$/gm)];
const keys = keyMatches.map((match) => match[1].trim());

if (keys.length === 0) {
  errors.push("render.yaml contains no envVars keys.");
}

const requiredKeys = [
  "PHARMASYNC_DATABASE_URL",
  "PHARMASYNC_JWT_SECRET",
  "PHARMASYNC_DEFAULT_ADMIN_PASSWORD",
  "ENV",
];
const forbiddenKeys = ["DATABASE_URL"];

for (const key of requiredKeys) {
  if (!keys.includes(key)) {
    errors.push(`Missing required env key: ${key}`);
  }
}

for (const key of forbiddenKeys) {
  if (keys.includes(key)) {
    errors.push(`Forbidden legacy env key present: ${key}`);
  }
}

const keyCounts = new Map();
for (const key of keys) {
  keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
}
for (const [key, count] of keyCounts.entries()) {
  if (count > 1) {
    errors.push(`Duplicate env key in render.yaml: ${key} (${count} entries)`);
  }
}

for (const key of keys) {
  if (key.includes("://") || key.includes("@")) {
    errors.push(`Malformed env key detected (looks like a URL value was used as key): ${key}`);
  }
  if (/\s/.test(key)) {
    errors.push(`Malformed env key detected (contains whitespace): ${key}`);
  }
}

if (raw.includes("postgresql://") || raw.includes("postgres://")) {
  warnings.push("render.yaml contains a raw postgres URI. Confirm it is only in values, never in key names.");
}

const deprecatedFlyWorkflow = join(repoRoot, ".github", "workflows", "fly-deploy.yml");
if (existsSync(deprecatedFlyWorkflow)) {
  errors.push("Deprecated Fly deployment workflow exists. Deployment must be Render-only.");
}

if (errors.length > 0) {
  console.error("Render config validation failed:");
  for (const message of errors) {
    console.error(`- ${message}`);
  }
  process.exit(1);
}

console.log("Render config validation passed.");
if (warnings.length > 0) {
  for (const message of warnings) {
    console.log(`warning: ${message}`);
  }
}
