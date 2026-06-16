import { useMemo } from "react";
import { useVaultStore } from "../store/vaultStore";
import {
  queryNotes,
  searchTerms,
  buildSnippet,
  countOccurrences,
} from "../lib/search";
import { highlight } from "../lib/highlight";

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
    <ul className="flex-1 overflow-y-auto">
      {rows.map(({ note: n, count, snippet }) => (
        <li key={n.path}>
          <button
            onClick={() => setActivePath(n.path)}
            className={`w-full text-left px-3 py-2 text-sm border-b border-zinc-100 hover:bg-zinc-50 ${
              activePath === n.path ? "bg-zinc-100" : ""
            }`}
          >
            <div
              className={`truncate ${
                activePath === n.path ? "font-medium" : ""
              }`}
            >
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
      ))}
    </ul>
  );
}
