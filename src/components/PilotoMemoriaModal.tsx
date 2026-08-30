import { useEffect, useRef, useState } from "react";
import { PilotoIcon } from "./icons";
import { isTauriRuntime } from "../lib/fileSystem.tauri";
import {
  defaultScriptPath,
  manualCommand,
  pickConversationFiles,
  runPiloto,
  type PilotoHandle,
  type PilotoLine,
} from "../lib/piloto/runPiloto";

type Props = {
  onClose: () => void;
};

type Stage = "intro" | "running" | "done";

const SCRIPT_PREF_KEY = "cofre.piloto.scriptPath";
const MAX_LINES = 600;

/**
 * Piloto de memória: recorta as conversas escolhidas em memórias auditáveis
 * (pipeline C+ local) rodando o PowerShell de produção com o log em tempo real.
 */
export function PilotoMemoriaModal({ onClose }: Props) {
  const desktop = isTauriRuntime();

  const [stage, setStage] = useState<Stage>("intro");
  const [files, setFiles] = useState<string[]>([]);
  const [scriptPath, setScriptPath] = useState("");
  const [showScript, setShowScript] = useState(false);
  const [lines, setLines] = useState<PilotoLine[]>([]);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleRef = useRef<PilotoHandle | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const lineId = useRef(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = localStorage.getItem(SCRIPT_PREF_KEY);
      if (saved) {
        setScriptPath(saved);
        return;
      }
      if (!desktop) return;
      try {
        const suggested = await defaultScriptPath();
        if (!cancelled) setScriptPath(suggested);
      } catch {
        // sem home resolvido — usuário digita o caminho
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [desktop]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines]);

  useEffect(() => {
    return () => {
      handleRef.current?.cancel();
    };
  }, []);

  function pushLine(text: string, stream: "out" | "err") {
    lineId.current += 1;
    const entry = { id: lineId.current, text, stream };
    setLines((prev) =>
      prev.length >= MAX_LINES
        ? [...prev.slice(prev.length - MAX_LINES + 1), entry]
        : [...prev, entry]
    );
  }

  async function handlePick() {
    setError(null);
    try {
      const picked = await pickConversationFiles();
      if (picked.length) setFiles(picked);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function handleRun() {
    if (!files.length || !scriptPath.trim()) return;
    localStorage.setItem(SCRIPT_PREF_KEY, scriptPath.trim());
    setError(null);
    setLines([]);
    setExitCode(null);
    setStage("running");

    try {
      handleRef.current = await runPiloto({
        scriptPath: scriptPath.trim(),
        files,
        onLine: pushLine,
        onExit: (code) => {
          setExitCode(code);
          setStage("done");
          handleRef.current = null;
        },
        onError: (message) => {
          setError(message);
          setStage("done");
          handleRef.current = null;
        },
      });
    } catch (e) {
      setError((e as Error).message);
      setStage("intro");
    }
  }

  async function handleCancel() {
    await handleRef.current?.cancel();
    handleRef.current = null;
    setStage("done");
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(manualCommand(scriptPath, files));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Não foi possível copiar para a área de transferência.");
    }
  }

  const running = stage === "running";
  const canRun = files.length > 0 && scriptPath.trim().length > 0 && !running;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={() => !running && onClose()}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-lg border border-zinc-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="piloto-title"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-zinc-200 px-4 py-3">
          <PilotoIcon className="h-[18px] w-[18px] text-violet-600" />
          <h2
            id="piloto-title"
            className="flex-1 text-sm font-semibold text-zinc-900"
          >
            Piloto de memória — destilar conversas
          </h2>
          <button
            type="button"
            onClick={() => !running && onClose()}
            disabled={running}
            className="px-1 text-lg leading-none text-zinc-400 hover:text-zinc-700 disabled:opacity-40"
            aria-label="Fechar"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-sm">
          <div className="rounded-md border border-violet-100 bg-violet-50/60 p-3 text-[13px] leading-relaxed text-zinc-700">
            <p>
              Escolha uma ou mais conversas <code>.md</code> do seu computador.
              O piloto lê cada uma com o modelo local, separa o que é{" "}
              <strong>fato comprovado</strong> do que é apenas plano, sugestão
              ou hipótese, e guarda só o que sobrevive — com a citação original
              que prova cada afirmação.
            </p>
            <p className="mt-2 text-zinc-500">
              É demorado: alguns minutos por conversa. Nada é gravado na memória
              de produção — todo resultado fica isolado num build de teste.
            </p>
          </div>

          {!desktop && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900">
              Você está no navegador, que por segurança não executa programas
              nem enxerga o caminho real dos seus arquivos. Abra o app desktop
              para rodar com um clique — ou monte o comando abaixo e cole no
              PowerShell.
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-zinc-800">Conversas</span>
              <button
                type="button"
                onClick={handlePick}
                disabled={!desktop || running}
                className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
              >
                Escolher arquivos…
              </button>
            </div>

            {files.length === 0 ? (
              <p className="rounded border border-dashed border-zinc-300 p-3 text-center text-xs text-zinc-500">
                Nenhuma conversa escolhida. Use Ctrl+clique para marcar várias.
              </p>
            ) : (
              <ul className="max-h-32 space-y-0.5 overflow-y-auto rounded border border-zinc-200 bg-zinc-50 p-2">
                {files.map((f) => (
                  <li
                    key={f}
                    className="truncate font-mono text-[11px] text-zinc-600"
                    title={f}
                  >
                    {f.split(/[\\/]/).pop()}
                  </li>
                ))}
              </ul>
            )}

            {files.length > 0 && (
              <p className="text-xs text-zinc-500">
                <strong>{files.length}</strong> conversa(s) selecionada(s).
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <button
              type="button"
              onClick={() => setShowScript((v) => !v)}
              className="text-[11px] text-zinc-500 underline-offset-2 hover:underline"
            >
              {showScript ? "Ocultar" : "Ver"} script do piloto
            </button>
            {showScript && (
              <input
                type="text"
                value={scriptPath}
                onChange={(e) => setScriptPath(e.target.value)}
                disabled={running}
                spellCheck={false}
                className="w-full rounded border border-zinc-300 bg-white p-2 font-mono text-[11px] text-zinc-700 focus:outline-none focus:ring-1 focus:ring-violet-400 disabled:bg-zinc-50"
                placeholder="Caminho do .ps1 do piloto"
              />
            )}
          </div>

          {(running || lines.length > 0) && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-medium text-zinc-800">
                  {running ? "Processando…" : "Log"}
                </span>
                <span className="text-[11px] tabular-nums text-zinc-500">
                  {running && (
                    <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-violet-500 align-middle" />
                  )}
                  {lines.length} linha(s)
                </span>
              </div>
              <div
                ref={logRef}
                className="h-56 overflow-y-auto rounded border border-zinc-800 bg-zinc-900 p-2 font-mono text-[11px] leading-relaxed text-zinc-300"
              >
                {lines.map((l) => (
                  <p
                    key={l.id}
                    className={`whitespace-pre-wrap break-all ${
                      l.stream === "err" ? "text-red-400" : ""
                    }`}
                  >
                    {l.text}
                  </p>
                ))}
                {running && lines.length === 0 && (
                  <p className="text-zinc-500">iniciando o PowerShell…</p>
                )}
              </div>
            </div>
          )}

          {stage === "done" && exitCode !== null && (
            <div
              className={`rounded-md border p-3 text-[13px] ${
                exitCode === 0
                  ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                  : "border-amber-200 bg-amber-50 text-amber-900"
              }`}
            >
              {exitCode === 0
                ? "Concluído. O relatório do build foi aberto pelo próprio script."
                : `O piloto terminou com código ${exitCode}. O log acima e o relatório do build explicam o motivo.`}
            </div>
          )}

          {error && (
            <p className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
              {error}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-zinc-200 px-4 py-3">
          {!desktop && files.length === 0 && (
            <p className="mr-auto text-[11px] text-zinc-500">
              No navegador não é possível escolher arquivos do PC.
            </p>
          )}

          {!desktop && files.length > 0 && (
            <button
              type="button"
              onClick={handleCopy}
              className="rounded border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50"
            >
              {copied ? "Copiado!" : "Copiar comando"}
            </button>
          )}

          {running ? (
            <button
              type="button"
              onClick={handleCancel}
              className="rounded border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
            >
              Interromper
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                className="rounded border border-zinc-300 px-3 py-1.5 text-xs text-zinc-700 hover:bg-zinc-50"
              >
                Fechar
              </button>
              <button
                type="button"
                onClick={handleRun}
                disabled={!desktop || !canRun}
                className="rounded bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-40"
              >
                {stage === "done" ? "Rodar de novo" : "Avançar"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
