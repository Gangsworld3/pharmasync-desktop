# Tech Stack Justification

## Desktop

Recommended: Electron + React

Why:

- stable Windows packaging and installer generation through electron-builder
- direct OS/printing integrations through Electron APIs
- strong fit for offline-first desktop workflows
- JavaScript runtime matches current implementation footprint across desktop/electron modules

## Local database

Recommended: SQLite with SQLCipher or equivalent encryption layer

Why:

- proven embedded database for local-first apps
- extremely low operational overhead
- fast reads and writes on modest hardware
- suitable for append-only sync logs and transactional billing/inventory records

## Backend

Recommended: FastAPI + PostgreSQL

Why:

- FastAPI gives typed request models, OpenAPI generation, and rapid delivery
- PostgreSQL is the right default for relational finance, inventory, audit, and reporting workloads
- easier long-term scaling and analytics than document-first storage for this domain

## Sync and background work

Recommended: event log + retry queue, with Redis optional for cloud workers

Why:

- offline-first workflows need deterministic event replay
- append-only logs fit reconciliation, audit, and conflict handling
- Redis can be introduced later for worker queues without forcing microservices early

## Notifications

Recommended: provider abstraction with SMS first, email second

Why:

- provider volatility is high in emerging markets
- abstractions allow market-specific adapters without changing business modules
- SMS is the most dependable reminder and collection channel for this region

## Cloud and deployment

Recommended: single-region SaaS core with optional self-hosted sync gateway for large customers

Why:

- simplest operating model for early scale
- keeps latency acceptable while centralizing backups and tenant management
- still supports hybrid customers that need stronger local control
