/**
 * Destinos padrão dos fluxos de importação.
 * Módulo isolado (sem dependências) para que painel, modais e I/O compartilhem
 * as constantes sem importar um componente lazy.
 */

/** Pasta de saída padrão oficial do fluxo Claude (raiz do cofre). */
export const DEFAULT_IMPORT_OUT_DIR = "D:\\2606VAULT-ClaudeConversasOF-v2";

/** Subpasta do cofre onde ficam as conversas do Cursor. */
export const CURSOR_SUBDIR = "Cursor";
