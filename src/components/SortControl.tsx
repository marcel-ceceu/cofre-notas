import { useVaultStore, type SortKey } from "../store/vaultStore";

const OPTIONS: { value: SortKey; label: string }[] = [
  { value: "relevance", label: "Relevância" },
  { value: "date-desc", label: "Mais recentes" },
  { value: "date-asc", label: "Mais antigas" },
  { value: "name-asc", label: "Nome (A→Z)" },
  { value: "name-desc", label: "Nome (Z→A)" },
];

export function SortControl() {
  const sortKey = useVaultStore((s) => s.sortKey);
  const setSortKey = useVaultStore((s) => s.setSortKey);

  return (
    <label className="flex items-center gap-2 text-xs text-zinc-600">
      <span className="shrink-0">Ordenar:</span>
      <select
        value={sortKey}
        onChange={(e) => setSortKey(e.target.value as SortKey)}
        className="flex-1 px-2 py-1 rounded border border-zinc-300 bg-white text-zinc-800 focus:outline-none focus:ring-1 focus:ring-zinc-400"
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
