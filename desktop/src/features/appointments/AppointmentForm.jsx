import { useMemo, useState } from "react";
import Input from "../../components/shared/Input.jsx";

function toIsoDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

export default function AppointmentForm({ clients = [], onSubmit, isSubmitting = false, errorMessage = "" }) {
  const [clientId, setClientId] = useState("");
  const [serviceType, setServiceType] = useState("Consultation");
  const [staffName, setStaffName] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [notes, setNotes] = useState("");

  const sortedClients = useMemo(
    () => [...clients].sort((a, b) => {
      const left = String(a.fullName ?? a.name ?? "");
      const right = String(b.fullName ?? b.name ?? "");
      return left.localeCompare(right);
    }),
    [clients]
  );

  async function handleSubmit(event) {
    event.preventDefault();
    if (!onSubmit || isSubmitting) return;

    const startsAtIso = toIsoDate(startsAt);
    const endsAtIso = toIsoDate(endsAt);
    if (!clientId || !startsAtIso || !endsAtIso) return;

    await onSubmit({
      clientId,
      serviceType,
      staffName: staffName.trim() || null,
      startsAt: startsAtIso,
      endsAt: endsAtIso,
      notes: notes.trim() || null
    });

    setServiceType("Consultation");
    setStaffName("");
    setStartsAt("");
    setEndsAt("");
    setNotes("");
  }

  return (
    <form className="card stack" onSubmit={handleSubmit}>
      <label className="field">
        <span>Client</span>
        <select value={clientId} onChange={(event) => setClientId(event.target.value)} required>
          <option value="">Select client</option>
          {sortedClients.map((client) => (
            <option key={client.id} value={client.id}>{client.fullName ?? client.name ?? client.id}</option>
          ))}
        </select>
      </label>
      <Input label="Service" placeholder="Consultation" value={serviceType} onChange={(event) => setServiceType(event.target.value)} required />
      <Input label="Staff" placeholder="Pharmacist name" value={staffName} onChange={(event) => setStaffName(event.target.value)} />
      <Input label="Start" type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required />
      <Input label="End" type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} required />
      <Input label="Notes" placeholder="Optional notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
      <button type="submit" disabled={isSubmitting || !sortedClients.length}>
        {isSubmitting ? "Booking..." : "Book"}
      </button>
      {errorMessage ? <p className="danger">{errorMessage}</p> : null}
    </form>
  );
}
