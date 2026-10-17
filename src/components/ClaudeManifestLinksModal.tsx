import { useEffect } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isTauriRuntime } from "../lib/fileSystem.tauri";
import type { ClaudeManifestDataFile } from "../lib/import/claudeExportManifest";

type Props = {
  /** Partes de conversas extraídas do manifest. */
  downloads: ClaudeManifestDataFile[];
  createdAt?: string;
  onClose: () => void;
};

/** Popup enxuto: links de download do zip de conversas (manifest Claude.ai). */
export function ClaudeManifestLinksModal({
  downloads,
  createdAt,
  onClose,
}: Props) {
  const tauri = isTauriRuntime();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function openLink(url: string) {
    try {
      if (tauri) await openUrl(url);
      else window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      console.error("[manifest] falha ao abrir link", e);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-zinc-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="manifest-links-title"
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
          <h2
            id="manifest-links-title"
            className="text-sm font-semibold text-zinc-900"
          >
            Download das conversas
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-700 text-lg leading-none px-1"
            aria-label="Fechar"
          >
            ×
          </button>
        </div>

        <div className="space-y-3 p-4 text-sm">
          <p className="text-zinc-600 leading-relaxed">
            Abra cada link <strong>logado no claude.ai</strong>. Cada URL funciona{" "}
            <strong>uma vez</strong> e expira em ~24 h — baixe o{" "}
            <code className="rounded bg-zinc-100 px-1 text-[11px]">.zip</code>{" "}
            na hora.
          </p>
          {createdAt && (
            <p className="text-[11px] text-zinc-500">
              Export gerado em: {createdAt.replace("T", " ").slice(0, 19)} UTC
            </p>
          )}

          <ul className="space-y-2">
            {downloads.map((d) => (
              <li
                key={`${d.part}-${d.batch_index}`}
                className="rounded border border-zinc-200 bg-zinc-50 p-3"
              >
                <p className="font-mono text-xs text-zinc-800 truncate">
                  {d.filename}
                </p>
                <button
                  type="button"
                  onClick={() => openLink(d.export_url)}
                  className="mt-2 w-full rounded bg-violet-600 px-3 py-2 text-xs font-medium text-white hover:bg-violet-700"
                >
                  Abrir link de download
                </button>
              </li>
            ))}
          </ul>

          <p className="text-[11px] text-zinc-500">
            Depois de baixar, volte ao assistente e avance para{" "}
            <strong className="font-medium text-zinc-700">Rodar a conversão</strong>.
          </p>
        </div>

        <div className="flex justify-end border-t border-zinc-200 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
