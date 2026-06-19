import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { Note } from "../lib/fileSystem";
import { useVaultStore } from "../store/vaultStore";
import { isTauriRuntime, type TauriDirHandle } from "../lib/fileSystem.tauri";
import {
  runCopyFiles,
  runConsolidate,
  runConsolidateAI,
  runLlms,
  type ExportProgress,
} from "../lib/export/runExport";
import { resolvePastedPaths } from "../lib/export/resolvePaths";
import {
  loadAiPrefs,
  saveAiPrefs,
  DEFAULT_AI_PREFS,
  type AiPrefs,
} from "../lib/export/aiPrefs";
import { AiSettingsModal } from "./AiSettingsModal";

type Props = {
  notes: Note[];
  onClose: () => void;
};

export function ConsolidateModal({ notes, onClose }: Props) {
  const dirHandle = useVaultStore((s) => s.dirHandle);
  const allNotes = useVaultStore((s) => s.notes);
  const vaultLabel =
    dirHandle && (dirHandle as TauriDirHandle).kind === "tauri"
      ? (dirHandle as TauriDirHandle).path
          .replace(/[\\/]+$/, "")
          .split(/[\\/]/)
          .pop() || "cofre"
      : "cofre";

  const [destDir, setDestDir] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiPrefs, setAiPrefs] = useState<AiPrefs>(DEFAULT_AI_PREFS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [source, setSource] = useState<"search" | "paste">("search");
  const [pasteText, setPasteText] = useState("");

  const resolved = useMemo(
    () => resolvePastedPaths(pasteText, allNotes),
    [pasteText, allNotes]
  );
  // O que será exportado: resultados da busca OU a lista colada (resolvida).
  const targetNotes = source === "search" ? notes : resolved.matched;

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    void (async () => {
      const p = await loadAiPrefs();
      if (!cancelled) setAiPrefs(p);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !running && !settingsOpen) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, running, settingsOpen]);

  async function pickDest() {
    const sel = await open({ directory: true });
    if (typeof sel === "string") setDestDir(sel);
  }

  function requireKey(): boolean {
    if (!aiPrefs.apiKey.trim()) {
      setSettingsOpen(true);
      return false;
    }
    return true;
  }

  async function wrap(mode: string, fn: () => Promise<string>) {
    if (!destDir) return;
    setRunning(mode);
    setError(null);
    setDoneMsg(null);
    setProgress({ phase: "Iniciando…", done: 0, total: targetNotes.length });
    try {
      setDoneMsg(await fn());
    } catch (e) {
      setError((e as Error).message ?? String(e));
    } finally {
      setRunning(null);
    }
  }

  const doCopy = () =>
    wrap("copy", async () => {
      const r = await runCopyFiles(targetNotes, destDir!, setProgress);
      return `${r.copied}/${r.total} arquivo(s) copiado(s) para "${r.subfolder}".`;
    });

  const doConsolidate = () =>
    wrap("merge", async () => {
      const r = await runConsolidate(targetNotes, destDir!, vaultLabel, setProgress);
      return `Consolidado gravado: ${r.file} (${r.count} conversas).`;
    });

  const doConsolidateAI = () => {
    if (!requireKey()) return;
    return wrap("merge-ai", async () => {
      const r = await runConsolidateAI(
        targetNotes,
        destDir!,
        vaultLabel,
        aiPrefs.apiKey,
        aiPrefs.model,
        aiPrefs.prompt,
        setProgress
      );
      return `Consolidado com IA: ${r.file} (${r.count} conversas${
        r.failed ? `, ${r.failed} sem resumo` : ""
      }).`;
    });
  };

  const doLlms = () => {
    if (!requireKey()) return;
    return wrap("llms", async () => {
      const r = await runLlms(
        targetNotes,
        destDir!,
        aiPrefs.apiKey,
        aiPrefs.model,
        aiPrefs.prompt,
        setProgress
      );
      return `Copiado + llms.txt em "${r.subfolder}" (${r.copied} arquivos${
        r.failed ? `, ${r.failed} sem resumo` : ""
      }).`;
    });
  };

  const busy = running !== null;
  const pct =
    progress && progress.total > 0
      ? Math.round((progress.done / progress.total) * 100)
      : null;
  const canRun = !!destDir && targetNotes.length > 0 && !busy;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={() => !busy && !settingsOpen && onClose()}
    >
      <div
        className="w-full max-w-lg rounded-lg border border-zinc-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="consolidate-title"
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
          <h2 id="consolidate-title" className="text-sm font-semibold text-zinc-900">
            Exportar resultados da busca
          </h2>
          <button
            type="button"
            onClick={() => !busy && onClose()}
            disabled={busy}
            className="text-zinc-400 hover:text-zinc-700 text-lg leading-none px-1 disabled:opacity-40"
            aria-label="Fechar"
          >
            ×
          </button>
        </div>

        {!isTauriRuntime() ? (
          <div className="p-4">
            <p className="text-sm text-zinc-600">
              A exportação só funciona no app desktop (Tauri).
            </p>
          </div>
        ) : (
          <div className="p-4 space-y-4 text-sm">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium text-zinc-800">Fonte</span>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-50"
                >
                  ⚙ Config. IA{aiPrefs.apiKey ? "" : " (sem chave)"}
                </button>
              </div>

              <div className="flex gap-1 rounded-lg bg-zinc-100 p-1">
                <SourceSeg
                  active={source === "search"}
                  onClick={() => setSource("search")}
                >
                  Resultados da busca ({notes.length})
                </SourceSeg>
                <SourceSeg
                  active={source === "paste"}
                  onClick={() => setSource("paste")}
                >
                  Colar caminhos
                </SourceSeg>
              </div>

              {source === "paste" && (
                <div className="space-y-1">
                  <textarea
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    rows={5}
                    placeholder={
                      "Cole um caminho/arquivo por linha, ex.:\n2026-06-17-Diagnostico.md\n2026-06-16-Analise.md"
                    }
                    className="w-full resize-none rounded border border-zinc-300 bg-white p-2 text-xs font-mono text-zinc-800 focus:outline-none focus:ring-1 focus:ring-violet-400"
                  />
                  <p className="text-[11px] text-zinc-500">
                    {resolved.matched.length} encontrada(s)
                    {resolved.notFound.length > 0 && (
                      <span className="text-amber-600">
                        {" "}
                        · {resolved.notFound.length} não encontrada(s)
                      </span>
                    )}
                  </p>
                </div>
              )}

              <p className="text-xs text-zinc-600">
                Exportando <strong>{targetNotes.length}</strong> nota(s).
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-medium text-zinc-800">Pasta destino</span>
                <button
                  type="button"
                  onClick={pickDest}
                  disabled={busy}
                  className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
                >
                  Escolher pasta…
                </button>
              </div>
              <p className="rounded border border-zinc-200 bg-zinc-50 p-2 text-xs font-mono text-zinc-600 break-all">
                {destDir ?? "— selecione uma pasta —"}
              </p>
            </div>

            <div className="space-y-2 border-t border-zinc-100 pt-3">
              <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                Sem IA
              </p>
              <div className="grid grid-cols-2 gap-2">
                <ActionBtn
                  label="Copiar arquivos"
                  hint="cada .md numa subpasta datada"
                  busy={running === "copy"}
                  disabled={!canRun}
                  onClick={doCopy}
                />
                <ActionBtn
                  label="Consolidar (1 .md)"
                  hint="índice + transcrições"
                  primary
                  busy={running === "merge"}
                  disabled={!canRun}
                  onClick={doConsolidate}
                />
              </div>

              <p className="pt-1 text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                Com IA (resumos + tags)
              </p>
              <div className="grid grid-cols-2 gap-2">
                <ActionBtn
                  label="Consolidar com IA"
                  hint="resumo por conversa"
                  primary
                  busy={running === "merge-ai"}
                  disabled={!canRun}
                  onClick={doConsolidateAI}
                />
                <ActionBtn
                  label="Copiar + llms.txt"
                  hint="índice p/ LLM"
                  busy={running === "llms"}
                  disabled={!canRun}
                  onClick={doLlms}
                />
              </div>
            </div>

            {progress && (
              <div className="space-y-1">
                <p className="text-xs text-zinc-600">{progress.phase}</p>
                <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200">
                  <div
                    className="h-full rounded-full bg-violet-600 transition-all"
                    style={{ width: `${pct ?? (busy ? 30 : 100)}%` }}
                  />
                </div>
              </div>
            )}

            {doneMsg && (
              <p className="rounded border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-800">
                {doneMsg}
              </p>
            )}
            {error && (
              <p className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700 break-words">
                {error}
              </p>
            )}
          </div>
        )}

        <div className="flex justify-end border-t border-zinc-200 px-4 py-3">
          <button
            type="button"
            onClick={() => !busy && onClose()}
            disabled={busy}
            className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
          >
            Fechar
          </button>
        </div>
      </div>

      {settingsOpen && (
        <AiSettingsModal
          initial={aiPrefs}
          onClose={() => setSettingsOpen(false)}
          onSave={(p) => {
            setAiPrefs(p);
            void saveAiPrefs(p);
          }}
        />
      )}
    </div>
  );
}

function SourceSeg({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
        active
          ? "bg-violet-600 text-white shadow-sm"
          : "text-zinc-600 hover:bg-zinc-100"
      }`}
    >
      {children}
    </button>
  );
}

function ActionBtn({
  label,
  hint,
  primary,
  busy,
  disabled,
  onClick,
}: {
  label: string;
  hint: string;
  primary?: boolean;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md px-3 py-2 text-xs font-medium disabled:opacity-50 ${
        primary
          ? "bg-violet-600 text-white hover:bg-violet-700"
          : "border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50"
      }`}
    >
      {busy ? "Processando…" : label}
      <span
        className={`mt-0.5 block text-[10px] font-normal ${
          primary ? "text-violet-100" : "text-zinc-500"
        }`}
      >
        {hint}
      </span>
    </button>
  );
}
