import { t } from "../../i18n/i18n.js";

export default function CalendarView() {
  const rows = [
    { time: "10:00", name: "Ahmed", type: "Consultation" },
    { time: "10:30", name: "Sara", type: "Vaccine" }
  ];

  return (
    <div className="card">
      <h3>{t("calendar")}</h3>
      {rows.map((row) => (
        <div key={`${row.time}-${row.name}`} className="row between">
          <span>{row.time}</span>
          <span>{row.name} - {row.type}</span>
        </div>
      ))}
    </div>
  );
}
