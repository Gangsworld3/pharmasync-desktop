import Database from "better-sqlite3";
import { getDatabasePath } from "../services/desktop-runtime.js";

const databasePath = getDatabasePath();
const db = new Database(databasePath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS Client (
    id TEXT PRIMARY KEY,
    clientCode TEXT NOT NULL UNIQUE,
    fullName TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    preferredLanguage TEXT NOT NULL DEFAULT 'en',
    city TEXT,
    notes TEXT,
    dirty INTEGER NOT NULL DEFAULT 1,
    syncStatus TEXT NOT NULL DEFAULT 'PENDING',
    localRevision INTEGER NOT NULL DEFAULT 1,
    serverRevision INTEGER NOT NULL DEFAULT 0,
    lastSyncedAt DATETIME,
    lastModifiedLocally DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS Invoice (
    id TEXT PRIMARY KEY,
    invoiceNumber TEXT NOT NULL UNIQUE,
    clientId TEXT,
    currencyCode TEXT NOT NULL DEFAULT 'SSP',
    totalMinor INTEGER NOT NULL,
    balanceDueMinor INTEGER NOT NULL,
    paymentMethod TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT',
    issuedAt DATETIME,
    dirty INTEGER NOT NULL DEFAULT 1,
    syncStatus TEXT NOT NULL DEFAULT 'PENDING',
    localRevision INTEGER NOT NULL DEFAULT 1,
    serverRevision INTEGER NOT NULL DEFAULT 0,
    lastSyncedAt DATETIME,
    lastModifiedLocally DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (clientId) REFERENCES Client(id)
  );

  CREATE TABLE IF NOT EXISTS InventoryItem (
    id TEXT PRIMARY KEY,
    sku TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    quantityOnHand REAL NOT NULL DEFAULT 0,
    reorderLevel REAL NOT NULL DEFAULT 0,
    unitCostMinor INTEGER NOT NULL DEFAULT 0,
    salePriceMinor INTEGER NOT NULL DEFAULT 0,
    batchNumber TEXT,
    expiresOn DATETIME,
    dirty INTEGER NOT NULL DEFAULT 1,
    syncStatus TEXT NOT NULL DEFAULT 'PENDING',
    localRevision INTEGER NOT NULL DEFAULT 1,
    serverRevision INTEGER NOT NULL DEFAULT 0,
    lastSyncedAt DATETIME,
    lastModifiedLocally DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS Appointment (
    id TEXT PRIMARY KEY,
    clientId TEXT NOT NULL,
    serviceType TEXT NOT NULL,
    staffName TEXT,
    startsAt DATETIME NOT NULL,
    endsAt DATETIME NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    reminderSentAt DATETIME,
    notes TEXT,
    dirty INTEGER NOT NULL DEFAULT 1,
    syncStatus TEXT NOT NULL DEFAULT 'PENDING',
    localRevision INTEGER NOT NULL DEFAULT 1,
    serverRevision INTEGER NOT NULL DEFAULT 0,
    lastSyncedAt DATETIME,
    lastModifiedLocally DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (clientId) REFERENCES Client(id)
  );

  CREATE TABLE IF NOT EXISTS Message (
    id TEXT PRIMARY KEY,
    clientId TEXT,
    channel TEXT NOT NULL DEFAULT 'SMS',
    direction TEXT NOT NULL,
    recipient TEXT,
    body TEXT NOT NULL,
    deliveryStatus TEXT NOT NULL DEFAULT 'queued',
    sentAt DATETIME,
    conversationId TEXT,
    senderId TEXT,
    dirty INTEGER NOT NULL DEFAULT 1,
    syncStatus TEXT NOT NULL DEFAULT 'PENDING',
    localRevision INTEGER NOT NULL DEFAULT 1,
    serverRevision INTEGER NOT NULL DEFAULT 0,
    lastSyncedAt DATETIME,
    lastModifiedLocally DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (clientId) REFERENCES Client(id)
  );

  CREATE TABLE IF NOT EXISTS SyncQueue (
    id TEXT PRIMARY KEY,
    entityType TEXT NOT NULL,
    entityId TEXT NOT NULL,
    operation TEXT NOT NULL,
    payloadJson TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    attempts INTEGER NOT NULL DEFAULT 0,
    lastAttemptAt DATETIME,
    nextRetryAt DATETIME,
    conflictReason TEXT,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS AuditLog (
    id TEXT PRIMARY KEY,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    entityType TEXT NOT NULL,
    entityId TEXT NOT NULL,
    detailsJson TEXT,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS DeviceState (
    id TEXT PRIMARY KEY,
    deviceId TEXT NOT NULL UNIQUE,
    lastPulledRevision INTEGER NOT NULL DEFAULT 0,
    syncStatus TEXT NOT NULL DEFAULT 'IDLE',
    lastSyncStartedAt DATETIME,
    lastSyncCompletedAt DATETIME,
    lastSyncError TEXT,
    remoteBaseUrl TEXT,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS LocalOperation (
    id TEXT PRIMARY KEY,
    operationId TEXT NOT NULL UNIQUE,
    idempotencyKey TEXT UNIQUE,
    entityType TEXT NOT NULL,
    entityId TEXT NOT NULL,
    operation TEXT NOT NULL,
    payloadJson TEXT NOT NULL,
    localRevision INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'PENDING',
    conflictPayloadJson TEXT,
    errorDetail TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    lastAttemptAt DATETIME,
    nextAttemptAt DATETIME,
    backoffMs INTEGER NOT NULL DEFAULT 0,
    deadLetteredAt DATETIME,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_invoice_clientId ON Invoice(clientId);
  CREATE INDEX IF NOT EXISTS idx_appointment_clientId ON Appointment(clientId);
  CREATE INDEX IF NOT EXISTS idx_message_clientId ON Message(clientId);
  CREATE INDEX IF NOT EXISTS idx_inventory_reorderLevel ON InventoryItem(reorderLevel);
  CREATE INDEX IF NOT EXISTS idx_syncqueue_status ON SyncQueue(status, nextRetryAt);
  CREATE INDEX IF NOT EXISTS idx_auditlog_entity ON AuditLog(entityType, entityId);
  CREATE INDEX IF NOT EXISTS idx_localoperation_status ON LocalOperation(status, createdAt);
`);

ensureColumn("Client", "deletedAt", "DATETIME");
ensureColumn("Client", "serverRevision", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("Client", "lastModifiedLocally", "DATETIME");
ensureColumn("Invoice", "deletedAt", "DATETIME");
ensureColumn("Invoice", "serverRevision", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("Invoice", "lastModifiedLocally", "DATETIME");
ensureColumn("InventoryItem", "deletedAt", "DATETIME");
ensureColumn("InventoryItem", "serverRevision", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("InventoryItem", "lastModifiedLocally", "DATETIME");
ensureColumn("Appointment", "deletedAt", "DATETIME");
ensureColumn("Appointment", "serverRevision", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("Appointment", "lastModifiedLocally", "DATETIME");
ensureColumn("Message", "deletedAt", "DATETIME");
ensureColumn("Message", "conversationId", "TEXT");
ensureColumn("Message", "senderId", "TEXT");
ensureColumn("Message", "serverRevision", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("Message", "lastModifiedLocally", "DATETIME");
ensureColumn("LocalOperation", "idempotencyKey", "TEXT");
ensureColumn("LocalOperation", "nextAttemptAt", "DATETIME");
ensureColumn("LocalOperation", "backoffMs", "INTEGER NOT NULL DEFAULT 0");
ensureColumn("LocalOperation", "deadLetteredAt", "DATETIME");

db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_localoperation_idempotency ON LocalOperation(idempotencyKey) WHERE idempotencyKey IS NOT NULL;`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_localoperation_retry ON LocalOperation(status, nextAttemptAt);`);

db.exec(`
  UPDATE Client SET lastModifiedLocally = COALESCE(lastModifiedLocally, CURRENT_TIMESTAMP);
  UPDATE Invoice SET lastModifiedLocally = COALESCE(lastModifiedLocally, CURRENT_TIMESTAMP);
  UPDATE InventoryItem SET lastModifiedLocally = COALESCE(lastModifiedLocally, CURRENT_TIMESTAMP);
  UPDATE Appointment SET lastModifiedLocally = COALESCE(lastModifiedLocally, CURRENT_TIMESTAMP);
  UPDATE Message SET lastModifiedLocally = COALESCE(lastModifiedLocally, CURRENT_TIMESTAMP);
`);

db.close();
console.log(`SQLite database initialized at ${databasePath}`);
