import { isTauriRuntime } from "./fileSystem.tauri";
import type { Update } from "@tauri-apps/plugin-updater";

/**
 * Consulta o endpoint configurado (GitHub Releases) e retorna a atualização
 * disponível, ou null se já estamos na versão mais recente / fora do Tauri.
 * Import dinâmico: o build web nunca avalia o plugin de updater.
 */
export async function checkForUpdate(): Promise<Update | null> {
  if (!isTauriRuntime()) return null;
  const { check } = await import("@tauri-apps/plugin-updater");
  return check();
}

/** Baixa + instala a atualização e reinicia o app. */
export async function installAndRelaunch(
  update: Update,
  onProgress?: (percent: number | null) => void
): Promise<void> {
  let total = 0;
  let downloaded = 0;

  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength ?? 0;
        onProgress?.(total ? 0 : null);
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        onProgress?.(total ? Math.round((downloaded / total) * 100) : null);
        break;
      case "Finished":
        onProgress?.(100);
        break;
    }
  });

  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
