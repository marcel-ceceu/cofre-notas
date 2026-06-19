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
import { ResultContextMenu } from "./ResultContextMenu";

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString("pt-BR");
}

export function NoteList() {
  const notes = useVaultStore((s) => s.notes);
  const sortKey = useVaultStore((s) => s.sortKey);
  const query = useVaultStore((s) => s.query);
  const prefs = useVaultStore((s) => s.searchPrefs);
  const activePath = useVaultStore((s) => s.activePath);
  const setActivePath = useVaultStore((s) => s.setActivePath);
  const loading = useVaultStore((s) => s.loading);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

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
    setSelected((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const p of prev) {
        if (visiblePaths.has(p)) next.add(p);
        else changed = true;
      }
      return changed ? next : prev;
    });
    setAnchor((prev) => (prev && visiblePaths.has(prev) ? prev : null));
  }, [rows]);

  function onItemClick(e: React.MouseEvent, index: number, path: string) {
    if (e.shiftKey && anchor) {
      const ai = rows.findIndex((r) => r.note.path === anchor);
      if (ai !== -1) {
        const [lo, hi] = ai < index ? [ai, index] : [index, ai];
        setSelected(new Set(rows.slice(lo, hi + 1).map((r) => r.note.path)));
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
      setAnchor(path);
      return;
    }
    // clique simples: seleciona só este e abre no painel
    setSelected(new Set([path]));
    setAnchor(path);
    setActivePath(path);
  }

  function onItemContextMenu(e: React.MouseEvent, path: string) {
    e.preventDefault();
    if (!selected.has(path)) {
      setSelected(new Set([path]));
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

  if (!notes.length && !loading) {
    return (
      <p className="p-4 text-xs text-zinc-500">
        Nenhuma nota carregada. Clique em "Abrir cofre".
      </p>
    );
  }

  if (!visible.length) {
    return (
      <p className="p-4 text-xs text-zinc-500">
        Nenhuma nota corresponde a "{query}".
      </p>
    );
  }

  return (
    <>
      {selected.size > 0 && (
        <div className="flex items-center justify-between border-b border-violet-200 bg-violet-50 px-3 py-1 text-[11px] text-violet-700">
          <span>
            {selected.size} selecionada{selected.size > 1 ? "s" : ""}
          </span>
          <button
            type="button"
            onClick={() => {
              setSelected(new Set());
              setAnchor(null);
            }}
            className="hover:underline"
          >
            limpar
          </button>
        </div>
      )}

      <ul className="flex-1 overflow-y-auto select-none">
        {rows.map(({ note: n, count, snippet }, index) => {
          const isSel = selected.has(n.path);
          const isActive = activePath === n.path;
          return (
            <li key={n.path}>
              <button
                onClick={(e) => onItemClick(e, index, n.path)}
                onContextMenu={(e) => onItemContextMenu(e, n.path)}
                className={`w-full text-left px-3 py-2 text-sm border-b border-zinc-100 ${
                  isSel
                    ? "bg-violet-100 ring-1 ring-inset ring-violet-300"
                    : isActive
                      ? "bg-zinc-100"
                      : "hover:bg-zinc-50"
                }`}
              >
                <div className={`truncate ${isActive ? "font-medium" : ""}`}>
                  {highlight(n.name, query, prefs.searchMode)}
                </div>

                {terms.length > 0 && snippet && (
                  <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-zinc-600">
                    {highlight(snippet, query, prefs.searchMode)}
                  </div>
                )}

                <div className="mt-1 flex items-center gap-1.5 text-[10px] text-zinc-500">
                  {terms.length > 0 && (
                    <span
                      className="rounded bg-violet-100 px-1 font-medium text-violet-700"
                      title="ocorrências do termo nesta nota"
                    >
                      {count}×
                    </span>
                  )}
                  <span title="data da conversa original">
                    conversa {formatDate(n.createdAt)}
                  </span>
                  <span className="text-zinc-300">·</span>
                  <span title="data de importação">
                    importado {formatDate(n.lastModified)}
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
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}
