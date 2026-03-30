import { Route, Routes } from "react-router-dom";
import Layout from "../components/layout/Layout.jsx";
import SalesScreen from "../features/sales/SalesScreen.jsx";
import InventoryScreen from "../features/inventory/InventoryScreen.jsx";
import ExpiryDashboard from "../features/expiry/ExpiryDashboard.jsx";
import AppointmentScreen from "../features/appointments/AppointmentScreen.jsx";

export default function AppRoutes() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<SalesScreen />} />
        <Route path="/inventory" element={<InventoryScreen />} />
        <Route path="/expiry" element={<ExpiryDashboard />} />
        <Route path="/appointments" element={<AppointmentScreen />} />
      </Routes>
    </Layout>
  );
}
