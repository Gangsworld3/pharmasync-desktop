import { t } from "../../i18n/i18n.js";

export default function ProductSearch() {
  return (
    <div className="card">
      <h3>{t("search")}</h3>
      <div className="row">
        <input type="search" placeholder={t("search")} />
        <button type="button">{t("scanBarcode")}</button>
      </div>
    </div>
  );
}
