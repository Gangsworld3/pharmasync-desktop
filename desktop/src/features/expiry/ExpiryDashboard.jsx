import { t } from "../../i18n/i18n.js";
import ExpiryList from "./ExpiryList.jsx";
import { expiryStatus } from "../../domain/expiry.js";

const sample = [
  { id: "b1", name: "Insulin", date: "2025-01-01" },
  { id: "b2", name: "Amoxicillin", date: "2026-02-01" }
];

export default function ExpiryDashboard() {
  const statusRows = sample.map((row) => ({ ...row, status: expiryStatus(row.date).type }));
  const expired = statusRows.filter((row) => row.status === "expired").length;
  const warning = statusRows.filter((row) => row.status === "warning").length;

  return (
    <section className="stack">
      <div className="row">
        <div className="card danger">{t("expired")}: {expired}</div>
        <div className="card warning">{t("expiringSoon")}: {warning}</div>
      </div>
      <ExpiryList rows={statusRows} />
    </section>
  );
}
