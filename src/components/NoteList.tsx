import { useMemo } from "react";
import { useVaultStore } from "../store/vaultStore";
import { queryNotes } from "../lib/search";

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
      {visible.map((n) => (
        <li key={n.path}>
          <button
            onClick={() => setActivePath(n.path)}
            className={`w-full text-left px-3 py-2 text-sm border-b border-zinc-100 hover:bg-zinc-50 ${
              activePath === n.path ? "bg-zinc-100 font-medium" : ""
            }`}
          >
            <div className="truncate">{n.name}</div>
            <div className="text-[11px] text-zinc-500">
              {new Date(n.lastModified).toLocaleString("pt-BR")}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
