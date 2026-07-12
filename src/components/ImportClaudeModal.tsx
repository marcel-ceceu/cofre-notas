import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
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

type Props = {
  onClose: () => void;
  /** Chamado após importar com sucesso: pasta de saída (desktop) ou "web" (navegador). */
  onImported: (dest: string) => void;
};

/** Pasta de saída padrão oficial do fluxo. */
const DEFAULT_OUT_DIR = "D:\\2606VAULT-ClaudeConversasOF-v2";

/** Link para solicitar o export das conversas no Claude.ai. */
const EXPORT_URL = "https://claude.ai/settings/data-privacy-controls";
/** Link do e-mail onde o export chega (Google Workspace). */
const EMAIL_URL = "https://mail.google.com/";

type Step = "intro" | "config";

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
  // Saída sempre pré-preenchida com o caminho oficial.
  const [outDir, setOutDir] = useState<string>(DEFAULT_OUT_DIR);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const tauri = isTauriRuntime();
  const hasZips = tauri ? zipPaths.length > 0 : zipFiles.length > 0;

  // Auto-detecta o export mais recente em Downloads ao entrar na etapa de config.
  useEffect(() => {
    if (step !== "config" || !isTauriRuntime()) return;
    let cancelled = false;
    (async () => {
      try {
        const found = await findLatestExportZips();
        if (cancelled || found.length === 0) return;
        // Auto-detecção já vem de data-*.zip; confirma a assinatura por garantia.
        const ok: string[] = [];
        for (const p of found) {
          if (await isCompatibleClaudeZip(p)) ok.push(p);
        }
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
    function onKey(e: KeyboardEvent) {
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

    // Só aceita zips com a assinatura de export do Claude (conversations.json).
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

  /** Fallback web: valida os File escolhidos no input (mesma assinatura). */
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
      // Desktop: grava .md na pasta. Web: salva no IndexedDB do navegador.
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

        {step === "intro" ? (
          /* ── Etapa 0 — Tutorial de exportação ─────────────────────────── */
          <div className="p-4 space-y-4 text-sm">
            <p className="text-zinc-700">
              Antes de importar, você precisa <strong>exportar suas conversas</strong>{" "}
              no Claude.ai. É um pedido único que chega depois por e-mail.
            </p>

            <ol className="space-y-3">
              <li className="flex gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[11px] font-semibold text-violet-700">
                  1
                </span>
                <div className="space-y-1.5">
                  <p className="text-zinc-700">
                    Abra as configurações de privacidade do Claude e clique em{" "}
                    <strong>Export data</strong> para solicitar o relatório.
                  </p>
                  <button
                    type="button"
                    onClick={() => openExternal(EXPORT_URL)}
                    className="rounded border border-violet-300 bg-violet-50 px-2 py-1 text-xs font-medium text-violet-700 hover:bg-violet-100"
                  >
                    🔗 Abrir a página de exportação do Claude
                  </button>
                </div>
              </li>

              <li className="flex gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[11px] font-semibold text-violet-700">
                  2
                </span>
                <p className="text-zinc-700">
                  <strong>Aguarde o e-mail</strong> da Anthropic com o link de
                  download. Pode levar de alguns minutos a algumas horas.
                </p>
              </li>

              <li className="flex gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[11px] font-semibold text-violet-700">
                  3
                </span>
                <div className="space-y-1.5">
                  <p className="text-zinc-700">
                    Quando chegar, baixe o arquivo{" "}
                    <code className="rounded bg-zinc-100 px-1 text-[11px]">
                      data-*.zip
                    </code>{" "}
                    e volte aqui para selecioná-lo.
                  </p>
                  <button
                    type="button"
                    onClick={() => openExternal(EMAIL_URL)}
                    className="rounded border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                  >
                    ✉ Abrir o e-mail
                  </button>
                </div>
              </li>
            </ol>
          </div>
        ) : (
          /* ── Etapa 1/2 — Seleção do ZIP e destino ─────────────────────── */
          <div className="p-4 space-y-4 text-sm">
            {/* Fallback web: input de arquivo universal (Firefox/Safari/celular) */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,application/zip"
              multiple
              className="hidden"
              onChange={(e) => onWebFilesChosen(e.target.files)}
            />

            {/* Passo 1 — ZIP */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-medium text-zinc-800">
                  1. Export do Claude (.zip)
                </span>
                <button
                  type="button"
                  onClick={pickZips}
                  disabled={running || checking}
                  className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
                >
                  {checking ? "Verificando…" : "Escolher ZIP…"}
                </button>
              </div>
              {zipLabels.length > 0 ? (
                <ul className="rounded border border-zinc-200 bg-zinc-50 p-2 text-xs text-zinc-600 max-h-24 overflow-y-auto">
                  {zipLabels.map((n, i) => (
                    <li key={i} className="truncate font-mono">
                      ✓ {n}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-zinc-500">
                  Selecione o <code>data-*.zip</code> que você baixou do e-mail.
                  Só arquivos que forem realmente um export de conversas do
                  Claude serão aceitos.
                </p>
              )}
              {rejected.length > 0 && (
                <p className="rounded border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-700">
                  Ignorado(s) por não parecer(em) um export do Claude:{" "}
                  <span className="font-mono">{rejected.join(", ")}</span>
                </p>
              )}
            </div>

            {/* Passo 2 — destino */}
            {tauri ? (
              <div className="space-y-1.5 border-t border-zinc-100 pt-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-zinc-800">
                    2. Pasta de saída (.md, sem cortesias)
                  </span>
                  <button
                    type="button"
                    onClick={pickOutDir}
                    disabled={running}
                    className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
                  >
                    Alterar pasta…
                  </button>
                </div>
                <p className="rounded border border-zinc-200 bg-zinc-50 p-2 text-xs font-mono text-zinc-600 break-all">
                  {outDir}
                </p>
                <p className="text-[11px] text-zinc-500">
                  A pasta é criada automaticamente se ainda não existir.
                </p>
                {outDir === vaultPath && (
                  <p className="text-[11px] text-emerald-600">
                    É o cofre aberto: as conversas aparecem na lista após importar.
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-1.5 border-t border-zinc-100 pt-3">
                <span className="font-medium text-zinc-800">
                  2. Onde ficam as notas (sem cortesias)
                </span>
                <p className="rounded border border-zinc-200 bg-zinc-50 p-2 text-xs text-zinc-600">
                  As conversas ficam salvas <strong>neste navegador</strong>{" "}
                  (offline). Importar de novo só adiciona/atualiza — sem
                  duplicatas.
                </p>
              </div>
            )}

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
                <p className="font-medium">Importação concluída (sem duplicatas).</p>
                <p className="mt-1">
                  {result.unique} conversa(s) única(s) · {result.written} nova(s)
                  {result.updated > 0 ? ` · ${result.updated} atualizada(s)` : ""}
                  {result.unchanged > 0
                    ? ` · ${result.unchanged} já estavam em dia`
                    : ""}
                  {result.empty > 0 ? ` · ${result.empty} vazia(s)` : ""}
                </p>
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
          {step === "intro" ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => setStep("config")}
                className="rounded bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700"
              >
                Já tenho o .zip → continuar
              </button>
            </>
          ) : result ? (
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
                disabled={running || !hasZips || (tauri && !outDir)}
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
