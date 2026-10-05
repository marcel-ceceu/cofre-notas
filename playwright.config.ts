import { defineConfig, devices } from "@playwright/test";

/**
 * E2E do fluxo web (navegador). Sobe um Vite PRÓPRIO numa porta separada —
 * a 5173 é do dev server do Tauri e nunca é usada aqui.
 * Sempre headless: nenhuma janela aparece na tela.
 */
const PORT = Number(process.env.E2E_PORT ?? 5180);
if (!Number.isInteger(PORT) || PORT <= 0) {
  throw new Error(`E2E_PORT inválida: ${process.env.E2E_PORT}`);
}
if (PORT === 5173) {
  throw new Error("E2E_PORT=5173 é reservada ao dev server do Tauri — use outra porta.");
}
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "e2e",
  // e2e/.tmp guarda o export grande gerado (cache) — nunca contém specs.
  testIgnore: ["**/.tmp/**"],
  outputDir: "test-results",
  // Um worker só: o teste do export grande usa bastante memória e os specs
  // são curtos; serial deixa tudo determinístico.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: "list",
  // Folgado por causa do export grande (test.slow() triplica: 12 min).
  timeout: 4 * 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    headless: true,
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], headless: true },
    },
  ],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
