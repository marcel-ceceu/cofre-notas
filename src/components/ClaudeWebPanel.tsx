import { lazy, Suspense, useState } from "react";
import {
  CLAUDE_WEB_IMPORT_START,
  CLAUDE_WEB_PIPELINE_STEPS,
} from "./claudeWebFlow";
import { VaultContextSummary } from "./VaultContextSummary";

export { CLAUDE_WEB_TOOLBAR_TITLE } from "./claudeWebFlow";

const ImportClaudeModal = lazy(() =>
  import("./ImportClaudeModal").then((m) => ({ default: m.ImportClaudeModal }))
);

type Props = {
  onImported: (dest: string) => void;
};

/** Aba Claude Web — importação oficial (manifest + zip). */
export function ClaudeWebPanel({ onImported }: Props) {
  const [importOpen, setImportOpen] = useState(false);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="pane-head">
        <span className="pane-title">Claude Web</span>
      </div>

      <div className="space-y-3 px-3 py-3">
        <p className="text-[12px] leading-relaxed text-[var(--ink-muted)]">
          Importação de conversas exportadas pelo Claude.ai (manifest JSON +
          zip de conversas).
        </p>

        <ol className="space-y-2">
          {CLAUDE_WEB_PIPELINE_STEPS.map((step, i) => (
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
          onClick={() => setImportOpen(true)}
          className="tb-btn tb-btn--primary w-full justify-center text-center leading-snug"
        >
          {CLAUDE_WEB_IMPORT_START}
        </button>

        <VaultContextSummary />
      </div>

      <Suspense fallback={null}>
        {importOpen && (
          <ImportClaudeModal
            onClose={() => setImportOpen(false)}
            onImported={(dest) => {
              setImportOpen(false);
              onImported(dest);
            }}
          />
        )}
      </Suspense>
    </div>
  );
}
