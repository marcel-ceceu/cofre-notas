import { lazy, Suspense, useMemo, useState } from "react";
import { useVaultStore } from "../store/vaultStore";
import { useSearchResults } from "../lib/useSearchResults";

// Fora do chunk de boot — ver comentário no App.tsx.
const ConsolidateModal = lazy(() =>
  import("./ConsolidateModal").then((m) => ({ default: m.ConsolidateModal }))
);

type Source = "selection" | "search";

/**
 * Painel de consolidação: escolhe o conjunto de notas (seleção manual da lista
 * ou resultado da busca) e abre o assistente que gera o documento agregado.
 */
export function ConsolidatePanel() {
  const notes = useVaultStore((s) => s.notes);
  const selectedPaths = useVaultStore((s) => s.selectedPaths);
  const setSelectedPaths = useVaultStore((s) => s.setSelectedPaths);
  const setActivePath = useVaultStore((s) => s.setActivePath);

  const [source, setSource] = useState<Source>("selection");
  const [open, setOpen] = useState(false);

  const { results: searchNotes } = useSearchResults();

  const selectedNotes = useMemo(() => {
    const set = new Set(selectedPaths);
    return notes.filter((n) => set.has(n.path));
  }, [notes, selectedPaths]);

  const target = source === "selection" ? selectedNotes : searchNotes;
  const totalChars = useMemo(
    () => target.reduce((acc, n) => acc + n.content.length, 0),
    [target]
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="pane-head">
        <span className="pane-title">Consolidar</span>
        <span className="h-px flex-1 bg-[var(--rule)]" />
        <span className="meta-label">{target.length}</span>
      </div>

      <div className="space-y-3 overflow-y-auto px-3 py-3">
        <p className="text-[12px] leading-relaxed text-[var(--ink-muted)]">
          Junta várias conversas em um único documento markdown — contexto
          contínuo para colar em uma IA.
        </p>

        <div>
          <span className="meta-label">Origem</span>
          <div className="mt-1 grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={() => setSource("selection")}
              className={`seg-btn ${source === "selection" ? "seg-btn--on" : ""}`}
            >
              Seleção ({selectedNotes.length})
            </button>
            <button
              type="button"
              onClick={() => setSource("search")}
              className={`seg-btn ${source === "search" ? "seg-btn--on" : ""}`}
            >
              Busca ({searchNotes.length})
            </button>
          </div>
          <p className="mt-1 text-[11px] leading-snug text-[var(--ink-faint)]">
            {source === "selection"
              ? "Marque as notas na aba Notas com clique, Ctrl+clique ou Shift+clique."
              : "Usa exatamente o que o filtro de busca atual retorna."}
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-1.5">
          <div className="rounded-md border border-[var(--rule)] bg-[var(--chrome)] px-2 py-1.5">
            <dt className="meta-label">Conversas</dt>
            <dd className="font-mono-ui text-[15px] font-medium text-[var(--ink)]">
              {target.length}
            </dd>
          </div>
          <div className="rounded-md border border-[var(--rule)] bg-[var(--chrome)] px-2 py-1.5">
            <dt className="meta-label">Caracteres</dt>
            <dd className="font-mono-ui text-[15px] font-medium text-[var(--ink)]">
              {totalChars.toLocaleString("pt-BR")}
            </dd>
          </div>
        </dl>

        <button
          type="button"
          disabled={target.length === 0}
          onClick={() => setOpen(true)}
          className="tb-btn tb-btn--primary w-full justify-center"
        >
          Gerar documento agregado
        </button>

        {source === "selection" && selectedNotes.length > 0 && (
          <div>
            <div className="flex items-center justify-between">
              <span className="meta-label">Selecionadas</span>
              <button
                type="button"
                onClick={() => setSelectedPaths([])}
                className="text-[11px] text-[var(--ink-muted)] hover:text-[var(--accent)] hover:underline"
              >
                limpar
              </button>
            </div>
            <ul className="mt-1 space-y-px">
              {selectedNotes.map((n) => (
                <li key={n.path}>
                  <div className="group flex items-center gap-1.5 rounded-[4px] px-1.5 py-1 hover:bg-[var(--accent-soft)]">
                    <button
                      type="button"
                      onClick={() => setActivePath(n.path)}
                      className="min-w-0 flex-1 truncate text-left text-[11.5px] text-[var(--ink)]"
                      title={n.path}
                    >
                      {n.name}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedPaths(
                          selectedPaths.filter((p) => p !== n.path)
                        )
                      }
                      className="shrink-0 text-[13px] leading-none text-[var(--ink-faint)] opacity-0 group-hover:opacity-100 hover:text-[var(--accent)]"
                      aria-label={`Remover ${n.name} da seleção`}
                    >
                      ×
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <Suspense fallback={null}>
        {open && (
          <ConsolidateModal notes={target} onClose={() => setOpen(false)} />
        )}
      </Suspense>
    </div>
  );
}
