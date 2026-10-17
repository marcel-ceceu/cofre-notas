import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { basename } from "@tauri-apps/api/path";
import { useVaultStore } from "../store/vaultStore";
import { isTauriRuntime, type TauriDirHandle } from "../lib/fileSystem.tauri";
import {
  findLatestExportZips,
  importClaudeZips,
  isCompatibleClaudeZip,
  type ImportProgress,
  type ImportResult,
} from "../lib/import/runImport";
import {
  importClaudeZipsWeb,
  isCompatibleClaudeZipFile,
} from "../lib/import/webVault";
import { DEFAULT_IMPORT_OUT_DIR } from "../lib/import/dest";
import {
  conversationDownloadsFromManifest,
  parseClaudeExportManifest,
} from "../lib/import/claudeExportManifest";
import { ClaudeManifestLinksModal } from "./ClaudeManifestLinksModal";
import { CLAUDE_WEB_PIPELINE_STEPS } from "./claudeWebFlow";

type Props = {
  onClose: () => void;
  /** Chamado após importar com sucesso: pasta de saída (desktop) ou "web" (navegador). */
  onImported: (dest: string) => void;
};

/** Pasta de saída padrão oficial do fluxo. */
const DEFAULT_OUT_DIR = DEFAULT_IMPORT_OUT_DIR;

/** Link para solicitar o export das conversas no Claude.ai. */
const EXPORT_URL = "https://claude.ai/settings/data-privacy-controls";
/** Link do e-mail onde o export chega (Google Workspace). */
const EMAIL_URL = "https://mail.google.com/";

type Step = "intro" | "manifest" | "convert";

export function ImportClaudeModal({ onClose, onImported }: Props) {
  const dirHandle = useVaultStore((s) => s.dirHandle);
  const vaultPath =
    dirHandle && (dirHandle as TauriDirHandle).kind === "tauri"
      ? (dirHandle as TauriDirHandle).path
      : null;

  const [step, setStep] = useState<Step>("intro");
  const [zipPaths, setZipPaths] = useState<string[]>([]);
  const [zipFiles, setZipFiles] = useState<File[]>([]); // fallback web
  const [zipLabels, setZipLabels] = useState<string[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  const [outDir, setOutDir] = useState<string>(DEFAULT_OUT_DIR);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const manifestInputRef = useRef<HTMLInputElement>(null);
  const [manifestPopup, setManifestPopup] = useState<{
    downloads: ReturnType<typeof conversationDownloadsFromManifest>;
    createdAt?: string;
  } | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [manifestDone, setManifestDone] = useState(false);

  const tauri = isTauriRuntime();
  const hasZips = tauri ? zipPaths.length > 0 : zipFiles.length > 0;

  // Auto-detecta o export mais recente em Downloads ao entrar na etapa de conversão.
  useEffect(() => {
    if (step !== "convert" || !isTauriRuntime()) return;
    let cancelled = false;
    (async () => {
      try {
        const found = await findLatestExportZips();
        if (cancelled || found.length === 0) return;
        const ok: string[] = [];
        const bad: string[] = [];
        for (const p of found) {
          if (await isCompatibleClaudeZip(p)) ok.push(p);
          else bad.push(p);
        }
        if (cancelled) return;
        if (bad.length > 0) setRejected(await Promise.all(bad.map((p) => basename(p))));
        if (cancelled || ok.length === 0) return;
        const names = await Promise.all(ok.map((p) => basename(p)));
        if (cancelled) return;
        setZipPaths(ok);
        setZipLabels(names);
      } catch {
        /* sem auto-detecção — usuário escolhe manualmente */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step]);

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape" && !running) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, running]);

  async function openExternal(url: string) {
    try {
      if (tauri) await openUrl(url);
      else window.open(url, "_blank", "noopener");
    } catch (e) {
      console.error("[import] falha ao abrir link", url, e);
    }
  }

  async function pickZips() {
    if (!tauri) {
      fileInputRef.current?.click();
      return;
    }
    const sel = await open({
      multiple: true,
      filters: [{ name: "Export do Claude (.zip)", extensions: ["zip"] }],
    });
    if (!sel) return;
    const arr = Array.isArray(sel) ? sel : [sel];

    setChecking(true);
    setError(null);
    try {
      const accepted: string[] = [];
      const bad: string[] = [];
      for (const p of arr) {
        if (await isCompatibleClaudeZip(p)) accepted.push(p);
        else bad.push(await basename(p));
      }
      const names = await Promise.all(accepted.map((p) => basename(p)));
      setZipPaths(accepted);
      setZipLabels(names);
      setRejected(bad);
    } finally {
      setChecking(false);
    }
  }

  async function onWebFilesChosen(list: FileList | null) {
    if (!list || list.length === 0) return;
    setChecking(true);
    setError(null);
    try {
      const accepted: File[] = [];
      const bad: string[] = [];
      for (const f of Array.from(list)) {
        if (await isCompatibleClaudeZipFile(f)) accepted.push(f);
        else bad.push(f.name);
      }
      setZipFiles(accepted);
      setZipLabels(accepted.map((f) => f.name));
      setRejected(bad);
    } finally {
      setChecking(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function loadManifestText(raw: string) {
    setManifestError(null);
    const manifest = parseClaudeExportManifest(raw);
    const downloads = conversationDownloadsFromManifest(manifest);
    if (downloads.length === 0) {
      throw new Error("Este manifest não inclui a categoria conversations.");
    }
    setManifestPopup({ downloads, createdAt: manifest.created_at });
    setManifestDone(true);
  }

  async function pickManifest() {
    setManifestError(null);
    if (tauri) {
      const sel = await open({
        multiple: false,
        filters: [{ name: "Manifest Claude (.json)", extensions: ["json"] }],
      });
      if (!sel || Array.isArray(sel)) return;
      try {
        await loadManifestText(await readTextFile(sel));
      } catch (e) {
        setManifestError((e as Error).message ?? String(e));
      }
      return;
    }
    manifestInputRef.current?.click();
  }

  async function onManifestFile(list: FileList | null) {
    if (!list?.[0]) return;
    setManifestError(null);
    try {
      await loadManifestText(await list[0].text());
    } catch (e) {
      setManifestError((e as Error).message ?? String(e));
    } finally {
      if (manifestInputRef.current) manifestInputRef.current.value = "";
    }
  }

  async function pickOutDir() {
    const sel = await open({ directory: true });
    if (typeof sel === "string") setOutDir(sel);
  }

  async function run() {
    if (!hasZips || (tauri && !outDir)) return;
    setRunning(true);
    setError(null);
    setResult(null);
    setProgress({ phase: "Iniciando…", done: 0, total: 0 });
    try {
      const r = tauri
        ? await importClaudeZips(zipPaths, outDir, setProgress)
        : await importClaudeZipsWeb(zipFiles, setProgress);
      setResult(r);
    } catch (e) {
      setError((e as Error).message ?? String(e));
    } finally {
      setRunning(false);
    }
  }

  function finish() {
    if (result) onImported(tauri ? outDir : "web");
    onClose();
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key !== "Enter" || e.defaultPrevented || running) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, input, a")) return;
    e.preventDefault();
    if (result) {
      finish();
    } else if (step === "intro") {
      setStep("manifest");
    } else if (step === "manifest") {
      setStep("convert");
    } else if (step === "convert" && hasZips) {
      void run();
    }
  }

  const pct =
    progress && progress.total > 0
      ? Math.round((progress.done / progress.total) * 100)
      : null;

  const currentStepNum = result ? 4 : step === "intro" ? 1 : step === "manifest" ? 2 : 3;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[1px]"
      onClick={() => !running && onClose()}
    >
      <div
        className="w-full max-w-[760px] h-[min(620px,calc(100vh-32px))] rounded-xl border border-zinc-200 bg-white shadow-2xl flex flex-col overflow-hidden text-sm"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-labelledby="import-claude-title"
      >
        {/* 1. Header (cabeçalho) */}
        <header className="flex h-[52px] shrink-0 items-center justify-between border-b border-zinc-200 px-4 bg-white">
          <h2
            id="import-claude-title"
            className="text-[15px] font-bold tracking-wide text-zinc-900 uppercase"
          >
            Importação Claude Web
          </h2>
          <button
            type="button"
            onClick={() => !running && onClose()}
            className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40 transition-colors"
            disabled={running}
            aria-label="Fechar"
            title={result ? "Fechar" : "Fechar sem gravar"}
          >
            ×
          </button>
        </header>

        {/* 2. Indicador de Etapas (stepper bar) */}
        <ol className="flex h-[44px] shrink-0 items-center gap-1.5 border-b border-zinc-200 bg-zinc-50 px-4">
          {CLAUDE_WEB_PIPELINE_STEPS.map((s, i) => {
            const stepNum = i + 1;
            const isDone = currentStepNum > stepNum;
            const isCurrent = currentStepNum === stepNum;
            return (
              <li
                key={s.title}
                className={`flex flex-1 items-center gap-2 min-w-0 text-[11px] ${
                  isCurrent
                    ? "font-bold text-violet-700"
                    : isDone
                    ? "font-semibold text-emerald-700"
                    : "text-zinc-400"
                }`}
              >
                <span
                  className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold border transition-colors ${
                    isDone
                      ? "border-emerald-600 bg-emerald-600 text-white"
                      : isCurrent
                      ? "border-violet-600 bg-violet-600 text-white"
                      : "border-zinc-300 bg-white text-zinc-500"
                  }`}
                >
                  {isDone ? "✓" : stepNum}
                </span>
                <span className="truncate">{s.title}</span>
                {i < CLAUDE_WEB_PIPELINE_STEPS.length - 1 && (
                  <span
                    className={`flex-1 h-[2px] min-w-[6px] ${
                      isDone ? "bg-emerald-500" : "bg-zinc-200"
                    }`}
                  />
                )}
              </li>
            );
          })}
        </ol>

        {/* 3. Banner de Pergunta / Título do Passo */}
        <div className="border-b border-zinc-100 bg-white px-4 py-2.5">
          <small className="block text-[10px] font-extrabold tracking-widest text-zinc-400 uppercase mb-0.5">
            PASSO {currentStepNum} DE 4
          </small>
          <p className="text-[14px] font-bold text-zinc-900 leading-tight">
            {result
              ? "Conversão concluída — recarregue o cofre"
              : step === "intro"
              ? "Como solicitar o relatório de exportação no Claude.ai?"
              : step === "manifest"
              ? "Como carregar o manifest.json e baixar os zips?"
              : "Selecione o(s) arquivo(s) .zip e a pasta de saída para a conversão"}
          </p>
        </div>

        {/* 4. Conteúdo Rolável (antCorpo) */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
          {step === "intro" ? (
            <div className="space-y-4 text-sm">
              <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-4 space-y-3">
                <p className="font-semibold text-violet-900 text-[13px]">
                  1. {CLAUDE_WEB_PIPELINE_STEPS[0].title}
                </p>
                <p className="text-zinc-700 leading-relaxed text-xs">
                  {CLAUDE_WEB_PIPELINE_STEPS[0].body}
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => openExternal(EXPORT_URL)}
                    className="rounded-md border border-violet-300 bg-white px-3 py-1.5 text-xs font-semibold text-violet-700 shadow-sm hover:bg-violet-50 transition-colors"
                  >
                    🔗 Abrir exportação no Claude.ai
                  </button>
                  <button
                    type="button"
                    onClick={() => openExternal(EMAIL_URL)}
                    className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 transition-colors"
                  >
                    ✉ Abrir e-mail
                  </button>
                </div>
              </div>
              <p className="text-xs text-zinc-500 leading-normal bg-zinc-50 border border-zinc-200 rounded-md p-3">
                💡 Exports antigos (no formato <code>data-*.zip</code> direto no e-mail) também continuam funcionando na etapa de conversão.
              </p>
            </div>
          ) : step === "manifest" ? (
            <div className="space-y-4 text-sm">
              <div className="rounded-lg border border-violet-200 bg-violet-50/50 p-4 space-y-3">
                <p className="font-semibold text-violet-900 text-[13px]">
                  2. {CLAUDE_WEB_PIPELINE_STEPS[1].title}
                </p>
                <p className="text-zinc-700 leading-relaxed text-xs">
                  {CLAUDE_WEB_PIPELINE_STEPS[1].body}
                </p>
                <input
                  ref={manifestInputRef}
                  type="file"
                  accept=".json,application/json"
                  className="hidden"
                  onChange={(e) => onManifestFile(e.target.files)}
                />
                <button
                  type="button"
                  onClick={pickManifest}
                  className="w-full rounded-md border border-violet-300 bg-white px-3 py-2 text-xs font-semibold text-violet-800 shadow-sm hover:bg-violet-100 transition-colors flex items-center justify-center gap-2"
                >
                  📄 Escolher manifest (.json)
                </button>
              </div>

              {manifestDone && !manifestError && (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 space-y-2">
                  <p className="font-semibold flex items-center gap-1.5">
                    ✓ Manifest lido com sucesso
                  </p>
                  <p>
                    Use a janela de links para baixar o(s) arquivo(s){" "}
                    <code>conversations-*.zip</code>. Quando concluir o download, avance para a etapa de conversão.
                  </p>
                  {manifestPopup && (
                    <button
                      type="button"
                      onClick={() => setManifestPopup(manifestPopup)}
                      className="rounded border border-emerald-300 bg-white px-2 py-1 text-[11px] font-medium text-emerald-800 hover:bg-emerald-100"
                    >
                      🔗 Ver links de download novamente
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4 text-sm">
              <p className="font-medium text-zinc-900 text-[13px]">
                3. {CLAUDE_WEB_PIPELINE_STEPS[2].title}
              </p>

              {/* Fallback web input */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip,application/zip"
                multiple
                className="hidden"
                onChange={(e) => onWebFilesChosen(e.target.files)}
              />

              {/* Bloco 1 — ZIP */}
              <div className="rounded-lg border border-zinc-200 bg-zinc-50/50 p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-xs text-zinc-800">
                    Arquivo(s) .zip de conversas
                  </span>
                  <button
                    type="button"
                    onClick={pickZips}
                    disabled={running || checking}
                    className="rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-40 shadow-sm transition-colors"
                  >
                    {checking ? "Verificando…" : "Escolher ZIP…"}
                  </button>
                </div>
                {zipLabels.length > 0 ? (
                  <ul className="rounded-md border border-zinc-200 bg-white p-2 text-xs text-zinc-600 max-h-28 overflow-y-auto space-y-1">
                    {zipLabels.map((n, i) => (
                      <li key={i} className="truncate font-mono text-[11.5px] flex items-center gap-1.5 text-emerald-800">
                        <span className="text-emerald-600 font-bold">✓</span> {n}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-zinc-500 leading-normal">
                    Selecione o <code>conversations-000.zip</code> que você baixou (e as partes <code>-001</code>… se houver). Exports antigos (<code>data-*.zip</code>) também servem.
                  </p>
                )}
              </div>

              {/* Bloco 2 — Pasta de saída */}
              {tauri ? (
                <div className="rounded-lg border border-zinc-200 bg-zinc-50/50 p-3.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs text-zinc-800">
                      Pasta de saída (.md, sem cortesias)
                    </span>
                    <button
                      type="button"
                      onClick={pickOutDir}
                      disabled={running}
                      className="rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-40 shadow-sm transition-colors"
                    >
                      Alterar pasta…
                    </button>
                  </div>
                  <p className="rounded-md border border-zinc-200 bg-white p-2 text-xs font-mono text-zinc-700 break-all">
                    {outDir}
                  </p>
                  {outDir === vaultPath && (
                    <p className="text-[11px] text-emerald-700 font-medium">
                      ✓ É o cofre aberto: as conversas aparecem na lista após importar.
                    </p>
                  )}
                </div>
              ) : (
                <div className="rounded-lg border border-zinc-200 bg-zinc-50/50 p-3.5 space-y-1.5">
                  <span className="font-semibold text-xs text-zinc-800">
                    Onde ficam as notas (sem cortesias)
                  </span>
                  <p className="text-xs text-zinc-600">
                    As conversas ficam salvas <strong>neste navegador</strong> (offline). Importar de novo só adiciona/atualiza — sem duplicatas.
                  </p>
                </div>
              )}

              {/* Resumo da conversão (passo 4 resultado) */}
              {result && (
                <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3.5 text-xs text-emerald-900 space-y-1">
                  <p className="font-bold text-sm text-emerald-800">
                    4. {CLAUDE_WEB_PIPELINE_STEPS[3].title} — conversão concluída com sucesso.
                  </p>
                  <p className="mt-1">
                    {result.unique} conversa(s) única(s) · {result.written} nova(s)
                    {result.updated > 0 ? ` · ${result.updated} atualizada(s)` : ""}
                    {result.unchanged > 0 ? ` · ${result.unchanged} já estavam em dia` : ""}
                    {result.empty > 0 ? ` · ${result.empty} vazia(s)` : ""}
                  </p>
                </div>
              )}

              {result && result.failed.length > 0 && (
                <p className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-800">
                  Não deu para ler por completo (arquivo corrompido ou incompleto — baixe de novo):{" "}
                  <span className="font-mono">{result.failed.join(", ")}</span>
                </p>
              )}
            </div>
          )}
        </div>

        {/* 5. Barra de Mensagem / Status (antMsg) */}
        <div
          className={`flex h-[44px] shrink-0 items-center px-4 text-xs font-medium border-t transition-colors ${
            error
              ? "bg-red-50 text-red-700 border-red-200"
              : manifestError && step === "manifest"
              ? "bg-red-50 text-red-700 border-red-200"
              : rejected.length > 0 && step === "convert"
              ? "bg-amber-50 text-amber-800 border-amber-200"
              : result
              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
              : running
              ? "bg-violet-50 text-violet-800 border-violet-200"
              : "bg-zinc-50 text-zinc-600 border-zinc-200"
          }`}
          role="status"
        >
          {error ? (
            <span className="truncate">{error}</span>
          ) : manifestError && step === "manifest" ? (
            <span className="truncate">{manifestError}</span>
          ) : rejected.length > 0 && step === "convert" ? (
            <span className="truncate">
              Ignorado(s) por não parecer(em) um export do Claude: {rejected.join(", ")}
            </span>
          ) : running && progress ? (
            <div className="w-full flex items-center justify-between gap-4">
              <span className="truncate">
                {progress.phase} ({progress.done}/{progress.total})
              </span>
              <div className="h-1.5 w-36 bg-violet-200 rounded-full overflow-hidden shrink-0">
                <div
                  className="h-full bg-violet-600 transition-all duration-200"
                  style={{ width: `${pct ?? 50}%` }}
                />
              </div>
            </div>
          ) : result ? (
            <span>Conversão concluída sem duplicatas.</span>
          ) : (
            <span>
              {step === "intro"
                ? "Esc fecha sem gravar · Solicite a exportação nas configurações do Claude.ai"
                : step === "manifest"
                ? "Esc fecha sem gravar · Selecione o arquivo manifest-….json recebido por e-mail"
                : "Esc fecha sem gravar · Escolha os arquivos .zip de conversas"}
            </span>
          )}
        </div>

        {/* 6. Rodapé (antFoot) */}
        <footer className="flex h-[58px] shrink-0 items-center justify-between border-t border-zinc-200 bg-white px-4">
          <span className="text-xs text-zinc-500 font-medium">
            {running
              ? "Aguarde a gravação"
              : result
              ? "Esc ou ↵ fecha · conversão concluída"
              : "Esc fecha sem gravar"}
          </span>
          <div className="flex items-center gap-2">
            {step === "convert" && !result && !running && (
              <button
                type="button"
                onClick={() => setStep("manifest")}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 transition-colors"
              >
                ‹ Voltar
              </button>
            )}
            {step === "manifest" && !running && (
              <button
                type="button"
                onClick={() => setStep("intro")}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 transition-colors"
              >
                ‹ Voltar
              </button>
            )}
            {step === "intro" ? (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => setStep("manifest")}
                  className="rounded-md bg-violet-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 transition-colors flex items-center gap-1.5 shadow-sm"
                >
                  <span>Próximo →</span>
                  <span className="rounded border border-white/40 bg-white/20 px-1 py-0.5 font-mono text-[10px] leading-none">
                    ↵
                  </span>
                </button>
              </>
            ) : step === "manifest" ? (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => setStep("convert")}
                  className="rounded-md bg-violet-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 transition-colors flex items-center gap-1.5 shadow-sm"
                >
                  <span>Já baixei o .zip → conversão</span>
                  <span className="rounded border border-white/40 bg-white/20 px-1 py-0.5 font-mono text-[10px] leading-none">
                    ↵
                  </span>
                </button>
              </>
            ) : result ? (
              <button
                type="button"
                onClick={finish}
                className="rounded-md bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 transition-colors flex items-center gap-1.5 shadow-sm"
              >
                <span>Recarregar cofre</span>
                <span className="rounded border border-white/40 bg-white/20 px-1 py-0.5 font-mono text-[10px] leading-none">
                  ↵
                </span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => !running && onClose()}
                  disabled={running}
                  className="rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={run}
                  disabled={running || !hasZips || (tauri && !outDir)}
                  className="rounded-md bg-violet-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50 transition-colors flex items-center gap-1.5 shadow-sm"
                >
                  <span>{running ? "Convertendo…" : "Importar"}</span>
                  <span className="rounded border border-white/40 bg-white/20 px-1 py-0.5 font-mono text-[10px] leading-none">
                    ↵
                  </span>
                </button>
              </>
            )}
          </div>
        </footer>
      </div>

      {manifestPopup && (
        <ClaudeManifestLinksModal
          downloads={manifestPopup.downloads}
          createdAt={manifestPopup.createdAt}
          onClose={() => setManifestPopup(null)}
        />
      )}
    </div>
  );
}
