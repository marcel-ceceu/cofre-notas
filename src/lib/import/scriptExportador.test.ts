import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { carregarScriptExportador } from "./scriptExportador";

describe("carregarScriptExportador", () => {
  it("devolve o exportador inteiro, igual ao arquivo que o Cofre injeta", async () => {
    const arquivo = readFileSync(resolve(__dirname, "../../../src-tauri/chatgpt_export.js"), "utf8");
    const script = await carregarScriptExportador();
    expect(script).toBe(arquivo);
    expect(script.startsWith("// GPTEXPORT")).toBe(true);
    expect(script.trimEnd().endsWith("})();")).toBe(true);
  });
});
