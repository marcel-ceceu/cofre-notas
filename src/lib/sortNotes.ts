import type { Note } from "./fileSystem";
import type { SortKey } from "../store/vaultStore";

export function sortNotes(notes: Note[], key: SortKey): Note[] {
  const copy = [...notes];
  switch (key) {
    case "name-asc":
      return copy.sort((a, b) =>
        a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" })
      );
    case "name-desc":
      return copy.sort((a, b) =>
        b.name.localeCompare(a.name, "pt-BR", { sensitivity: "base" })
      );
    case "import-asc":
      return copy.sort((a, b) => a.lastModified - b.lastModified);
    case "conv-desc":
      return copy.sort((a, b) => b.createdAt - a.createdAt);
    case "conv-asc":
      return copy.sort((a, b) => a.createdAt - b.createdAt);
    // "relevance"/"occurrences" sem termo de busca caem aqui: ordena por data de
    // importação desc (a ordenação real é resolvida em queryNotes com termo ativo).
    case "import-desc":
    case "relevance":
    case "occurrences":
    default:
      return copy.sort((a, b) => b.lastModified - a.lastModified);
  }
}
