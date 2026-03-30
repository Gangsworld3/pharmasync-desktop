import { t } from "../../i18n/i18n.js";

export default function PaymentPanel({
  items,
  clients,
  selectedClientId,
  onSelectClient,
  paymentMethod,
  onSelectPaymentMethod,
  onCompleteSale,
  isSubmitting,
  onPrintReceipt,
  canPrintReceipt
}) {
  const totalMinor = items.reduce((sum, item) => sum + item.qty * item.unitPriceMinor, 0);
  const total = totalMinor / 100;

  return (
    <div className="card">
      <h3>{t("total")}: ${total.toFixed(2)}</h3>
      <div className="stack">
        <label className="field">
          <span>Client</span>
          <select value={selectedClientId} onChange={(event) => onSelectClient(event.target.value)}>
            <option value="">Select client</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>{client.fullName}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="row">
        <button type="button" onClick={() => onSelectPaymentMethod("CASH")} className={paymentMethod === "CASH" ? "active-action" : ""}>{t("cash")}</button>
        <button type="button" onClick={() => onSelectPaymentMethod("CARD")} className={paymentMethod === "CARD" ? "active-action" : ""}>{t("card")}</button>
        <button type="button" onClick={onCompleteSale} disabled={isSubmitting || !items.length || !selectedClientId}>
          {isSubmitting ? "Processing..." : t("completeSale")}
        </button>
        <button type="button" onClick={onPrintReceipt} disabled={!canPrintReceipt}>Print Receipt</button>
      </div>
    </div>
  );
}
