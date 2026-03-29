# Predeploy Automation

Run migrations and smoke checks:

```bash
python scripts/predeploy_check.py --base-url https://your-backend.onrender.com
```

Local run (skip migrations):

```bash
python scripts/predeploy_check.py --skip-migrate --base-url http://127.0.0.1:10000
```

Environment overrides:

- `SMOKE_BASE_URL`
- `SMOKE_ADMIN_EMAIL`
- `SMOKE_ADMIN_PASSWORD`

## Chaos Checks (Local)

Start full stack:

```bash
docker compose -f docker-compose.chaos.yml up -d --build
```

Run smoke checks against local stack:

```bash
python backend/scripts/predeploy_check.py --skip-migrate --base-url http://127.0.0.1:10000
```

Simulate Redis outage:

```bash
docker compose -f docker-compose.chaos.yml stop redis
```

Simulate Postgres outage:

```bash
docker compose -f docker-compose.chaos.yml stop postgres
```

Recover services:

```bash
docker compose -f docker-compose.chaos.yml start redis postgres
```
