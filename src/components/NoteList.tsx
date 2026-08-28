import { useEffect, useMemo, useState } from "react";
import { useVaultStore } from "../store/vaultStore";
import {
  queryNotes,
  searchTerms,
  buildSnippet,
  countOccurrences,
} from "../lib/search";
import { highlight } from "../lib/highlight";
import { formatResults, copyToClipboard } from "../lib/copyResults";
import { runCopyFiles } from "../lib/export/runExport";
import { DEFAULT_EXPORT_DEST_ABS } from "../lib/export/dest";
import { isTauriRuntime } from "../lib/fileSystem.tauri";
import { ResultContextMenu } from "./ResultContextMenu";

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString("pt-BR");
}

type Props = {
  /** Pedido de abrir o modal de sincronização (escopo já definido na store). */
  onRequestSync: () => void;
};

export function NoteList({ onRequestSync }: Props) {
  const notes = useVaultStore((s) => s.notes);
  const sortKey = useVaultStore((s) => s.sortKey);
  const query = useVaultStore((s) => s.query);
  const prefs = useVaultStore((s) => s.searchPrefs);
  const activePath = useVaultStore((s) => s.activePath);
  const setActivePath = useVaultStore((s) => s.setActivePath);
  const loading = useVaultStore((s) => s.loading);

  const selectedPaths = useVaultStore((s) => s.selectedPaths);
  const setSelectedPaths = useVaultStore((s) => s.setSelectedPaths);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  const selected = useMemo(() => new Set(selectedPaths), [selectedPaths]);

  const visible = useMemo(
    () => queryNotes(notes, query, prefs, sortKey),
    [notes, sortKey, query, prefs]
  );

  const terms = useMemo(
    () => searchTerms(query, prefs.searchMode),
    [query, prefs.searchMode]
  );

  // snippet + contagem por item (só quando há busca ativa)
  const rows = useMemo(
    () =>
      visible.map((n) => ({
        note: n,
        count: terms.length ? countOccurrences(n, terms) : 0,
        snippet: terms.length ? buildSnippet(n.content, terms) : "",
      })),
    [visible, terms]
  );

  // Mantém a seleção coerente com o que está visível (poda ao mudar a busca/ordem).
  useEffect(() => {
    const visiblePaths = new Set(rows.map((r) => r.note.path));
    const prev = useVaultStore.getState().selectedPaths;
    const next = prev.filter((p) => visiblePaths.has(p));
    if (next.length !== prev.length) setSelectedPaths(next);
    setAnchor((cur) => (cur && visiblePaths.has(cur) ? cur : null));
  }, [rows, setSelectedPaths]);

  function onItemClick(e: React.MouseEvent, index: number, path: string) {
    if (e.shiftKey && anchor) {
      const ai = rows.findIndex((r) => r.note.path === anchor);
      if (ai !== -1) {
        const [lo, hi] = ai < index ? [ai, index] : [index, ai];
        setSelectedPaths(rows.slice(lo, hi + 1).map((r) => r.note.path));
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) {
      const prev = useVaultStore.getState().selectedPaths;
      setSelectedPaths(
        prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]
      );
      setAnchor(path);
      return;
    }
    // clique simples: seleciona só este e abre no painel
    setSelectedPaths([path]);
    setAnchor(path);
    setActivePath(path);
  }

  function onItemContextMenu(e: React.MouseEvent, path: string) {
    e.preventDefault();
    if (!selected.has(path)) {
      setSelectedPaths([path]);
      setAnchor(path);
    }
    setMenu({ x: e.clientX, y: e.clientY });
  }

  async function copySelectedPaths() {
    const ordered = rows
      .filter((r) => selected.has(r.note.path))
      .map((r) => r.note);
    await copyToClipboard(formatResults(ordered, true, "none", "none"));
  }

  /** Envia a seleção atual ao Supabase (escopo pontual, via modal de sync). */
  function sendSelectedToSupabase() {
    const paths = rows
      .filter((r) => selected.has(r.note.path))
      .map((r) => r.note.path);
    if (!paths.length) return;
    useVaultStore.getState().setSyncScope(paths);
    onRequestSync();
  }

  async function quickExportSelected() {
    const ordered = rows
      .filter((r) => selected.has(r.note.path))
      .map((r) => r.note);
    if (!isTauriRuntime() || !ordered.length || exportBusy) return;
    setExportBusy(true);
    setExportMsg(null);
    try {
      const r = await runCopyFiles(ordered, DEFAULT_EXPORT_DEST_ABS);
      setExportMsg(
        `${r.copied}/${r.total} em ${DEFAULT_EXPORT_DEST_ABS}\\${r.subfolder}`
      );
      setSelectedPaths([]);
      setAnchor(null);
    } catch (e) {
      setExportMsg((e as Error).message ?? String(e));
    } finally {
      setExportBusy(false);
    }
  }

  if (!notes.length && !loading) {
    return (
      <div className="px-4 py-10 text-center">
        <p className="text-[12.5px] font-medium text-[var(--ink-muted)]">
          O cofre está fechado.
        </p>
        <p className="mt-1 text-[11.5px] text-[var(--ink-faint)]">
          Clique em “Abrir cofre” para carregar suas notas.
        </p>
      </div>
    );
  }

  if (!visible.length) {
    return (
      <p className="px-4 py-10 text-center text-[12.5px] text-[var(--ink-muted)]">
        Nada corresponde a “{query}”.
      </p>
    );
  }

  return (
    <>
      {selected.size > 0 && (
        <div className="mx-2 mt-2 mb-1 space-y-1.5 rounded-md border border-[var(--accent-ring)] bg-[var(--accent-soft)] px-2 py-1.5">
          <div className="flex items-center justify-between text-[11px] text-[var(--accent)]">
            <span className="font-medium">
              {selected.size} selecionada{selected.size > 1 ? "s" : ""}
            </span>
            <button
              type="button"
              onClick={() => {
                setSelectedPaths([]);
                setAnchor(null);
                setExportMsg(null);
              }}
              className="text-[var(--ink-muted)] hover:text-[var(--accent)] hover:underline"
            >
              limpar
            </button>
          </div>
          {isTauriRuntime() && (
            <button
              type="button"
              disabled={exportBusy}
              onClick={() => void quickExportSelected()}
              className="tb-btn w-full justify-center border-[var(--accent-ring)] bg-[var(--paper-raised)] text-[var(--accent)] hover:bg-[var(--accent-ring)] hover:text-[var(--accent-hover)]"
            >
              {exportBusy ? "A exportar…" : "Exportar rápido (copiar arquivos)"}
            </button>
          )}
          {exportMsg && (
            <p className="text-[10px] leading-snug break-words text-[var(--ink-muted)]">
              {exportMsg}
            </p>
          )}
        </div>
      )}

      <ul className="flex-1 overflow-y-auto pb-2 select-none">
        {rows.map(({ note: n, count, snippet }, index) => {
          const isSel = selected.has(n.path);
          const isActive = activePath === n.path;
          return (
            <li
              key={n.path}
              className="row-in"
              style={{ animationDelay: `${Math.min(index, 14) * 22}ms` }}
            >
              <button
                onClick={(e) => onItemClick(e, index, n.path)}
                onContextMenu={(e) => onItemContextMenu(e, n.path)}
                className={`relative w-full border-b border-[var(--rule-soft)] py-1.5 pr-2.5 pl-3 text-left transition-colors duration-100 ${
                  isSel
                    ? "bg-[var(--selected)]"
                    : isActive
                      ? "bg-[var(--accent-soft)]"
                      : "hover:bg-[var(--surface-tertiary)]"
                }`}
              >
                <span
                  className={`absolute inset-y-0 left-0 w-[2px] transition-colors ${
                    isActive
                      ? "bg-[var(--accent)]"
                      : isSel
                        ? "bg-[var(--accent-ring)]"
                        : "bg-transparent"
                  }`}
                />
                <div
                  className={`truncate text-[12.5px] leading-snug ${
                    isActive
                      ? "font-semibold text-[var(--ink)]"
                      : "font-medium text-[#2b3237]"
                  }`}
                >
                  {highlight(n.name, query, prefs.searchMode)}
                </div>

                {terms.length > 0 && snippet && (
                  <div className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-[var(--ink-muted)]">
                    {highlight(snippet, query, prefs.searchMode)}
                  </div>
                )}

                <div className="mt-1 flex items-center gap-1.5">
                  {terms.length > 0 && (
                    <span
                      className="rounded-[3px] bg-[var(--accent)] px-1 py-px font-mono-ui text-[9px] font-medium text-white"
                      title="ocorrências do termo nesta nota"
                    >
                      {count}×
                    </span>
                  )}
                  <span className="meta-label" title="data da conversa original">
                    {formatDate(n.createdAt)}
                  </span>
                  <span className="text-[var(--rule)]">/</span>
                  <span className="meta-label" title="data de importação">
                    imp. {formatDate(n.lastModified)}
                  </span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      {menu && (
        <ResultContextMenu
          x={menu.x}
          y={menu.y}
          count={selected.size}
          onCopy={copySelectedPaths}
          onSendSupabase={sendSelectedToSupabase}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}
