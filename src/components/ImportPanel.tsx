import { lazy, Suspense, useState } from "react";
import { isDesktopShell } from "../lib/runtime/shell";
import { VaultContextSummary } from "./VaultContextSummary";

const ImportCursorModal = lazy(() =>
  import("./ImportCursorModal").then((m) => ({ default: m.ImportCursorModal }))
);

type Props = {
  onImported: (dest: string) => void;
};

/** Painel Importar — transcripts locais do Cursor IDE. */
export function ImportPanel({ onImported }: Props) {
  const [openCursor, setOpenCursor] = useState(false);
  const desktop = isDesktopShell();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="pane-head">
        <span className="pane-title">Importar</span>
      </div>

      <div className="space-y-3 px-3 py-3">
        <p className="text-[12px] leading-relaxed text-[var(--ink-muted)]">
          Importação de conversas gravadas localmente pelo Cursor IDE. Para o
          export oficial do Claude.ai (.zip), use a aba{" "}
          <strong className="font-medium text-[var(--ink)]">Claude Web</strong>.
        </p>

        <div className="space-y-2">
          <p className="text-[12px] font-medium text-[var(--ink)]">
            Cursor (local)
          </p>
          <p className="text-[11.5px] leading-snug text-[var(--ink-muted)]">
            Lê os transcripts em <code>~\.cursor\projects</code>, mostra quais
            conversas são novas ou mudaram, e grava só as que você marcar em{" "}
            <code>Cursor\</code> dentro do cofre.
          </p>
          <button
            type="button"
            onClick={() => setOpenCursor(true)}
            className="tb-btn tb-btn--primary w-full justify-center"
          >
            Importar do Cursor
          </button>
          {!desktop && (
            <p className="text-[11px] text-[var(--ink-faint)]">
              No PWA o inventário automático do Cursor exige o app instalado
              (Windows); o botão abre o mesmo assistente com orientação.
            </p>
          )}
        </div>

        <VaultContextSummary />
      </div>

      <Suspense fallback={null}>
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

/** Título do botão da toolbar que abre o painel Importar (Cursor). */
export const IMPORT_TOOLBAR_TITLE =
  "Importar — conversas do Cursor IDE (transcripts locais)";
