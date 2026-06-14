import type { Note } from "./fileSystem";
import type { SortKey } from "../store/vaultStore";
import { sortNotes } from "./sortNotes";

/** Como o termo digitado é interpretado. */
export type SearchMode = "tokens" | "substring";

/** Quando a busca dispara. */
export type TriggerMode = "enter" | "auto";

export type SearchPrefs = {
  /** "enter": só consulta ao pressionar Enter (estilo ERP). "auto": debounce após mínimo de caracteres. */
  triggerMode: TriggerMode;
  /** Mínimo de caracteres para disparo automático (só usado quando triggerMode === "auto"). */
  minChars: number;
  /** "tokens": palavras soltas (E entre palavras, OU entre campos). "substring": trecho contínuo exato. */
  searchMode: SearchMode;
  /** Inclui o corpo da nota na busca (campo auxiliar). O título é sempre pesquisado. */
  includeBody: boolean;
  /** Limite de resultados por consulta. 0 = sem limite. */
  resultLimit: number;
};

export const DEFAULT_SEARCH_PREFS: SearchPrefs = {
  triggerMode: "auto",
  minChars: 3,
  searchMode: "tokens",
  includeBody: true,
  resultLimit: 0,
};

/** Caractere "de palavra" (letra ou dígito Unicode). Reutilizado — sem flag global, sem estado. */
const WORD_CHAR = /[\p{L}\p{N}]/u;

/** Extrai termos: frases entre aspas ou palavras soltas (estilo Google). */
export function parseSearchQuery(query: string): string[] {
  const terms: string[] = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(query)) !== null) {
    const term = (m[1] ?? m[2] ?? "").trim();
    if (term) terms.push(term.toLowerCase());
  }
  return terms;
}

/**
 * Termos a casar/realçar conforme o modo ativo.
 * - tokens: divide em palavras (respeitando "frases entre aspas").
 * - substring: o trecho inteiro como termo único.
 */
export function searchTerms(query: string, mode: SearchMode): string[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  if (mode === "substring") return [trimmed.toLowerCase()];
  return parseSearchQuery(trimmed);
}

function fieldsOf(note: Note, includeBody: boolean): string[] {
  return includeBody ? [note.name, note.content] : [note.name];
}

/**
 * Casa a nota: cada termo precisa aparecer em pelo menos um campo (E entre termos, OU entre campos).
 * No modo substring há um único termo, então vira "o trecho aparece em algum campo".
 */
export function noteMatches(
  note: Note,
  terms: string[],
  includeBody: boolean
): boolean {
  if (terms.length === 0) return true;
  const fields = fieldsOf(note, includeBody).map((f) => f.toLowerCase());
  return terms.every((t) => fields.some((f) => f.includes(t)));
}

/** Apenas as notas que casam — sem ordenar, sem limitar (usado para contagem). */
export function filterNotes(
  notes: Note[],
  query: string,
  prefs: SearchPrefs
): Note[] {
  const terms = searchTerms(query, prefs.searchMode);
  if (terms.length === 0) return notes;
  return notes.filter((n) => noteMatches(n, terms, prefs.includeBody));
}

/** `term` ocorre no início de alguma palavra de `text`? */
function matchesWordStart(text: string, term: string): boolean {
  let i = text.indexOf(term);
  while (i !== -1) {
    if (i === 0 || !WORD_CHAR.test(text[i - 1])) return true;
    i = text.indexOf(term, i + 1);
  }
  return false;
}

/** Bônus de proximidade: quanto mais juntos os termos no texto, maior. 0 se algum termo falta. */
function proximityBonus(text: string, terms: string[]): number {
  if (terms.length < 2) return 0;
  const positions = terms.map((t) => text.indexOf(t));
  if (positions.some((p) => p === -1)) return 0;
  const span = Math.max(...positions) - Math.min(...positions);
  return Math.max(0, 60 - span);
}

/**
 * Relevância: correspondência exata > início > início de palavra > contém,
 * com peso maior no título que no corpo, mais bônus de proximidade.
 */
export function relevanceScore(
  note: Note,
  terms: string[],
  includeBody: boolean
): number {
  if (terms.length === 0) return 0;
  const title = note.name.toLowerCase();
  const body = includeBody ? note.content.toLowerCase() : "";
  const phrase = terms.join(" ");

  let score = 0;

  // Frase inteira no título
  if (title === phrase) score += 1000;
  else if (title.startsWith(phrase)) score += 400;
  else if (title.includes(phrase)) score += 200;

  // Por termo
  for (const term of terms) {
    if (title.startsWith(term)) score += 140;
    else if (matchesWordStart(title, term)) score += 90;
    else if (title.includes(term)) score += 40;

    if (body) {
      if (matchesWordStart(body, term)) score += 12;
      else if (body.includes(term)) score += 6;
    }
  }

  score += proximityBonus(title, terms);
  if (body) score += proximityBonus(body, terms) / 6;

  return score;
}

/**
 * Pipeline completo e único — filtra, ordena (relevância quando pedido) e aplica o limite.
 * Mesma lógica em todos os pontos que consultam notas.
 */
export function queryNotes(
  notes: Note[],
  query: string,
  prefs: SearchPrefs,
  sortKey: SortKey
): Note[] {
  const terms = searchTerms(query, prefs.searchMode);
  const matched = terms.length
    ? notes.filter((n) => noteMatches(n, terms, prefs.includeBody))
    : notes;

  let ordered: Note[];
  if (sortKey === "relevance" && terms.length) {
    ordered = [...matched]
      .map((n) => ({ n, s: relevanceScore(n, terms, prefs.includeBody) }))
      .sort((a, b) => b.s - a.s || b.n.lastModified - a.n.lastModified)
      .map((x) => x.n);
  } else {
    ordered = sortNotes(matched, sortKey);
  }

  return prefs.resultLimit > 0 ? ordered.slice(0, prefs.resultLimit) : ordered;
}
