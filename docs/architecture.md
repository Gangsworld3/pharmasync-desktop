# System Architecture

## Visual thesis

Calm, premium, operator-first software with dense information, almost no visual clutter, and resilient low-connectivity behavior.

## Architecture style

Start as a modular monolith with explicit internal domain boundaries, then split services only where scale or operational independence justifies it.

## High-level diagram

```text
+-----------------------------------------------------------------------------------+
| Desktop App (Electron)                                                            |
|-----------------------------------------------------------------------------------|
| UI Shell | Local Auth Session | Offline Queue | Sync Agent | Print/PDF Adapters   |
|-----------------------------------------------------------------------------------|
| Local Domain Modules                                                              |
| CRM | Scheduling | Billing | Inventory | Messaging | Documents | Analytics | RBAC |
|-----------------------------------------------------------------------------------|
| Encrypted SQLite + File Vault + Change Log                                        |
+-----------------------------------------+-----------------------------------------+
                                          |
                                 Online / intermittent
                                          |
+-----------------------------------------v-----------------------------------------+
| API Gateway / Backend Application                                                  |
|-----------------------------------------------------------------------------------|
| Auth | Tenant Context | REST API v1 | Audit Log | Webhook Intake                  |
|-----------------------------------------------------------------------------------|
| Domain Services inside modular monolith                                            |
| CRM | Scheduling | Billing | Inventory | Messaging | Documents | Reporting | Sync  |
|-----------------------------------------------------------------------------------|
| Background Workers                                                                 |
| Invoice jobs | SMS jobs | Email jobs | Backups | Imports | Analytics refresh      |
+-----------------------------------------+-----------------------------------------+
                                          |
            +-----------------------------+-----------------------------+
            |                             |                             |
+-----------v-----------+     +-----------v-----------+     +-----------v-----------+
| PostgreSQL            |     | Object Storage        |     | Notification Adapters |
| Multi-tenant cloud DB |     | Documents/backups     |     | SMS | Email | OTP     |
+-----------------------+     +-----------------------+     +-----------------------+
```

## Core components

### 1. Desktop client

- Windows-first Electron application with React renderer, IPC bridge, and local-first runtime
- React or Solid UI with code splitting
- Local encrypted SQLite database
- Background sync loop with online detection
- Print, export, barcode, and receipt adapters

### 2. Backend API server

- FastAPI recommended for typed contracts and operational simplicity
- Single deployment unit initially
- Domain modules exposed through versioned REST endpoints
- Tenant-aware permission checks at service boundaries
- PostgreSQL only on the server side; never share the desktop SQLite database with the backend
- Canonical server state is revisioned with a global sync event log

### 3. Sync service

- Log-based sync using `change_events`
- Each entity mutation is appended locally before sync
- Server acknowledges events, returns patches and conflict hints
- Optimistic UI with durable retry queue

### 4. Notification service

- SMS-first adapter layer because SMS remains the most reliable channel
- Email as secondary channel
- In-app notification feed for desktop and mobile companion apps

### 5. Auth service

- Email/password
- Optional SMS OTP challenge
- Device-bound refresh tokens
- Local session cache for offline access

## Module boundaries

### Core

- tenancy
- identity and RBAC
- audit logging
- sync orchestration
- localization and money handling

### Business modules

- CRM
- appointments and staff calendar
- billing and payment collection
- pharmacy inventory and stock movements
- messaging and campaigns
- document vault
- analytics and exports

### Infrastructure services

- storage
- PDF generation
- SMS/email adapters
- backup and restore
- observability

## Offline-first design

### Local write path

1. User action writes to SQLite inside a transaction
2. Change event is appended to local change log
3. UI updates immediately
4. Sync worker retries when network is available

### Server write path

1. Remote API receives synchronized mutations
2. FastAPI validates permissions and domain rules
3. PostgreSQL commits canonical server state
4. A sync event with a new global `server_revision` is appended
5. Sync acknowledgements and conflicts return to the device

### Conflict resolution

- Reference data: server-wins with audit trail
- Operational records like notes/messages: append-only merge
- Inventory movements: immutable transaction log, never overwrite balances directly
- Appointments: latest confirmed version wins, conflicting edits surfaced in a review queue
- Billing: financial records locked after settlement; correction flows create reversing entries

## Security model

- Device database encrypted at rest
- Sensitive secrets stored with OS keyring where available
- TLS for all remote traffic
- Per-tenant data scoping
- RBAC with policy matrix by module and action
- Full audit history for finance, stock, and user administration

## South Sudan market adaptation

- SMS-first reminders and collection notices
- mobile money provider abstraction, not hardcoded integrations
- SSP default currency with multi-currency support
- bandwidth-light sync payloads and batched media transfer
- Arabic-ready and English-first localization strategy

## Mandatory separation rule

- SQLite is for local desktop storage only
- PostgreSQL is for server storage only
- The desktop app and backend must not share the same database file under any circumstances

## Sync Contract

Push:

```json
{
  "deviceId": "DEVICE_1",
  "lastPulledRevision": 120,
  "changes": [
    {
      "operationId": "uuid",
      "entity": "Invoice",
      "operation": "CREATE",
      "entityId": "uuid",
      "localRevision": 3,
      "data": {}
    }
  ]
}
```

Pull:

```json
{
  "newRevision": 130,
  "serverChanges": []
}
```

Conflict rule:

- if `localRevision < server_revision`, the server returns a conflict object and does not apply the stale change

## Recommended repo layout

```text
/core
  /auth
  /rbac
  /sync
  /money
  /localization
/modules
  /crm
  /scheduling
  /billing
  /inventory
  /messaging
  /documents
  /analytics
/services
  /api
  /notifications
  /backups
  /reports
/ui
  /desktop
  /web
  /mobile-companion
```
