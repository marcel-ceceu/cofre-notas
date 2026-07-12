import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// PWA: registra o service worker apenas no navegador (nunca sob o app Tauri).
// O import é dinâmico porque o módulo virtual só existe no build web.
if (
  typeof window !== "undefined" &&
  !("__TAURI_INTERNALS__" in window)
) {
  import("virtual:pwa-register")
    .then(({ registerSW }) => registerSW({ immediate: true }))
    .catch(() => {
      /* módulo ausente (build sem PWA) — ignora */
    });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
