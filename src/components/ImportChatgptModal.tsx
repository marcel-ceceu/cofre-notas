import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useVaultStore } from "../store/vaultStore";
import { type TauriDirHandle } from "../lib/fileSystem.tauri";
import { isDesktopShell } from "../lib/runtime/shell";
import { type ImportProgress } from "../lib/import/runImport";
import {
  importarChatgpt,
  planejarImportChatgpt,
  type ChatgptImportResult,
  type ChatgptPlano,
} from "../lib/import/runChatgptImport";
import { vaiParaOCofre, type ChatgptStatus } from "../lib/import/chatgptImport";
import {
  CHATGPT_SUBDIR,
  DEFAULT_IMPORT_OUT_DIR,
  conversasDir,
  joinWin,
} from "../lib/import/dest";

type Props = {
  onClose: () => void;
  /** Chamado após gravar, com a pasta de saída. */
  onImported: (dest: string) => void;
};

type Phase = "scan" | "review" | "running" | "done";

const ORDEM: ChatgptStatus[] = ["nova", "alterada", "em-dia", "duplicada", "fora-do-padrao", "vazia"];

const STATUS_LABEL: Record<ChatgptStatus, string> = {
  nova: "nova",
  alterada: "alterada",
  "em-dia": "já no cofre",
  duplicada: "duplicada",
  "fora-do-padrao": "fora do padrão",
  vazia: "vazia",
};

const STATUS_CLASS: Record<ChatgptStatus, string> = {
  nova: "bg-emerald-100 text-emerald-700",
  alterada: "bg-amber-100 text-amber-700",
  "em-dia": "bg-zinc-100 text-zinc-500",
  duplicada: "bg-zinc-100 text-zinc-500",
  "fora-do-padrao": "bg-red-100 text-red-700",
  vazia: "bg-zinc-100 text-zinc-400",
};

const COUNT_CLASS: Partial<Record<ChatgptStatus, string>> = {
  nova: "text-emerald-700",
  alterada: "text-amber-700",
  "fora-do-padrao": "text-red-700",
};

function fmtData(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

/** Passos 2 e 3 do ChatGPT: conferir os .md baixados e levar ao cofre sem cortesias. */
export function ImportChatgptModal({ onClose, onImported }: Props) {
  const dirHandle = useVaultStore((s) => s.dirHandle);
  const vaultPath =
    dirHandle && (dirHandle as TauriDirHandle).kind === "tauri"
      ? (dirHandle as TauriDirHandle).path
      : null;

  const srcDir = conversasDir("chatgpt");
  const [outDir, setOutDir] = useState<string>(() =>
    joinWin(vaultPath ?? DEFAULT_IMPORT_OUT_DIR, CHATGPT_SUBDIR)
  );
  const [phase, setPhase] = useState<Phase>("scan");
  const [plano, setPlano] = useState<ChatgptPlano | null>(null);
  const [mostrarEmDia, setMostrarEmDia] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [result, setResult] = useState<ChatgptImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const running = phase === "running";

  // Passo 2 ao abrir e sempre que o destino mudar: lê os originais e confere com o cofre.
  useEffect(() => {
    let cancelled = false;
    setPhase("scan");
    setError(null);
    setPlano(null);
    (async () => {
      if (!isDesktopShell()) {
        setError("Levar as conversas do ChatGPT para o cofre só funciona no app instalado (Windows).");
        setPhase("review");
        return;
      }
      try {
        const p = await planejarImportChatgpt(srcDir, outDir, setProgress);
        if (cancelled) return;
        setPlano(p);
        setProgress(null);
        setPhase("review");
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message ?? String(e));
        setPhase("review");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [srcDir, outDir]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !running) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, running]);

  const itens = useMemo(() => plano?.itens ?? [], [plano]);

  const counts = useMemo(() => {
    const c = Object.fromEntries(ORDEM.map((s) => [s, 0])) as Record<ChatgptStatus, number>;
    for (const it of itens) c[it.status]++;
    return c;
  }, [itens]);

  const fila = useMemo(() => itens.filter(vaiParaOCofre), [itens]);
  const convertidas = useMemo(() => fila.filter((i) => i.convertida).length, [fila]);
  const visiveis = useMemo(
    () => itens.filter((it) => mostrarEmDia || it.status !== "em-dia"),
    [itens, mostrarEmDia]
  );

  async function pickOutDir() {
    const sel = await open({ directory: true });
    if (typeof sel === "string") setOutDir(sel);
  }

  async function run() {
    if (fila.length === 0) return;
    setPhase("running");
    setError(null);
    setProgress({ phase: "Iniciando…", done: 0, total: fila.length });
    try {
      setResult(await importarChatgpt(fila, outDir, setProgress));
      setPhase("done");
    } catch (e) {
      setError((e as Error).message ?? String(e));
      setPhase("review");
    }
  }

  function finish() {
    if (result) onImported(outDir);
    onClose();
  }

  const pct =
    progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={() => !running && onClose()}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-lg border border-zinc-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="import-chatgpt-title"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-4 py-3">
          <h2 id="import-chatgpt-title" className="text-sm font-semibold text-zinc-900">
            Levar conversas do ChatGPT para o cofre
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
          <p className="shrink-0 text-xs leading-relaxed text-zinc-600">
            Confere as conversas baixadas (duplicatas e padrão do Cofre), tira as cortesias e grava
            uma nota por conversa. Os arquivos originais não são alterados.
          </p>

          <div className="shrink-0 space-y-1.5">
            <span className="font-medium text-zinc-800">Conversas baixadas (origem)</span>
            <p className="break-all rounded border border-zinc-200 bg-zinc-50 p-2 font-mono text-xs text-zinc-600">
              {srcDir}
            </p>
          </div>

          <div className="shrink-0 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-medium text-zinc-800">Pasta no cofre (.md, sem cortesias)</span>
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
                {progress
                  ? `${progress.phase} (${progress.done}/${progress.total})`
                  : "Lendo as conversas baixadas…"}
              </p>
              <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200">
                <div className="h-full w-[30%] animate-pulse rounded-full bg-violet-600" />
              </div>
            </div>
          )}

          {phase !== "scan" && itens.length > 0 && (
            <>
              <div className="shrink-0 space-y-2 border-t border-zinc-100 pt-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-600">
                  <span>
                    <strong className="text-zinc-800">{itens.length}</strong> arquivo(s)
                  </span>
                  {ORDEM.filter((s) => counts[s] > 0).map((s) => (
                    <span key={s} className={COUNT_CLASS[s] ?? "text-zinc-500"}>
                      {counts[s]} {STATUS_LABEL[s]}
                    </span>
                  ))}
                </div>
                {convertidas > 0 && (
                  <p className="text-[11px] text-zinc-500">
                    {convertidas} no formato antigo do exportador: convertidas para o padrão do Cofre ao gravar.
                  </p>
                )}
                <label className="flex items-center gap-1 text-[11px] text-zinc-600">
                  <input
                    type="checkbox"
                    checked={mostrarEmDia}
                    onChange={(e) => setMostrarEmDia(e.target.checked)}
                    disabled={running}
                  />
                  mostrar as que já estão no cofre
                </label>
              </div>

              <ul className="min-h-0 flex-1 divide-y divide-zinc-100 overflow-y-auto rounded border border-zinc-200">
                {visiveis.length === 0 && (
                  <li className="p-3 text-xs text-zinc-500">
                    Tudo já está no cofre — nada novo para gravar.
                  </li>
                )}
                {visiveis.map((it) => (
                  <li key={it.nome} className="flex items-start gap-2 px-2 py-1.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] text-zinc-800" title={it.title}>
                        {it.title}
                      </span>
                      <span className="block truncate font-mono text-[10.5px] text-zinc-500" title={it.nome}>
                        {fmtData(it.updated)} · {it.nome}
                      </span>
                      {(it.motivo || it.aviso) && (
                        <span className={`block text-[10.5px] ${it.motivo ? "text-red-600" : "text-amber-700"}`}>
                          {it.motivo ?? it.aviso}
                        </span>
                      )}
                    </span>
                    <span
                      className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_CLASS[it.status]}`}
                    >
                      {STATUS_LABEL[it.status]}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}

          {phase === "review" && plano && itens.length === 0 && (
            <p className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-700">
              Nenhuma conversa em <code>{srcDir}</code>. Baixe primeiro pelo exportador (Chrome ou janela do app).
            </p>
          )}

          {plano && plano.ilegiveis.length > 0 && (
            <p className="shrink-0 text-[11px] text-zinc-500">
              {plano.ilegiveis.length} arquivo(s) ilegível(is) ignorado(s): {plano.ilegiveis.join(", ")}
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
              <p className="font-medium">Gravado no cofre, sem duplicatas e sem cortesias.</p>
              <p className="mt-1">
                {result.written} nova(s)
                {result.updated > 0 ? ` · ${result.updated} atualizada(s)` : ""}
                {result.unchanged > 0 ? ` · ${result.unchanged} já estavam em dia` : ""}
                {result.failed > 0 ? ` · ${result.failed} com falha (veja o console, F12)` : ""}
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
                disabled={running || phase !== "review" || fila.length === 0}
                className="rounded bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
              >
                {running ? "Gravando…" : `Levar ${fila.length} para o cofre`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
