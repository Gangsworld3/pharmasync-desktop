import { t } from "../../i18n/i18n.js";

export default function PaymentPanel({ items }) {
  const total = items.reduce((sum, item) => sum + item.qty * 100, 0) / 100;

  return (
    <div className="card">
      <h3>{t("total")}: ${total.toFixed(2)}</h3>
      <div className="row">
        <button type="button">{t("cash")}</button>
        <button type="button">{t("card")}</button>
        <button type="button">{t("completeSale")}</button>
      </div>
    </div>
  );
}
