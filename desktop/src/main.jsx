import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app/App.jsx";
import { initializeLanguage } from "./i18n/i18n.js";
import ErrorBoundary from "./components/shared/ErrorBoundary.jsx";
import "./styles/globals.css";

await initializeLanguage();

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>
  );
}
