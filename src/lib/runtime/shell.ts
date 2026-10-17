/**
 * Runtime do Cofre: app desktop (Tauri) vs PWA (navegador).
 * Regra do produto: mesma UI e os mesmos fluxos; onde o SO não permite,
 * equivalente via download / IndexedDB (ver .cursor/rules/pwa-paridade-tauri.mdc).
 */
import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "../fileSystem.tauri";

/** App instalado (Tauri). No código legado também aparece como isTauriRuntime(). */
export function isDesktopShell(): boolean {
  return isTauriRuntime();
}

/** Destino simbólico quando a exportação no PWA vira download. */
export const WEB_EXPORT_DEST = "__cofre_web_download__";

export function defaultExportDest(desktopPath: string): string {
  return isDesktopShell() ? desktopPath : WEB_EXPORT_DEST;
}

export function exportDestLabel(dest: string | null): string {
  if (!dest || dest === WEB_EXPORT_DEST) {
    return "Download automático (PWA)";
  }
  return dest;
}

/** ChatGPT (teste): webview com exportador no desktop; site externo no PWA. */
export async function openChatGptTeste(): Promise<void> {
  if (isDesktopShell()) {
    await invoke("abrir_chatgpt");
    return;
  }
  window.open("https://chatgpt.com/", "_blank", "noopener,noreferrer");
}
