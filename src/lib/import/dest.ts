/**
 * Destinos padrão dos fluxos de importação.
 * Módulo isolado (sem dependências) para que painel, modais e I/O compartilhem
 * as constantes sem importar um componente lazy.
 * Padrão e fluxo documentados em docs/PASTAS-CONVERSAS.md.
 */

/** Pasta de saída padrão oficial do fluxo Claude (raiz do cofre). */
export const DEFAULT_IMPORT_OUT_DIR = "D:\\2606VAULT-ClaudeConversasOF-v2";

/** Subpasta do cofre onde ficam as conversas do Cursor. */
export const CURSOR_SUBDIR = "Cursor";

/** Subpasta do cofre onde ficam as conversas do ChatGPT (já limpas). */
export const CHATGPT_SUBDIR = "ChatGPT";

/** Junta pasta + nome no separador que a pasta já usa (Windows ou /). */
export function joinWin(dir: string, name: string): string {
  const sep = dir.includes("\\") ? "\\" : "/";
  return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`;
}

/**
 * Raiz das transcrições ORIGINAIS (o que vem baixado de cada fonte, antes de
 * dedupe e limpeza). Nada aqui é editado pelo app depois de gravado.
 * O comando Rust `salvar_conversa_chatgpt` usa a mesma raiz (src-tauri/src/chatgpt.rs).
 */
export const CONVERSAS_ROOT = "D:\\915_CofreNotas-Conversas";

/** Subpastas por fonte, dentro de CONVERSAS_ROOT. */
export const CONVERSAS_SUBDIR = {
  chatgpt: "1_Chatgpt",
  claudeWeb: "2_ClaudeWeb",
  cursor: "3_Cursor",
} as const;

export type ConversaFonte = keyof typeof CONVERSAS_SUBDIR;

/** Caminho absoluto da pasta de originais de uma fonte. */
export function conversasDir(fonte: ConversaFonte): string {
  return `${CONVERSAS_ROOT}\\${CONVERSAS_SUBDIR[fonte]}`;
}
