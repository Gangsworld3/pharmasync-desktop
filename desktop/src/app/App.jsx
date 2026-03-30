import { BrowserRouter } from "react-router-dom";
import AppRoutes from "./routes.jsx";
import { useRTL } from "../hooks/useRTL.js";
import { UserProvider } from "./user-context.jsx";

export default function App() {
  useRTL();
  return (
    <UserProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </UserProvider>
  );
}
