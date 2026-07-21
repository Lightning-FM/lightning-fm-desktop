import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// Dev-only automated payment validation (docs/phase-1-test-plan.md).
// Inert unless the dev server was started with VITE_LFM_VALIDATE=1.
if (import.meta.env.DEV && import.meta.env.VITE_LFM_VALIDATE === "1") {
  import("./dev/validate").then((m) => m.runValidation());
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
