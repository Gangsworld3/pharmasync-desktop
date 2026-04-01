import os
import sys
from urllib.parse import parse_qs, urlparse


def fail(message: str) -> None:
    print(f"[prestart-env-guard] ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    env = (os.getenv("ENV") or "development").strip().lower()
    primary = (os.getenv("PHARMASYNC_DATABASE_URL") or "").strip()
    legacy = (os.getenv("DATABASE_URL") or "").strip()

    if env != "production":
        print("[prestart-env-guard] Non-production mode; guard checks skipped.")
        return

    if not primary:
        fail("Missing PHARMASYNC_DATABASE_URL in production.")

    if legacy:
        fail("DATABASE_URL must be unset in production. Use PHARMASYNC_DATABASE_URL only.")

    parsed = urlparse(primary)
    if not parsed.scheme.startswith("postgres"):
        fail("PHARMASYNC_DATABASE_URL must use a postgres scheme.")

    if not parsed.hostname:
        fail("PHARMASYNC_DATABASE_URL is missing hostname.")

    query = parse_qs(parsed.query)
    sslmode = (query.get("sslmode") or [""])[0].lower()
    if sslmode not in {"require", "verify-ca", "verify-full"}:
        fail("PHARMASYNC_DATABASE_URL must include sslmode=require (or stricter) in production.")

    print("[prestart-env-guard] Production environment configuration passed.")


if __name__ == "__main__":
    main()
