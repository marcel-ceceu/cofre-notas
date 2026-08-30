import { useVaultStore } from "../store/vaultStore";
import { runSearch, type SearchResult } from "./search";

/**
 * Resultado de busca compartilhado por todos os consumidores (lista, contador
 * do App, SearchBox, toolbar e consolidação). O cache vive em runSearch — um
 * único scan do cofre por mudança real de notes/query/prefs/sortKey; os demais
 * consumidores recebem a MESMA referência de resultado.
 */
export function useSearchResults(): SearchResult {
  const notes = useVaultStore((s) => s.notes);
  const query = useVaultStore((s) => s.query);
  const prefs = useVaultStore((s) => s.searchPrefs);
  const sortKey = useVaultStore((s) => s.sortKey);
  return runSearch(notes, query, prefs, sortKey);
}
