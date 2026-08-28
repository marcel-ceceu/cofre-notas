import { useVaultStore, type SortKey } from "../store/vaultStore";

const OPTIONS: { value: SortKey; label: string }[] = [
  { value: "relevance", label: "Relevância" },
  { value: "occurrences", label: "Mais ocorrências" },
  { value: "conv-desc", label: "Conversa (recentes)" },
  { value: "conv-asc", label: "Conversa (antigas)" },
  { value: "import-desc", label: "Importação (recentes)" },
  { value: "import-asc", label: "Importação (antigas)" },
  { value: "name-asc", label: "Nome (A→Z)" },
  { value: "name-desc", label: "Nome (Z→A)" },
];

export function SortControl() {
  const sortKey = useVaultStore((s) => s.sortKey);
  const setSortKey = useVaultStore((s) => s.setSortKey);

  return (
    <label className="flex items-center gap-2">
      <span className="meta-label shrink-0">Ordem</span>
      <select
        value={sortKey}
        onChange={(e) => setSortKey(e.target.value as SortKey)}
        className="field flex-1 px-1.5"
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
