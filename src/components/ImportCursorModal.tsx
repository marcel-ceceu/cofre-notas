import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useVaultStore } from "../store/vaultStore";
import { type TauriDirHandle } from "../lib/fileSystem.tauri";
import { type ImportProgress } from "../lib/import/runImport";
import {
  importCursorTranscripts,
  listCursorTranscripts,
  reconcileCursor,
  type CursorImportResult,
  type CursorItem,
  type CursorStatus,
} from "../lib/import/runCursorImport";
import { CURSOR_SUBDIR, DEFAULT_IMPORT_OUT_DIR } from "../lib/import/dest";

type Props = {
  onClose: () => void;
  /** Chamado após importar com sucesso, com a pasta de saída. */
  onImported: (dest: string) => void;
};

type Phase = "scan" | "select" | "running" | "done";

const STATUS_LABEL: Record<CursorStatus, string> = {
  new: "nova",
  changed: "alterada",
  unchanged: "já no cofre",
  empty: "vazia",
};

const STATUS_CLASS: Record<CursorStatus, string> = {
  new: "bg-emerald-100 text-emerald-700",
  changed: "bg-amber-100 text-amber-700",
  unchanged: "bg-zinc-100 text-zinc-500",
  empty: "bg-zinc-100 text-zinc-400",
};

function joinWin(dir: string, name: string): string {
  const sep = dir.includes("\\") ? "\\" : "/";
  return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`;
}

function fmtDate(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function fmtKb(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function isSelectable(it: CursorItem): boolean {
  return it.status === "new" || it.status === "changed";
}

export function ImportCursorModal({ onClose, onImported }: Props) {
  const dirHandle = useVaultStore((s) => s.dirHandle);
  const vaultPath =
    dirHandle && (dirHandle as TauriDirHandle).kind === "tauri"
      ? (dirHandle as TauriDirHandle).path
      : null;

  const [phase, setPhase] = useState<Phase>("scan");
  // Destino: subpasta Cursor\ do cofre aberto (ou do cofre padrão).
  const [outDir, setOutDir] = useState<string>(() =>
    joinWin(vaultPath ?? DEFAULT_IMPORT_OUT_DIR, CURSOR_SUBDIR)
  );
  const [items, setItems] = useState<CursorItem[]>([]);
  const [scanErrors, setScanErrors] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [filter, setFilter] = useState("");
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [result, setResult] = useState<CursorImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const running = phase === "running";

  // Scan + reconcile ao abrir e sempre que a pasta de destino mudar.
  useEffect(() => {
    let cancelled = false;
    setPhase("scan");
    setError(null);
    (async () => {
      try {
        const { items: raw, errors } = await listCursorTranscripts();
        const recon = await reconcileCursor(raw, outDir, setProgress);
        if (cancelled) return;
        setItems(recon);
        setScanErrors(errors);
        setSelected(new Set(recon.filter(isSelectable).map((i) => i.uuid)));
        setProgress(null);
        setPhase("select");
      } catch (e) {
        if (cancelled) return;
        const msg = (e as Error).message ?? String(e);
        setError(
          /scan_cursor_transcripts/i.test(msg)
            ? "Este build do app ainda não tem o leitor do Cursor — atualize o app."
            : msg
        );
        setPhase("select");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [outDir]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !running) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, running]);

  const counts = useMemo(() => {
    const c: Record<CursorStatus, number> = { new: 0, changed: 0, unchanged: 0, empty: 0 };
    for (const it of items) c[it.status]++;
    return c;
  }, [items]);

  const projects = useMemo(() => new Set(items.map((i) => i.project)).size, [items]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return items.filter((it) => {
      if (!showUnchanged && it.status === "unchanged") return false;
      if (!q) return true;
      return (
        it.title.toLowerCase().includes(q) || it.project.toLowerCase().includes(q)
      );
    });
  }, [items, filter, showUnchanged]);

  const selectedItems = useMemo(
    () => items.filter((it) => selected.has(it.uuid)),
    [items, selected]
  );

  function toggle(uuid: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(uuid)) next.delete(uuid);
      else next.add(uuid);
      return next;
    });
  }

  function selectPending() {
    setSelected(new Set(items.filter(isSelectable).map((i) => i.uuid)));
  }

  function selectVisible() {
    setSelected(new Set(visible.filter((i) => i.status !== "empty").map((i) => i.uuid)));
  }

  async function pickOutDir() {
    const sel = await open({ directory: true });
    if (typeof sel === "string") setOutDir(sel);
  }

  async function run() {
    if (selectedItems.length === 0) return;
    setPhase("running");
    setError(null);
    setResult(null);
    setProgress({ phase: "Iniciando…", done: 0, total: selectedItems.length });
    try {
      const r = await importCursorTranscripts(selectedItems, outDir, setProgress);
      setResult(r);
      setPhase("done");
    } catch (e) {
      setError((e as Error).message ?? String(e));
      setPhase("select");
    }
  }

  function finish() {
    if (result) onImported(outDir);
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
        className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-lg border border-zinc-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="import-cursor-title"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-4 py-3">
          <h2 id="import-cursor-title" className="text-sm font-semibold text-zinc-900">
            Importar conversas do Cursor
          </h2>
          <button
            type="button"
            onClick={() => !running && onClose()}
            className="px-1 text-lg leading-none text-zinc-400 hover:text-zinc-700 disabled:opacity-40"
            disabled={running}
            aria-label="Fechar"
          >
            ×
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 p-4 text-sm">
          {/* Destino */}
          <div className="shrink-0 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-medium text-zinc-800">Pasta de saída (.md, sem cortesias)</span>
              <button
                type="button"
                onClick={pickOutDir}
                disabled={running || phase === "scan"}
                className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
              >
                Alterar pasta…
              </button>
            </div>
            <p className="break-all rounded border border-zinc-200 bg-zinc-50 p-2 font-mono text-xs text-zinc-600">
              {outDir}
            </p>
          </div>

          {phase === "scan" && (
            <div className="space-y-2 border-t border-zinc-100 pt-3">
              <p className="text-xs text-zinc-600">
                {progress?.phase ?? "Localizando conversas do Cursor…"}
              </p>
              <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200">
                <div className="h-full w-[30%] animate-pulse rounded-full bg-violet-600" />
              </div>
            </div>
          )}

          {(phase === "select" || phase === "running") && items.length > 0 && (
            <>
              {/* Resumo + filtro */}
              <div className="shrink-0 space-y-2 border-t border-zinc-100 pt-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-600">
                  <span>
                    <strong className="text-zinc-800">{items.length}</strong> conversa(s) em{" "}
                    <strong className="text-zinc-800">{projects}</strong> projeto(s)
                  </span>
                  <span className="text-emerald-700">{counts.new} nova(s)</span>
                  <span className="text-amber-700">{counts.changed} alterada(s)</span>
                  <span className="text-zinc-500">{counts.unchanged} já no cofre</span>
                  {counts.empty > 0 && (
                    <span className="text-zinc-400">{counts.empty} vazia(s)</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="search"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Filtrar por título ou projeto…"
                    disabled={running}
                    className="min-w-0 flex-1 rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-800 placeholder:text-zinc-400 focus:border-violet-400 focus:outline-none disabled:opacity-40"
                  />
                  <label className="flex shrink-0 items-center gap-1 text-[11px] text-zinc-600">
                    <input
                      type="checkbox"
                      checked={showUnchanged}
                      onChange={(e) => setShowUnchanged(e.target.checked)}
                      disabled={running}
                    />
                    mostrar já importadas
                  </label>
                </div>
                <div className="flex items-center gap-2 text-[11px]">
                  <button
                    type="button"
                    onClick={selectPending}
                    disabled={running}
                    className="rounded border border-zinc-300 px-2 py-0.5 text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
                  >
                    Marcar novas + alteradas
                  </button>
                  <button
                    type="button"
                    onClick={selectVisible}
                    disabled={running}
                    className="rounded border border-zinc-300 px-2 py-0.5 text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
                  >
                    Marcar visíveis
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelected(new Set())}
                    disabled={running}
                    className="rounded border border-zinc-300 px-2 py-0.5 text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
                  >
                    Desmarcar todas
                  </button>
                  <span className="ml-auto text-zinc-500">
                    {selectedItems.length} selecionada(s)
                  </span>
                </div>
              </div>

              {/* Lista */}
              <ul className="min-h-0 flex-1 divide-y divide-zinc-100 overflow-y-auto rounded border border-zinc-200">
                {visible.length === 0 && (
                  <li className="p-3 text-xs text-zinc-500">Nada a mostrar com esse filtro.</li>
                )}
                {visible.map((it) => {
                  const disabled = running || it.status === "empty";
                  return (
                    <li key={it.uuid}>
                      <label
                        className={`flex cursor-pointer items-start gap-2 px-2 py-1.5 hover:bg-zinc-50 ${
                          it.status === "empty" ? "opacity-50" : ""
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5 shrink-0"
                          checked={selected.has(it.uuid)}
                          onChange={() => toggle(it.uuid)}
                          disabled={disabled}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] text-zinc-800" title={it.title}>
                            {it.title}
                          </span>
                          <span
                            className="block truncate font-mono text-[10.5px] text-zinc-500"
                            title={it.project}
                          >
                            {it.project} · {fmtDate(it.createdMs)} · {fmtKb(it.sizeBytes)} ·{" "}
                            {it.userTurns} pergunta(s)
                          </span>
                        </span>
                        <span
                          className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_CLASS[it.status]}`}
                        >
                          {STATUS_LABEL[it.status]}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {phase === "select" && items.length === 0 && !error && (
            <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700">
              Nenhum transcript encontrado em <code>~\.cursor\projects</code>.
            </p>
          )}

          {scanErrors.length > 0 && (
            <p className="shrink-0 text-[11px] text-zinc-500">
              {scanErrors.length} arquivo(s) ilegível(is) ignorado(s).
            </p>
          )}

          {(phase === "running" || phase === "done") && progress && (
            <div className="shrink-0 space-y-2 border-t border-zinc-100 pt-3">
              <p className="truncate text-xs text-zinc-600">{progress.phase}</p>
              <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200">
                <div
                  className="h-full rounded-full bg-violet-600 transition-all"
                  style={{ width: `${pct ?? (running ? 30 : 100)}%` }}
                />
              </div>
            </div>
          )}

          {result && (
            <div className="shrink-0 rounded border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
              <p className="font-medium">Importação concluída (sem duplicatas).</p>
              <p className="mt-1">
                {result.selected} selecionada(s) · {result.written} nova(s)
                {result.updated > 0 ? ` · ${result.updated} atualizada(s)` : ""}
                {result.unchanged > 0 ? ` · ${result.unchanged} já estavam em dia` : ""}
                {result.empty > 0 ? ` · ${result.empty} vazia(s)` : ""}
                {result.failed > 0 ? ` · ${result.failed} com falha` : ""}
              </p>
            </div>
          )}

          {error && (
            <p className="shrink-0 break-words rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
              {error}
            </p>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-zinc-200 px-4 py-3">
          {phase === "done" ? (
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
                disabled={running || phase !== "select" || selectedItems.length === 0}
                className="rounded bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
              >
                {running ? "Importando…" : `Importar ${selectedItems.length} selecionada(s)`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
