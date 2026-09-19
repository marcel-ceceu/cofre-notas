import { defineConfig } from "vitest/config";

// Config isolada do vite.config.ts de propósito: os testes cobrem só módulos
// puros (sem DOM), então não precisam dos plugins React/Tailwind/PWA.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
