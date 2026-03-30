import Input from "../../components/shared/Input.jsx";

export default function AppointmentForm() {
  return (
    <form className="card stack">
      <Input label="Client" placeholder="Client name" />
      <Input label="Service" placeholder="Consultation" />
      <Input label="Start" type="datetime-local" />
      <Input label="End" type="datetime-local" />
      <button type="submit">Book</button>
    </form>
  );
}
