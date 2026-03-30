import LanguageToggle from "./LanguageToggle.jsx";
import { t } from "../../i18n/i18n.js";
import { useCurrentUser } from "../../app/user-context.jsx";

export default function Topbar() {
  const { currentUser, isLoadingUser, userError } = useCurrentUser();
  const roleLabel = String(currentUser?.role ?? "").toUpperCase();

  return (
    <header className="topbar">
      <div className="search-slot">
        <input type="search" placeholder={t("search")} />
      </div>
      <div className="actions-slot">
        <span>{isLoadingUser ? "Loading user..." : (userError || `${currentUser?.email ?? "Unknown"} (${roleLabel || "N/A"})`)}</span>
        <button type="button">{t("scanBarcode")}</button>
        <LanguageToggle />
      </div>
    </header>
  );
}
