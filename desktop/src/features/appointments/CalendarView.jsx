import { t } from "../../i18n/i18n.js";

function formatSlot(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().replace("T", " ").slice(0, 16);
}

export default function CalendarView({ appointments = [], statusMessage = "", errorMessage = "" }) {
  const rows = appointments.map((row) => ({
    id: row.id,
    time: formatSlot(row.startsAt),
    name: row.client?.fullName ?? row.client?.name ?? row.clientId ?? "Unknown client",
    type: row.serviceType ?? "Consultation",
    status: row.status ?? "PENDING"
  }));

  return (
    <div className="card">
      <h3>{t("calendar")}</h3>
      {statusMessage ? <p>{statusMessage}</p> : null}
      {errorMessage ? <p className="danger">{errorMessage}</p> : null}
      {rows.map((row) => (
        <div key={row.id} className="row between">
          <span>{row.time}</span>
          <span>{row.name} - {row.type} ({row.status})</span>
        </div>
      ))}
      {!rows.length ? <p>No appointments yet.</p> : null}
    </div>
  );
}
