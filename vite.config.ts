import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// O Tauri seta TAURI_ENV_* durante o build desktop. Fora dele (ex.: build web
// na Vercel), ativamos a PWA. Assim o service worker NUNCA entra no app nativo.
const isTauri = !!process.env.TAURI_ENV_PLATFORM;

// Configuração alinhada ao Tauri: porta fixa (devUrl em tauri.conf.json)
// e o watcher do Vite ignorando src-tauri/ — senão ele tenta vigiar
// target/debug/...app_lib.dll (travado pelo app) e quebra com EBUSY.
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Sempre presente (o módulo virtual `virtual:pwa-register` precisa resolver
    // nos dois builds), mas DESATIVADO sob Tauri: nada de service worker no app.
    VitePWA({
      disable: isTauri,
      registerType: "autoUpdate",
      includeAssets: ["favicon.png", "logo.png"],
      manifest: {
        name: "Cofre de Notas",
        short_name: "CofreNotas",
        description:
          "Leitor e busca de conversas exportadas do Claude em formato Markdown.",
        lang: "pt-BR",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#7c3aed",
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/pwa-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
      },
    }),
  ],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
