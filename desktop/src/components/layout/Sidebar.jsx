import { Link } from "react-router-dom";
import { t } from "../../i18n/i18n.js";

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <h2>PharmaSync</h2>
      <nav className="sidebar-nav">
        <Link to="/">{t("sales")}</Link>
        <Link to="/inventory">{t("inventory")}</Link>
        <Link to="/expiry">{t("expiry")}</Link>
        <Link to="/appointments">{t("appointments")}</Link>
      </nav>
    </aside>
  );
}
