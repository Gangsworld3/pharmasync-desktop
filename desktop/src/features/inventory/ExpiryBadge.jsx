import { t } from "../../i18n/i18n.js";
import { expiryStatus } from "../../domain/expiry.js";

export default function ExpiryBadge({ date }) {
  const status = expiryStatus(date);
  return (
    <span className={`badge ${status.type}`}>
      {status.type === "expired" ? "🔴" : status.type === "warning" ? "⚠️" : "✅"} {t(status.labelKey)}: {date}
    </span>
  );
}
