import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { basename } from "@tauri-apps/api/path";
import { useVaultStore } from "../store/vaultStore";
import { isTauriRuntime, type TauriDirHandle } from "../lib/fileSystem.tauri";
import {
  findLatestExportZips,
  importClaudeZips,
  runCortesias,
  type ImportProgress,
  type ImportResult,
  type CortesiasResult,
} from "../lib/import/runImport";

type Props = {
  onClose: () => void;
  /** Chamado após importar com sucesso, com a pasta de saída usada. */
  onImported: (outDir: string) => void;
};

export function ImportClaudeModal({ onClose, onImported }: Props) {
  const dirHandle = useVaultStore((s) => s.dirHandle);
  const vaultPath =
    dirHandle && (dirHandle as TauriDirHandle).kind === "tauri"
      ? (dirHandle as TauriDirHandle).path
      : null;

  const [zipPaths, setZipPaths] = useState<string[]>([]);
  const [zipLabels, setZipLabels] = useState<string[]>([]);
  const [outDir, setOutDir] = useState<string | null>(vaultPath);
  const [alsoFinal, setAlsoFinal] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [finalResult, setFinalResult] = useState<CortesiasResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const finalDir = outDir ? `${outDir}-FINAL` : null;

  // Auto-detecta o export mais recente em Downloads ao abrir.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const found = await findLatestExportZips();
        if (cancelled || found.length === 0) return;
        const names = await Promise.all(found.map((p) => basename(p)));
        if (cancelled) return;
        setZipPaths(found);
        setZipLabels(names);
      } catch {
        /* sem auto-detecção — usuário escolhe manualmente */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !running) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, running]);

  async function pickZips() {
    const sel = await open({
      multiple: true,
      filters: [{ name: "Export do Claude (.zip)", extensions: ["zip"] }],
    });
    if (!sel) return;
    const arr = Array.isArray(sel) ? sel : [sel];
    const names = await Promise.all(arr.map((p) => basename(p)));
    setZipPaths(arr);
    setZipLabels(names);
  }

  async function pickOutDir() {
    const sel = await open({ directory: true });
    if (typeof sel === "string") setOutDir(sel);
  }

  async function run() {
    if (!zipPaths.length || !outDir) return;
    setRunning(true);
    setError(null);
    setResult(null);
    setFinalResult(null);
    setProgress({ phase: "Iniciando…", done: 0, total: 0 });
    try {
      const r = await importClaudeZips(zipPaths, outDir, setProgress);
      setResult(r);
      if (alsoFinal && finalDir) {
        const fr = await runCortesias(outDir, finalDir, setProgress);
        setFinalResult(fr);
      }
    } catch (e) {
      setError((e as Error).message ?? String(e));
    } finally {
      setRunning(false);
    }
  }

  function finish() {
    if (result && outDir) onImported(outDir);
    onClose();
  }

  const pct =
    progress && progress.total > 0
      ? Math.round((progress.done / progress.total) * 100)
      : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={() => !running && onClose()}
    >
      <div
        className="w-full max-w-lg rounded-lg border border-zinc-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="import-claude-title"
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
          <h2
            id="import-claude-title"
            className="text-sm font-semibold text-zinc-900"
          >
            Importar conversas do Claude
          </h2>
          <button
            type="button"
            onClick={() => !running && onClose()}
            className="text-zinc-400 hover:text-zinc-700 text-lg leading-none px-1 disabled:opacity-40"
            disabled={running}
            aria-label="Fechar"
          >
            ×
          </button>
        </div>

        {!isTauriRuntime() ? (
          <div className="p-4">
            <p className="text-sm text-zinc-600">
              A importação só funciona no app desktop (Tauri), que tem acesso
              nativo aos arquivos.
            </p>
          </div>
        ) : (
          <div className="p-4 space-y-4 text-sm">
            {/* Passo 1 — ZIP */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-medium text-zinc-800">
                  1. Export do Claude (.zip)
                </span>
                <button
                  type="button"
                  onClick={pickZips}
                  disabled={running}
                  className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
                >
                  Escolher ZIP…
                </button>
              </div>
              {zipLabels.length > 0 ? (
                <ul className="rounded border border-zinc-200 bg-zinc-50 p-2 text-xs text-zinc-600 max-h-24 overflow-y-auto">
                  {zipLabels.map((n, i) => (
                    <li key={i} className="truncate font-mono">
                      {n}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-zinc-500">
                  Nenhum <code>data-*.zip</code> encontrado em Downloads. Baixe o
                  export em Claude.ai → Settings → Privacy → Export data, deixe o
                  ZIP em Downloads e reabra, ou escolha manualmente.
                </p>
              )}
            </div>

            {/* Passo 2 — saída */}
            <div className="space-y-1.5 border-t border-zinc-100 pt-3">
              <div className="flex items-center justify-between">
                <span className="font-medium text-zinc-800">
                  2. Pasta de saída (.md)
                </span>
                <button
                  type="button"
                  onClick={pickOutDir}
                  disabled={running}
                  className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
                >
                  Escolher pasta…
                </button>
              </div>
              <p className="rounded border border-zinc-200 bg-zinc-50 p-2 text-xs font-mono text-zinc-600 break-all">
                {outDir ?? "— selecione uma pasta —"}
              </p>
              {outDir && outDir === vaultPath && (
                <p className="text-[11px] text-emerald-600">
                  É o cofre aberto: as conversas aparecem na lista após importar.
                </p>
              )}

              <label className="mt-2 flex items-start gap-2 text-xs text-zinc-700">
                <input
                  type="checkbox"
                  checked={alsoFinal}
                  onChange={(e) => setAlsoFinal(e.target.checked)}
                  disabled={running}
                  className="mt-0.5"
                />
                <span>
                  Também gerar versão <strong>sem cortesias</strong> (remove
                  "oi/obrigado/ok…") numa pasta <code>-FINAL</code> ao lado.
                  {alsoFinal && finalDir && (
                    <span className="mt-0.5 block break-all font-mono text-[11px] text-zinc-500">
                      {finalDir}
                    </span>
                  )}
                </span>
              </label>
            </div>

            {/* Progresso / resultado */}
            {progress && (
              <div className="border-t border-zinc-100 pt-3 space-y-2">
                <p className="text-xs text-zinc-600">{progress.phase}</p>
                <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200">
                  <div
                    className="h-full rounded-full bg-violet-600 transition-all"
                    style={{ width: `${pct ?? (running ? 30 : 100)}%` }}
                  />
                </div>
              </div>
            )}

            {result && (
              <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
                <p className="font-medium">Importação concluída.</p>
                <p className="mt-1">
                  {result.unique} conversa(s) única(s) · {result.written}{" "}
                  nota(s) gravada(s)
                  {result.empty > 0 ? ` · ${result.empty} vazia(s)` : ""}
                </p>
                {finalResult && (
                  <p className="mt-1 border-t border-emerald-200 pt-1">
                    Versão -FINAL: {finalResult.processed} limpa(s)
                    {finalResult.skipped > 0
                      ? ` · ${finalResult.skipped} já estavam atualizadas`
                      : ""}
                  </p>
                )}
              </div>
            )}

            {error && (
              <p className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700 break-words">
                {error}
              </p>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-zinc-200 px-4 py-3">
          {result ? (
            <button
              type="button"
              onClick={finish}
              className="rounded bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700"
            >
              Concluir e recarregar
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => !running && onClose()}
                disabled={running}
                className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={run}
                disabled={running || zipPaths.length === 0 || !outDir}
                className="rounded bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
              >
                {running ? "Importando…" : "Importar"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
