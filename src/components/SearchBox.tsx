import { useEffect, useMemo, useRef, useState } from "react";
import { useVaultStore } from "../store/vaultStore";
import { queryNotes } from "../lib/search";
import { CopyResultsModal } from "./CopyResultsModal";
import { SearchSettingsModal } from "./SearchSettingsModal";

export function SearchBox() {
  const setQuery = useVaultStore((s) => s.setQuery);
  const notes = useVaultStore((s) => s.notes);
  const query = useVaultStore((s) => s.query);
  const sortKey = useVaultStore((s) => s.sortKey);
  const prefs = useVaultStore((s) => s.searchPrefs);
  const [local, setLocal] = useState("");
  const [copyOpen, setCopyOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(
    () => queryNotes(notes, query, prefs, sortKey),
    [notes, query, prefs, sortKey]
  );

  // Disparo: "auto" => debounce + mínimo de caracteres; "enter" => só no Enter.
  // Em ambos os modos, campo vazio restaura imediatamente a lista padrão.
  useEffect(() => {
    const trimmed = local.trim();
    if (prefs.triggerMode === "enter") {
      if (trimmed === "") setQuery("");
      return;
    }
    const t = setTimeout(() => {
      if (trimmed.length === 0 || trimmed.length < prefs.minChars) {
        setQuery("");
      } else {
        setQuery(trimmed);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [local, prefs.triggerMode, prefs.minChars, setQuery]);

  // Atalho global Ctrl/Cmd+K foca o campo.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      setQuery(local.trim());
    }
  }

  const placeholder =
    prefs.triggerMode === "enter"
      ? "Buscar + Enter (Ctrl+K)"
      : `Buscar (mín. ${prefs.minChars}, Ctrl+K)`;

  const modeHint =
    prefs.searchMode === "tokens" ? "palavras soltas" : "texto contínuo";

  return (
    <div className="space-y-1">
      <div className="relative">
        <input
          ref={inputRef}
          type="search"
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder={placeholder}
          className="w-full pl-2 pr-8 py-1.5 text-sm rounded border border-zinc-300 bg-white text-zinc-800 focus:outline-none focus:ring-1 focus:ring-zinc-400"
        />
        {local && (
          <button
            onClick={() => setLocal("")}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 text-sm"
            aria-label="Limpar"
          >
            ×
          </button>
        )}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[11px] text-zinc-400 select-none">{modeHint}</span>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            title="Preferências de pesquisa"
            className="inline-flex items-center justify-center h-6 w-6 rounded text-zinc-400 hover:text-violet-600 hover:bg-violet-50"
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

          <button
            type="button"
            onClick={() => setCopyOpen(true)}
            disabled={filtered.length === 0}
            title="Copiar caminhos dos resultados filtrados"
            className="inline-flex items-center justify-center h-6 w-6 rounded text-zinc-400 hover:text-violet-600 hover:bg-violet-50 disabled:opacity-30 disabled:pointer-events-none"
            aria-label="Copiar resultados da pesquisa"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-3.5 w-3.5"
              aria-hidden
            >
              <path d="M7 3.5A1.5 1.5 0 018.5 2h3.879a1.5 1.5 0 011.06.44l3.122 3.12A1.5 1.5 0 0117 6.622V12.5a1.5 1.5 0 01-1.5 1.5h-1v-3.879a3 3 0 00-.879-2.121L10.5 5.379A3 3 0 008.379 4.5H7v-1z" />
              <path d="M4.5 6A1.5 1.5 0 003 7.5v9A1.5 1.5 0 004.5 18h7a1.5 1.5 0 001.5-1.5v-5.879a1.5 1.5 0 00-.44-1.06L9.44 6.439A1.5 1.5 0 008.378 6H4.5z" />
            </svg>
          </button>
        </div>
      </div>

      {copyOpen && (
        <CopyResultsModal notes={filtered} onClose={() => setCopyOpen(false)} />
      )}
      {settingsOpen && (
        <SearchSettingsModal onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
}
