import { useEffect, useState } from "react";
import CalendarView from "./CalendarView.jsx";
import AppointmentForm from "./AppointmentForm.jsx";

export default function AppointmentScreen() {
  const [appointments, setAppointments] = useState([]);
  const [clients, setClients] = useState([]);
  const [status, setStatus] = useState("Loading appointments...");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function loadData() {
    if (!window.api) return;
    try {
      const [appointmentRows, clientRows] = await Promise.all([
        window.api.listAppointments(),
        window.api.listClients()
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
    if (!window.api) return;
    setIsSubmitting(true);
    setError("");
    try {
      await window.api.createAppointment(payload);
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
