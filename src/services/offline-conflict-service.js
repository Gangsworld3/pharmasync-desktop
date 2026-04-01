function addMinutes(isoString, minutes) {
  return new Date(new Date(isoString).getTime() + minutes * 60 * 1000);
}

function resolveSuggestedDate(originalStart, suggestedStart) {
  if (suggestedStart && typeof suggestedStart === "object" && suggestedStart.starts_at) {
    return new Date(suggestedStart.starts_at);
  }

  if (typeof suggestedStart === "string" && suggestedStart.includes("T")) {
    return new Date(suggestedStart);
  }

  const base = new Date(originalStart);
  const [hours, minutes] = String(suggestedStart).split(":").map(Number);
  base.setHours(hours, minutes, 0, 0);
  return base;
}

export async function resolveDesktopConflictInTransaction(tx, conflictId, payload = {}, actor = "system", appendAuditLog, appendLocalOperation) {
  const conflict = await tx.localOperation.findUnique({ where: { id: conflictId } });

  if (!conflict || conflict.status !== "CONFLICT") {
    throw new Error("Conflict not found.");
  }

  const conflictPayload = conflict.conflictPayloadJson ? JSON.parse(conflict.conflictPayloadJson) : null;
  const operationPayload = conflict.payloadJson ? JSON.parse(conflict.payloadJson) : {};
  const action = payload.action ?? "DEFER";

  if (conflict.entityType === "Appointment" && action === "RESCHEDULE") {
    const suggestedStart = payload.suggestedStart;
    if (!suggestedStart) {
      throw new Error("Missing suggestedStart for reschedule action.");
    }

    const nextStartsAt = resolveSuggestedDate(operationPayload.starts_at, suggestedStart);
    const durationMinutes = Math.max(
      30,
      Math.round((new Date(operationPayload.ends_at).getTime() - new Date(operationPayload.starts_at).getTime()) / 60000) || 30
    );
    const nextEndsAt = addMinutes(nextStartsAt.toISOString(), durationMinutes);

    const appointment = await tx.appointment.update({
      where: { id: conflict.entityId },
      data: {
        startsAt: nextStartsAt,
        endsAt: nextEndsAt,
        dirty: true,
        syncStatus: "PENDING",
        localRevision: { increment: 1 },
        lastModifiedLocally: new Date()
      }
    });

    await appendLocalOperation(tx, {
      operationId: `local-op-${appointment.id}-${appointment.localRevision}`,
      entityType: "Appointment",
      entityId: appointment.id,
      operation: "UPDATE",
      localRevision: appointment.localRevision,
      payload: {
        client_id: appointment.clientId,
        service_type: appointment.serviceType,
        staff_name: appointment.staffName,
        starts_at: appointment.startsAt,
        ends_at: appointment.endsAt,
        status: appointment.status,
        notes: appointment.notes
      }
    });

    await tx.localOperation.update({
      where: { id: conflictId },
      data: {
        status: "RESOLVED",
        errorDetail: `rescheduled:${suggestedStart}`,
        updatedAt: new Date()
      }
    });

    await appendAuditLog(tx, {
      actor,
      action: "desktop.conflict.reschedule",
      entityType: "Appointment",
      entityId: appointment.id,
      detailsJson: {
        suggestedStart: nextStartsAt.toISOString(),
        previousConflict: conflictPayload?.type ?? "CONFLICT"
      }
    });

    return { status: "resolved", action: "RESCHEDULE", appointmentId: appointment.id, startsAt: nextStartsAt.toISOString() };
  }

  if (action === "RETRY") {
    await tx.localOperation.update({
      where: { id: conflictId },
      data: {
        status: "RETRY_SCHEDULED",
        conflictPayloadJson: null,
        errorDetail: "retry_requested",
        nextAttemptAt: new Date(),
        backoffMs: 0,
        updatedAt: new Date()
      }
    });

    await appendAuditLog(tx, {
      actor,
      action: "desktop.conflict.retry",
      entityType: conflict.entityType,
      entityId: conflict.entityId,
      detailsJson: { conflictType: conflictPayload?.type ?? "CONFLICT" }
    });

    return { status: "queued", action, entityId: conflict.entityId };
  }

  if (action === "DEFER") {
    await tx.localOperation.update({
      where: { id: conflictId },
      data: {
        status: "CONFLICT",
        errorDetail: "deferred_by_user",
        updatedAt: new Date()
      }
    });

    await appendAuditLog(tx, {
      actor,
      action: "desktop.conflict.defer",
      entityType: conflict.entityType,
      entityId: conflict.entityId,
      detailsJson: { conflictType: conflictPayload?.type ?? "CONFLICT" }
    });

    return { status: "deferred", action, entityId: conflict.entityId };
  }

  await tx.localOperation.update({
    where: { id: conflictId },
    data: {
      status: "RESOLVED",
      errorDetail: action.toLowerCase(),
      updatedAt: new Date()
    }
  });

  await appendAuditLog(tx, {
    actor,
    action: "desktop.conflict.resolve",
    entityType: conflict.entityType,
    entityId: conflict.entityId,
    detailsJson: { action, conflictType: conflictPayload?.type ?? "CONFLICT" }
  });

  return { status: "resolved", action, entityId: conflict.entityId };
}
