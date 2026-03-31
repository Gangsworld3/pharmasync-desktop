import { BrowserRouter } from "react-router-dom";
import { Route, Routes } from "react-router-dom";
import { useRTL } from "../hooks/useRTL.js";
import { UserProvider } from "./user-context.jsx";
import Layout from "../components/layout/Layout.jsx";
import SalesScreen from "../features/sales/SalesScreen.jsx";
import InventoryScreen from "../features/inventory/InventoryScreen.jsx";
import ExpiryDashboard from "../features/expiry/ExpiryDashboard.jsx";
import AppointmentScreen from "../features/appointments/AppointmentScreen.jsx";
import AnalyticsDashboard from "../features/analytics/AnalyticsDashboard.jsx";

export default function App() {
  useRTL();
  return (
    <UserProvider>
      <BrowserRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<SalesScreen />} />
            <Route path="/inventory" element={<InventoryScreen />} />
            <Route path="/expiry" element={<ExpiryDashboard />} />
            <Route path="/appointments" element={<AppointmentScreen />} />
            <Route path="/analytics" element={<AnalyticsDashboard />} />
          </Routes>
        </Layout>
      </BrowserRouter>
    </UserProvider>
  );
}
