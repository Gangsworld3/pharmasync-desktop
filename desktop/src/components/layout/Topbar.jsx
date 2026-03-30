import LanguageToggle from "./LanguageToggle.jsx";
import { t } from "../../i18n/i18n.js";

export default function Topbar() {
  return (
    <header className="topbar">
      <div className="search-slot">
        <input type="search" placeholder={t("search")} />
      </div>
      <div className="actions-slot">
        <button type="button">{t("scanBarcode")}</button>
        <LanguageToggle />
      </div>
    </header>
  );
}
