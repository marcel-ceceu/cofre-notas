import { useState } from "react";
import { useSearchResults } from "../lib/useSearchResults";
import { CopyResultsModal } from "./CopyResultsModal";
import { SearchSettingsModal } from "./SearchSettingsModal";
import { ConsolidateModal } from "./ConsolidateModal";

/**
 * Ações de ferramenta na barra do topo — posição padrão de app.
 * Operam sempre sobre o conjunto atualmente filtrado na barra lateral.
 */
export function ToolbarActions() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);

  const { results: filtered } = useSearchResults();

  const noResults = filtered.length === 0;

  return (
    <>
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => setExportOpen(true)}
          disabled={noResults}
          title="Exportar/consolidar os resultados filtrados em arquivos"
          className="tb-btn tb-btn--icon"
          aria-label="Exportar resultados"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-4 w-4"
            aria-hidden
          >
            <path d="M3 4.5A1.5 1.5 0 014.5 3h3.379a1.5 1.5 0 011.06.44l1.122 1.12a1.5 1.5 0 001.06.44H15.5A1.5 1.5 0 0117 6.5v7A1.5 1.5 0 0115.5 15h-11A1.5 1.5 0 013 13.5v-9z" />
            <path
              d="M10 7.5v4m0 0l1.75-1.75M10 11.5L8.25 9.75"
              stroke="var(--chrome)"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
        </button>

        <button
          type="button"
          onClick={() => setCopyOpen(true)}
          disabled={noResults}
          title="Copiar caminhos dos resultados filtrados"
          className="tb-btn tb-btn--icon"
          aria-label="Copiar resultados"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-4 w-4"
            aria-hidden
          >
            <path d="M7 3.5A1.5 1.5 0 018.5 2h3.879a1.5 1.5 0 011.06.44l3.122 3.12A1.5 1.5 0 0117 6.622V12.5a1.5 1.5 0 01-1.5 1.5h-1v-3.879a3 3 0 00-.879-2.121L10.5 5.379A3 3 0 008.379 4.5H7v-1z" />
            <path d="M4.5 6A1.5 1.5 0 003 7.5v9A1.5 1.5 0 004.5 18h7a1.5 1.5 0 001.5-1.5v-5.879a1.5 1.5 0 00-.44-1.06L9.44 6.439A1.5 1.5 0 008.378 6H4.5z" />
          </svg>
        </button>

        <span className="mx-1 h-4 w-px bg-[var(--rule)]" />

        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          title="Preferências de pesquisa"
          className="tb-btn tb-btn--icon"
          aria-label="Preferências de pesquisa"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-4 w-4"
            aria-hidden
          >
            <path
              fillRule="evenodd"
              d="M7.84 1.804A1 1 0 018.82 1h2.36a1 1 0 01.98.804l.331 1.652a6.993 6.993 0 011.929 1.115l1.598-.54a1 1 0 011.186.447l1.18 2.044a1 1 0 01-.205 1.251l-1.267 1.113a7.047 7.047 0 010 2.228l1.267 1.113a1 1 0 01.206 1.25l-1.18 2.045a1 1 0 01-1.187.447l-1.598-.54a6.993 6.993 0 01-1.929 1.115l-.33 1.652a1 1 0 01-.98.804H8.82a1 1 0 01-.98-.804l-.331-1.652a6.993 6.993 0 01-1.929-1.115l-1.598.54a1 1 0 01-1.186-.447l-1.18-2.044a1 1 0 01.205-1.251l1.267-1.114a7.05 7.05 0 010-2.227L1.821 7.773a1 1 0 01-.206-1.25l1.18-2.045a1 1 0 011.187-.447l1.598.54A6.993 6.993 0 017.51 3.456l.33-1.652zM10 13a3 3 0 100-6 3 3 0 000 6z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>

      {copyOpen && (
        <CopyResultsModal notes={filtered} onClose={() => setCopyOpen(false)} />
      )}
      {settingsOpen && (
        <SearchSettingsModal onClose={() => setSettingsOpen(false)} />
      )}
      {exportOpen && (
        <ConsolidateModal notes={filtered} onClose={() => setExportOpen(false)} />
      )}
    </>
  );
}
