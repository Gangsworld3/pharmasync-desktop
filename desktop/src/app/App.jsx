import { BrowserRouter } from "react-router-dom";
import AppRoutes from "./routes.jsx";
import { useRTL } from "../hooks/useRTL.js";

export default function App() {
  useRTL();
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
