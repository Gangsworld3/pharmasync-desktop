import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "../src/app/App.jsx";
import { initializeLanguage } from "../src/i18n/i18n.js";
import ErrorBoundary from "../src/components/shared/ErrorBoundary.jsx";
import "../src/styles/globals.css";

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
