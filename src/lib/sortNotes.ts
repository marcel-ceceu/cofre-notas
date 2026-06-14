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
    case "date-asc":
      return copy.sort((a, b) => a.lastModified - b.lastModified);
    // "relevance" sem termo de busca cai aqui: ordena por data desc (a relevância
    // de fato é resolvida em queryNotes quando há consulta ativa).
    case "date-desc":
    case "relevance":
    default:
      return copy.sort((a, b) => b.lastModified - a.lastModified);
  }
}
