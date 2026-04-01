import { useEffect, useState } from "react";
import CalendarView from "./CalendarView.jsx";
import AppointmentForm from "./AppointmentForm.jsx";
import { callIpc, IPC_CHANNELS } from "../../lib/ipc-client.js";

export default function AppointmentScreen() {
  const [appointments, setAppointments] = useState([]);
  const [clients, setClients] = useState([]);
  const [status, setStatus] = useState("Loading appointments...");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function loadData() {
    if (!window.api?.invoke) return;
    try {
      const [appointmentRows, clientRows] = await Promise.all([
        callIpc(IPC_CHANNELS.APPOINTMENTS_LIST),
        callIpc(IPC_CHANNELS.CLIENTS_LIST)
      ]);
      setAppointments(Array.isArray(appointmentRows) ? appointmentRows : []);
      setClients(Array.isArray(clientRows) ? clientRows : []);
      setStatus(`Loaded ${appointmentRows.length} appointments.`);
      setError("");
    } catch (loadError) {
      setError(loadError.message ?? "Failed to load appointments.");
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleCreate(payload) {
    if (!window.api?.invoke) return;
    setIsSubmitting(true);
    setError("");
    try {
      await callIpc(IPC_CHANNELS.APPOINTMENTS_CREATE, payload);
      setStatus("Appointment created.");
      await loadData();
    } catch (createError) {
      setError(createError.message ?? "Failed to create appointment.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="stack">
      <AppointmentForm
        clients={clients}
        onSubmit={handleCreate}
        isSubmitting={isSubmitting}
        errorMessage={error}
      />
      <CalendarView appointments={appointments} statusMessage={status} errorMessage={error} />
    </section>
  );
}
