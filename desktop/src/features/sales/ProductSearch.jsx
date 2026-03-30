import { t } from "../../i18n/i18n.js";

export default function ProductSearch({ query, onQueryChange }) {
  return (
    <div className="card">
      <h3>{t("search")}</h3>
      <div className="row">
        <input
          type="search"
          placeholder={t("search")}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
        <button type="button" disabled>{t("scanBarcode")}</button>
      </div>
    </div>
  );
}
