from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any, Callable

from sqlmodel import Session


def appointment_suggestions(
    session: Session,
    staff_name: str,
    starts_at: datetime,
    ends_at: datetime,
    *,
    configured_zone: Any,
    step_minutes: int,
    workday_start_hour: int,
    workday_end_hour: int,
    suggestion_max_attempts: int,
    find_appointment_conflict: Callable[..., Any],
    parse_datetime_value: Callable[[Any], datetime],
    limit: int = 3,
    tenant_id: str | None = None,
) -> list[dict[str, str]]:
    zone = configured_zone
    base_start_utc = parse_datetime_value(starts_at)
    base_end_utc = parse_datetime_value(ends_at)
    duration = max(base_end_utc - base_start_utc, timedelta(minutes=step_minutes))
    step = timedelta(minutes=step_minutes)

    candidate_local = base_start_utc.astimezone(zone) + step
    minute_offset = candidate_local.minute % step_minutes
    if minute_offset:
        candidate_local += timedelta(minutes=(step_minutes - minute_offset))
    candidate_local = candidate_local.replace(second=0, microsecond=0)

    suggestions: list[dict[str, str]] = []
    for _ in range(suggestion_max_attempts):
        if candidate_local.hour < workday_start_hour:
            candidate_local = candidate_local.replace(
                hour=workday_start_hour, minute=0, second=0, microsecond=0
            )

        latest_start_local = candidate_local.replace(
            hour=workday_end_hour, minute=0, second=0, microsecond=0
        ) - duration
        if candidate_local > latest_start_local:
            next_day = (candidate_local + timedelta(days=1)).replace(
                hour=workday_start_hour, minute=0, second=0, microsecond=0
            )
            candidate_local = next_day
            continue

        candidate_end_local = candidate_local + duration
        candidate_start_utc = candidate_local.astimezone(UTC)
        candidate_end_utc = candidate_end_local.astimezone(UTC)
        overlap = find_appointment_conflict(
            session,
            staff_name,
            candidate_start_utc,
            candidate_end_utc,
            tenant_id=tenant_id,
        )
        if not overlap:
            suggestions.append(
                {
                    "starts_at": candidate_local.isoformat(),
                    "ends_at": candidate_end_local.isoformat(),
                    "timezone": str(zone.key),
                }
            )
            if len(suggestions) >= limit:
                break
        candidate_local += step

    return suggestions


def resolve_appointment_schedule_basis(
    existing: Any,
    incoming: dict[str, Any],
    *,
    parse_datetime_value: Callable[[Any], datetime],
) -> tuple[str | None, datetime | None, datetime | None]:
    staff_name = incoming.get("staff_name") if incoming.get("staff_name") is not None else getattr(existing, "staff_name", None)
    starts_at = incoming.get("starts_at") if incoming.get("starts_at") is not None else getattr(existing, "starts_at", None)
    ends_at = incoming.get("ends_at") if incoming.get("ends_at") is not None else getattr(existing, "ends_at", None)

    if not isinstance(starts_at, datetime) or not isinstance(ends_at, datetime):
        return staff_name, None, None

    starts_at = parse_datetime_value(starts_at)
    ends_at = parse_datetime_value(ends_at)

    if ends_at <= starts_at:
        ends_at = starts_at + timedelta(minutes=30)
    return staff_name, starts_at, ends_at
