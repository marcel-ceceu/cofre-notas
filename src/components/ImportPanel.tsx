import { lazy, Suspense, useState } from "react";
import { useVaultStore } from "../store/vaultStore";
import { isTauriRuntime, type TauriDirHandle } from "../lib/fileSystem.tauri";

// Fora do chunk de boot — ver comentário no App.tsx.
const ImportClaudeModal = lazy(() =>
  import("./ImportClaudeModal").then((m) => ({ default: m.ImportClaudeModal }))
);
const ImportCursorModal = lazy(() =>
  import("./ImportCursorModal").then((m) => ({ default: m.ImportCursorModal }))
);

type Props = {
  onImported: (dest: string) => void;
};

const STEPS = [
  {
    title: "Pedir a exportação",
    body: "No Claude.ai, Configurações → Privacidade → Exportar dados. O .zip chega por e-mail.",
  },
  {
    title: "Baixar o .zip",
    body: "Salve o arquivo recebido na pasta de downloads — o pipeline localiza o mais recente sozinho.",
  },
  {
    title: "Rodar o pipeline",
    body: "Converte as transcrições em notas .md, aplica as regras de limpeza e ignora duplicatas por uuid.",
  },
  {
    title: "Recarregar o cofre",
    body: "As conversas novas aparecem na lista já indexadas para busca.",
  },
];

/** Painel do fluxo de importação — abre o assistente de importação em modal. */
export function ImportPanel({ onImported }: Props) {
  const dirHandle = useVaultStore((s) => s.dirHandle);
  const notes = useVaultStore((s) => s.notes);
  const [open, setOpen] = useState(false);
  const [openCursor, setOpenCursor] = useState(false);
  const desktop = isTauriRuntime();

  const vaultPath =
    dirHandle && (dirHandle as TauriDirHandle).kind === "tauri"
      ? (dirHandle as TauriDirHandle).path
      : dirHandle
        ? "cofre do navegador (IndexedDB)"
        : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="pane-head">
        <span className="pane-title">Importar conversas</span>
      </div>

      <div className="space-y-3 px-3 py-3">
        <p className="text-[12px] leading-relaxed text-[var(--ink-muted)]">
          Transforma uma exportação de transcrições do Claude.ai em notas
          markdown dentro do cofre.
        </p>

        <ol className="space-y-2">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-2.5">
              <span className="mt-px grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border border-[var(--accent-ring)] bg-[var(--accent-soft)] font-mono-ui text-[10px] font-medium text-[var(--accent)]">
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-[var(--ink)]">
                  {step.title}
                </p>
                <p className="text-[11.5px] leading-snug text-[var(--ink-muted)]">
                  {step.body}
                </p>
              </div>
            </li>
          ))}
        </ol>

        <button
          type="button"
          onClick={() => setOpen(true)}
          className="tb-btn tb-btn--primary w-full justify-center"
        >
          Executar pipeline de importação
        </button>

        <div className="space-y-2 border-t border-[var(--rule)] pt-3">
          <p className="text-[12px] font-medium text-[var(--ink)]">Cursor (local)</p>
          <p className="text-[11.5px] leading-snug text-[var(--ink-muted)]">
            Lê os transcripts em <code>~\.cursor\projects</code>, mostra quais
            conversas são novas ou mudaram, e grava só as que você marcar em{" "}
            <code>Cursor\</code> dentro do cofre.
          </p>
          <button
            type="button"
            onClick={() => setOpenCursor(true)}
            disabled={!desktop}
            title={desktop ? undefined : "Disponível só no app desktop"}
            className="tb-btn w-full justify-center disabled:cursor-not-allowed disabled:opacity-50"
          >
            Importar do Cursor
          </button>
          {!desktop && (
            <p className="text-[11px] text-[var(--ink-faint)]">
              O navegador não enxerga os arquivos do Cursor — use o app desktop.
            </p>
          )}
        </div>

        <dl className="space-y-1.5 rounded-md border border-[var(--rule)] bg-[var(--chrome)] px-2.5 py-2">
          <div className="flex items-baseline justify-between gap-2">
            <dt className="meta-label">Cofre</dt>
            <dd
              className="min-w-0 truncate text-[11px] text-[var(--ink-muted)]"
              title={vaultPath ?? undefined}
            >
              {vaultPath ?? "nenhum aberto"}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <dt className="meta-label">Notas</dt>
            <dd className="font-mono-ui text-[11px] text-[var(--ink-muted)]">
              {notes.length}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <dt className="meta-label">Modo</dt>
            <dd className="text-[11px] text-[var(--ink-muted)]">
              {desktop ? "desktop" : "navegador"}
            </dd>
          </div>
        </dl>
      </div>

      <Suspense fallback={null}>
        {open && (
          <ImportClaudeModal
            onClose={() => setOpen(false)}
            onImported={(dest) => {
              setOpen(false);
              onImported(dest);
            }}
          />
        )}
        {openCursor && (
          <ImportCursorModal
            onClose={() => setOpenCursor(false)}
            onImported={(dest) => {
              setOpenCursor(false);
              onImported(dest);
            }}
          />
        )}
      </Suspense>
    </div>
  );
}
