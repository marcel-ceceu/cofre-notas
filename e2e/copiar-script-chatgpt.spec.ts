/**
 * E2E: painel Importar → "Copiar script do exportador" (método oficial de baixar
 * as conversas do ChatGPT: colar no Console do Chrome).
 * Confere que o que vai para a área de transferência é o exportador inteiro.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const IMPORT_TOOLBAR_TITLE =
  "Importar — conversas do ChatGPT (baixadas) e do Cursor IDE (transcripts locais)";
/** O Playwright roda a partir da raiz do projeto. */
const SCRIPT_PATH = resolve(process.cwd(), "src-tauri/chatgpt_export.js");

test("Copiar script do exportador põe o exportador inteiro na área de transferência", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page.getByTitle(IMPORT_TOOLBAR_TITLE).click();

  const botao = page.getByRole("button", { name: "Copiar script do exportador" });
  await expect(botao).toBeVisible();
  await botao.click();

  await expect(
    page.getByRole("button", { name: "Script copiado — cole no Console do chatgpt.com" })
  ).toBeVisible();
  const copiado = await page.evaluate(() => navigator.clipboard.readText());
  // A área de transferência normaliza CRLF → LF; o conteúdo tem que ser o mesmo.
  const lf = (s: string) => s.replace(/\r\n/g, "\n");
  expect(lf(copiado)).toBe(lf(readFileSync(SCRIPT_PATH, "utf8")));
});
