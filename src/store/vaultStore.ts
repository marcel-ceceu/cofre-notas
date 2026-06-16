import { create } from "zustand";
import type { Note, VaultHandle } from "../lib/fileSystem";
import { DEFAULT_SEARCH_PREFS, type SearchPrefs } from "../lib/search";

export type SortKey =
  | "relevance"
  | "occurrences"
  | "conv-desc"
  | "conv-asc"
  | "import-desc"
  | "import-asc"
  | "name-asc"
  | "name-desc";

const PREFS_KEY = "cofre-notas:searchPrefs";
const SORT_KEY = "cofre-notas:sortKey";

function loadSearchPrefs(): SearchPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_SEARCH_PREFS;
    const parsed = JSON.parse(raw) as Partial<SearchPrefs>;
    const merged = { ...DEFAULT_SEARCH_PREFS, ...parsed };
    // saneamento
    merged.minChars = Math.max(1, Math.floor(merged.minChars) || 1);
    merged.resultLimit = Math.max(0, Math.floor(merged.resultLimit) || 0);
    return merged;
  } catch {
    return DEFAULT_SEARCH_PREFS;
  }
}

function saveSearchPrefs(prefs: SearchPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage indisponível — preferências valem só para a sessão.
  }
}

function loadSortKey(): SortKey {
  try {
    const raw = localStorage.getItem(SORT_KEY);
    if (!raw) return "import-desc";
    // migração dos valores antigos (eram por data de importação)
    if (raw === "date-desc") return "import-desc";
    if (raw === "date-asc") return "import-asc";
    return raw as SortKey;
  } catch {
    return "import-desc";
  }
}

function saveSortKey(key: SortKey): void {
  try {
    localStorage.setItem(SORT_KEY, key);
  } catch {
    // ignora
  }
}

type VaultState = {
  dirHandle: VaultHandle | null;
  notes: Note[];
  activePath: string | null;
  loading: boolean;
  error: string | null;
  sortKey: SortKey;
  query: string;
  searchPrefs: SearchPrefs;

  setDirHandle: (h: VaultHandle | null) => void;
  setNotes: (notes: Note[]) => void;
  setActivePath: (path: string | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setSortKey: (sortKey: SortKey) => void;
  setQuery: (query: string) => void;
  setSearchPrefs: (patch: Partial<SearchPrefs>) => void;
  resetSearchPrefs: () => void;
  reset: () => void;
};

export const useVaultStore = create<VaultState>((set, get) => ({
  dirHandle: null,
  notes: [],
  activePath: null,
  loading: false,
  error: null,
  sortKey: loadSortKey(),
  query: "",
  searchPrefs: loadSearchPrefs(),

  setDirHandle: (dirHandle) => set({ dirHandle }),
  setNotes: (notes) => set({ notes }),
  setActivePath: (activePath) => set({ activePath }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setSortKey: (sortKey) => {
    saveSortKey(sortKey);
    set({ sortKey });
  },
  setQuery: (query) => set({ query }),
  setSearchPrefs: (patch) => {
    const next = { ...get().searchPrefs, ...patch };
    next.minChars = Math.max(1, Math.floor(next.minChars) || 1);
    next.resultLimit = Math.max(0, Math.floor(next.resultLimit) || 0);
    saveSearchPrefs(next);
    set({ searchPrefs: next });
  },
  resetSearchPrefs: () => {
    saveSearchPrefs(DEFAULT_SEARCH_PREFS);
    set({ searchPrefs: DEFAULT_SEARCH_PREFS });
  },
  reset: () =>
    set({
      dirHandle: null,
      notes: [],
      activePath: null,
      loading: false,
      error: null,
      query: "",
    }),
}));
