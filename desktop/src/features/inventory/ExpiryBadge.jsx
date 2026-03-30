import { t } from "../../i18n/i18n.js";
import { expiryStatus } from "../../domain/expiry.js";

export default function ExpiryBadge({ date }) {
  const status = expiryStatus(date);
  const label = date ? new Date(date).toLocaleDateString() : "n/a";
  const marker = status.type === "expired" ? "[EXP]" : status.type === "warning" ? "[WARN]" : "[OK]";

  return (
    <span className={`badge ${status.type}`}>
      {marker} {t(status.labelKey)}: {label}
    </span>
  );
}
