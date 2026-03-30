import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const DEFAULT_SETTINGS = {
  backendUrl: process.env.PHARMASYNC_DEFAULT_BACKEND_URL ?? "https://pharmasync-backend.onrender.com",
  syncIntervalMs: 15000
};

const appRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function ensureDir(path) {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

function sqliteFileUrl(path) {
  return `file:${path.replace(/\\/g, "/")}`;
}

function migrateLegacyDatabase(dbDir, dbPath) {
  const legacyDbPath = join(appRoot, "prisma", "dev.db");
  if (existsSync(dbPath) || !existsSync(legacyDbPath)) {
    return;
  }

  ensureDir(dbDir);
  copyFileSync(legacyDbPath, dbPath);

  const legacyWal = `${legacyDbPath}-wal`;
  const legacyShm = `${legacyDbPath}-shm`;
  if (existsSync(legacyWal)) {
    copyFileSync(legacyWal, `${dbPath}-wal`);
  }
  if (existsSync(legacyShm)) {
    copyFileSync(legacyShm, `${dbPath}-shm`);
  }
}

export function getRuntimePaths() {
  const baseDir = process.env.PHARMASYNC_DATA_DIR ?? join(appRoot, "runtime");
  const logsDir = join(baseDir, "logs");
  const backupsDir = join(baseDir, "backups");
  const configPath = join(baseDir, "settings.json");
  const sessionPath = join(baseDir, "session.json");
  const dbDir = join(baseDir, "data");
  const dbPath = join(dbDir, "pharmasync.db");
  return { appRoot, baseDir, logsDir, backupsDir, configPath, sessionPath, dbDir, dbPath };
}

export function ensureRuntimeDirectories() {
  const paths = getRuntimePaths();
  ensureDir(paths.baseDir);
  ensureDir(paths.logsDir);
  ensureDir(paths.backupsDir);
  ensureDir(paths.dbDir);
  migrateLegacyDatabase(paths.dbDir, paths.dbPath);
  return paths;
}

export function getDesktopSettings() {
  const { configPath } = ensureRuntimeDirectories();
  if (!existsSync(configPath)) {
    writeFileSync(configPath, JSON.stringify(DEFAULT_SETTINGS, null, 2));
    return { ...DEFAULT_SETTINGS };
  }

  try {
    const file = JSON.parse(readFileSync(configPath, "utf8"));
    return { ...DEFAULT_SETTINGS, ...file };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveDesktopSettings(partial) {
  const next = { ...getDesktopSettings(), ...partial };
  const { configPath } = ensureRuntimeDirectories();
  writeFileSync(configPath, JSON.stringify(next, null, 2));
  return next;
}

export function exportLocalDatabase() {
  const { dbPath, backupsDir } = ensureRuntimeDirectories();
  const targetPath = join(backupsDir, `pharmasync-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
  const db = new Database(dbPath);
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.exec(`VACUUM INTO '${targetPath.replace(/'/g, "''")}'`);
  db.close();
  return targetPath;
}

export function appendDesktopLog(fileName, message) {
  const { logsDir } = ensureRuntimeDirectories();
  appendFileSync(join(logsDir, fileName), `[${new Date().toISOString()}] ${message}\n`);
}

export function appendDesktopJsonLog(fileName, payload) {
  const { logsDir } = ensureRuntimeDirectories();
  appendFileSync(join(logsDir, fileName), `${JSON.stringify(payload)}\n`);
}

export function getDatabasePath() {
  return ensureRuntimeDirectories().dbPath;
}

export function getDatabaseUrl() {
  return sqliteFileUrl(getDatabasePath());
}

export function getDesktopSession() {
  const { sessionPath } = ensureRuntimeDirectories();
  if (!existsSync(sessionPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(sessionPath, "utf8"));
  } catch {
    return null;
  }
}

export function saveDesktopSession(session) {
  const { sessionPath } = ensureRuntimeDirectories();
  writeFileSync(sessionPath, JSON.stringify(session, null, 2));
  return session;
}

export function clearDesktopSession() {
  const { sessionPath } = ensureRuntimeDirectories();
  writeFileSync(sessionPath, JSON.stringify({}, null, 2));
}
