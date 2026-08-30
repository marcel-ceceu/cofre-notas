import { useEffect, useRef, useState } from "react";
import { useVaultStore } from "../store/vaultStore";
import { useSearchResults } from "../lib/useSearchResults";
import { runCopyFiles } from "../lib/export/runExport";
import { DEFAULT_EXPORT_DEST_ABS } from "../lib/export/dest";
import { isTauriRuntime } from "../lib/fileSystem.tauri";

export function SearchBox() {
  const setQuery = useVaultStore((s) => s.setQuery);
  const query = useVaultStore((s) => s.query);
  const prefs = useVaultStore((s) => s.searchPrefs);
  const [local, setLocal] = useState("");
  const [quickBusy, setQuickBusy] = useState(false);
  const [quickMsg, setQuickMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { results: filtered } = useSearchResults();

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

  async function quickExportAll() {
    if (!isTauriRuntime() || filtered.length === 0 || quickBusy) return;
    setQuickBusy(true);
    setQuickMsg(null);
    try {
      const r = await runCopyFiles(filtered, DEFAULT_EXPORT_DEST_ABS);
      setQuickMsg(
        `${r.copied}/${r.total} arquivo(s) em ${DEFAULT_EXPORT_DEST_ABS}\\${r.subfolder}`
      );
    } catch (e) {
      setQuickMsg((e as Error).message ?? String(e));
    } finally {
      setQuickBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <div className="relative">
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          className="pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ink-faint)]"
          aria-hidden
        >
          <circle cx="9" cy="9" r="5.5" />
          <path d="M13 13l4 4" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          type="search"
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder={placeholder}
          className="field pr-7 pl-7"
        />
        {local && (
          <button
            onClick={() => setLocal("")}
            className="absolute top-1/2 right-1.5 -translate-y-1/2 text-sm leading-none text-[var(--ink-faint)] hover:text-[var(--accent)]"
            aria-label="Limpar"
          >
            ×
          </button>
        )}
      </div>

      <div className="flex items-center justify-between px-0.5">
        <span className="meta-label select-none">{modeHint}</span>
        <span className="meta-label select-none tabular-nums">
          {filtered.length} resultado(s)
        </span>
      </div>

      {query.trim() && filtered.length > 0 && isTauriRuntime() && (
        <div className="space-y-1 pt-1">
          <button
            type="button"
            disabled={quickBusy}
            onClick={() => void quickExportAll()}
            title={`Copiar ${filtered.length} resultado(s) para ${DEFAULT_EXPORT_DEST_ABS}`}
            className="tb-btn w-full justify-center border-[var(--accent-ring)] bg-[var(--accent-soft)] text-[var(--accent)] hover:bg-[#e7dcfb] hover:text-[var(--accent-strong)]"
          >
            {quickBusy
              ? "A exportar…"
              : `Exportar rápido — todos pesquisados (${filtered.length})`}
          </button>
          {quickMsg && (
            <p className="text-[10px] leading-snug break-words text-[var(--ink-muted)]">
              {quickMsg}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
