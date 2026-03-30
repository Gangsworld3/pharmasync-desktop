import { Link } from "react-router-dom";
import { t } from "../../i18n/i18n.js";
import { useCurrentUser } from "../../app/user-context.jsx";

export default function Sidebar() {
  const { currentUser } = useCurrentUser();
  const role = String(currentUser?.role ?? "").toLowerCase();
  const canViewAppointments = role === "admin" || role === "pharmacist";
  const canViewAnalytics = role === "admin" || role === "pharmacist" || role === "cashier";

  return (
    <aside className="sidebar">
      <h2>PharmaSync</h2>
      <nav className="sidebar-nav">
        <Link to="/">{t("sales")}</Link>
        <Link to="/inventory">{t("inventory")}</Link>
        <Link to="/expiry">{t("expiry")}</Link>
        {canViewAppointments ? <Link to="/appointments">{t("appointments")}</Link> : null}
        {canViewAnalytics ? <Link to="/analytics">Analytics</Link> : null}
      </nav>
    </aside>
  );
}
