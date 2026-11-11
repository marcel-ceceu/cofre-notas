/**
 * Exportador do ChatGPT para colar no Console do Chrome (método oficial de download).
 * É o mesmo arquivo que o Cofre injeta na janela interna (src-tauri/chatgpt_export.js),
 * carregado só quando o botão "Copiar script" é usado.
 */
export async function carregarScriptExportador(): Promise<string> {
  const mod = await import("../../../src-tauri/chatgpt_export.js?raw");
  return mod.default;
}
