import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Configuração alinhada ao Tauri: porta fixa (devUrl em tauri.conf.json)
// e o watcher do Vite ignorando src-tauri/ — senão ele tenta vigiar
// target/debug/...app_lib.dll (travado pelo app) e quebra com EBUSY.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
