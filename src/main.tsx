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

// A janela já nasce visível (tauri.conf.json: visible=true — oculta, o WebView2
// falhava ao criar). O show() abaixo fica como seguro, sem efeito no caso normal.
if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
  const show = () => {
    import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => getCurrentWindow().show())
      .catch(() => {
        /* fora do Tauri ou API indisponível — nada a fazer */
      });
  };
  requestAnimationFrame(() => requestAnimationFrame(show));
  setTimeout(show, 1500);
}
