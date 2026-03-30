import CalendarView from "./CalendarView.jsx";
import AppointmentForm from "./AppointmentForm.jsx";

export default function AppointmentScreen() {
  return (
    <section className="stack">
      <AppointmentForm />
      <CalendarView />
    </section>
  );
}
