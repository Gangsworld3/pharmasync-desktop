import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const srcDir = path.join(rootDir, "src");

function listFilesRecursively(dirPath) {
  const result = [];
  const stack = [dirPath];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (/\.(js|mjs|cjs|ts|tsx|jsx)$/.test(entry.name)) {
        result.push(full);
      }
    }
  }

  return result;
}

function parseImports(source) {
  const imports = [];
  const importRegex = /import\s+(?:[^"'`]*?\s+from\s+)?["'`]([^"'`]+)["'`]/g;
  const exportFromRegex = /export\s+[^"'`]*?\s+from\s+["'`]([^"'`]+)["'`]/g;
  const dynamicImportRegex = /import\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g;

  for (const regex of [importRegex, exportFromRegex, dynamicImportRegex]) {
    let match = regex.exec(source);
    while (match) {
      imports.push(match[1]);
      match = regex.exec(source);
    }
  }

  return imports;
}

function resolveLocalImport(fromFile, specifier) {
  if (!specifier.startsWith(".")) {
    return null;
  }

  const raw = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    raw,
    `${raw}.js`,
    `${raw}.mjs`,
    `${raw}.cjs`,
    `${raw}.ts`,
    `${raw}.tsx`,
    `${raw}.jsx`,
    path.join(raw, "index.js"),
    path.join(raw, "index.mjs"),
    path.join(raw, "index.ts")
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

function getLayer(absFilePath) {
  const relative = path.relative(srcDir, absFilePath).split(path.sep);
  const first = relative[0];

  if (first === "application") return "application";
  if (first === "domain") return "domain";
  if (first === "infrastructure") return "infrastructure";
  if (first === "services" || first === "db") return "infrastructure";
  return null;
}

function getApplicationModuleNamespace(absFilePath) {
  const relative = path.relative(srcDir, absFilePath).split(path.sep);
  if (relative[0] !== "application") {
    return null;
  }
  return relative.length >= 3 ? relative[1] : "__root__";
}

function isAllowedImport(fromLayer, toLayer) {
  if (!fromLayer || !toLayer) {
    return true;
  }

  const allowed = {
    application: new Set(["application", "domain", "infrastructure"]),
    domain: new Set(["domain"]),
    infrastructure: new Set(["domain", "infrastructure"])
  };
  const allowedTargets = allowed[fromLayer];
  return allowedTargets ? allowedTargets.has(toLayer) : true;
}

function detectCycles(graph) {
  const visited = new Set();
  const active = new Set();
  const pathStack = [];
  const cycles = [];

  function dfs(node) {
    visited.add(node);
    active.add(node);
    pathStack.push(node);

    for (const next of graph.get(node) ?? []) {
      if (!visited.has(next)) {
        dfs(next);
        continue;
      }
      if (active.has(next)) {
        const start = pathStack.indexOf(next);
        if (start >= 0) {
          cycles.push(pathStack.slice(start).concat(next));
        }
      }
    }

    pathStack.pop();
    active.delete(node);
  }

  for (const node of graph.keys()) {
    if (!visited.has(node)) {
      dfs(node);
    }
  }

  return cycles;
}

function toRelative(absPath) {
  return path.relative(rootDir, absPath).replaceAll("\\", "/");
}

function main() {
  const files = listFilesRecursively(srcDir);
  const graph = new Map();
  const violations = [];

  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const imports = parseImports(source);
    const resolvedDeps = [];

    for (const specifier of imports) {
      const resolved = resolveLocalImport(file, specifier);
      if (!resolved || !resolved.startsWith(srcDir)) {
        continue;
      }

      resolvedDeps.push(resolved);

      const fromLayer = getLayer(file);
      const toLayer = getLayer(resolved);
      if (!isAllowedImport(fromLayer, toLayer)) {
        violations.push(
          `layer violation: ${toRelative(file)} (${fromLayer}) -> ${toRelative(resolved)} (${toLayer})`
        );
      }

      if (fromLayer === "application" && toLayer === "application") {
        const fromNs = getApplicationModuleNamespace(file);
        const toNs = getApplicationModuleNamespace(resolved);
        if (fromNs && toNs && fromNs !== "__root__" && toNs !== "__root__" && fromNs !== toNs) {
          violations.push(
            `application cross-module deep import: ${toRelative(file)} -> ${toRelative(resolved)}`
          );
        }
      }
    }

    graph.set(file, resolvedDeps);
  }

  const cycles = detectCycles(graph);
  for (const cycle of cycles) {
    violations.push(`circular dependency: ${cycle.map(toRelative).join(" -> ")}`);
  }

  if (violations.length > 0) {
    for (const item of violations) {
      console.error(`ARCHITECTURE VIOLATION: ${item}`);
    }
    process.exit(1);
  }

  console.log("Architecture Guard: PASS");
}

main();
