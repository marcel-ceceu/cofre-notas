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

/** Campo onde um termo deve ser procurado. */
type TermField = "any" | "title" | "body";

/** Um termo da consulta, já com operadores resolvidos. */
type QueryTerm = { value: string; field: TermField; negate: boolean };

/**
 * Consulta estruturada: lista de GRUPOS unidos por OU; dentro do grupo os
 * termos são unidos por E (com exclusão via `negate`).
 */
export type ParsedQuery = QueryTerm[][];

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

// token: [-] [title:|body:] ("frase" | palavra)
const TOKEN_RE = /(-)?(?:(title|body):)?(?:"([^"]*)"|(\S+))/gi;

/** Cache da última consulta interpretada — parseQuery roda por linha da lista e por bloco realçado do viewer. */
let pqCache: { query: string; mode: SearchMode; pq: ParsedQuery } | null = null;

/**
 * Interpreta a consulta com operadores (apenas no modo "tokens"):
 * - espaço = E   |   OR / OU (MAIÚSCULO) = OU   |   -termo = excluir
 * - "frase exata"   |   title:termo / body:termo (campo específico)
 * No modo "substring" a consulta inteira é um termo literal único.
 */
export function parseQuery(query: string, mode: SearchMode): ParsedQuery {
  if (pqCache && pqCache.query === query && pqCache.mode === mode) {
    return pqCache.pq;
  }
  const pq = parseQueryUncached(query, mode);
  pqCache = { query, mode, pq };
  return pq;
}

function parseQueryUncached(query: string, mode: SearchMode): ParsedQuery {
  const trimmed = query.trim();
  if (!trimmed) return [];
  if (mode === "substring") {
    return [[{ value: trimmed.toLowerCase(), field: "any", negate: false }]];
  }

  const groups: QueryTerm[][] = [];
  let current: QueryTerm[] = [];
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(trimmed)) !== null) {
    const negate = !!m[1];
    const fieldRaw = m[2]?.toLowerCase();
    const quoted = m[3];
    const bare = m[4];

    // operador OU: token cru, MAIÚSCULO, sem -, sem campo, sem aspas
    if (!negate && !fieldRaw && quoted === undefined && (bare === "OR" || bare === "OU")) {
      if (current.length) {
        groups.push(current);
        current = [];
      }
      continue;
    }

    const value = (quoted !== undefined ? quoted : bare ?? "").trim().toLowerCase();
    if (!value) continue;
    const field: TermField = fieldRaw === "title" ? "title" : fieldRaw === "body" ? "body" : "any";
    current.push({ value, field, negate });
  }
  if (current.length) groups.push(current);
  return groups;
}

/** Termos POSITIVOS (não excluídos) — para realce, contagem, snippet e relevância. */
export function positiveTermsOf(pq: ParsedQuery): string[] {
  const set = new Set<string>();
  for (const g of pq) for (const t of g) if (!t.negate) set.add(t.value);
  return [...set];
}

/**
 * Termos a casar/realçar conforme o modo ativo (apenas os positivos).
 */
export function searchTerms(query: string, mode: SearchMode): string[] {
  return positiveTermsOf(parseQuery(query, mode));
}

function groupMatches(
  group: QueryTerm[],
  title: string,
  body: string,
  includeBody: boolean
): boolean {
  for (const t of group) {
    const hay =
      t.field === "title"
        ? title
        : t.field === "body"
          ? body
          : includeBody
            ? `${title}\n${body}`
            : title;
    const present = hay.includes(t.value);
    if (t.negate ? present : !present) return false;
  }
  return true;
}

/**
 * Cache de normalização por nota — rebaixar o corpo inteiro custa MB por scan.
 * WeakMap: cobre todos os loaders (tauri/web/IndexedDB) sem mudar o tipo Note,
 * e é liberado pelo GC junto com o array antigo em cada reload do cofre.
 */
const lowerCache = new WeakMap<Note, { title: string; body: string }>();

function lowered(note: Note): { title: string; body: string } {
  let c = lowerCache.get(note);
  if (!c) {
    c = { title: note.name.toLowerCase(), body: note.content.toLowerCase() };
    lowerCache.set(note, c);
  }
  return c;
}

/** Casa a nota contra a consulta estruturada (OU entre grupos, E dentro do grupo). */
export function noteMatchesQuery(
  note: Note,
  pq: ParsedQuery,
  includeBody: boolean
): boolean {
  if (pq.length === 0) return true;
  const { title, body } = lowered(note);
  return pq.some((g) => groupMatches(g, title, body, includeBody));
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
  const { title, body: loweredBody } = lowered(note);
  const body = includeBody ? loweredBody : "";
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

function countIn(hay: string, term: string): number {
  let total = 0;
  let i = hay.indexOf(term);
  while (i !== -1) {
    total++;
    i = hay.indexOf(term, i + term.length);
  }
  return total;
}

/** Total de ocorrências dos termos no título + corpo (case-insensitive). */
export function countOccurrences(note: Note, terms: string[]): number {
  if (terms.length === 0) return 0;
  const { title, body } = lowered(note);
  let total = 0;
  for (const t of terms) {
    if (!t) continue;
    total += countIn(title, t) + countIn(body, t);
  }
  return total;
}

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/**
 * Trecho de contexto (~2*radius chars) ao redor da 1ª ocorrência no corpo,
 * com "…" nas bordas. Remove o frontmatter e colapsa espaços. Se casar só no
 * título, devolve o início do corpo.
 */
export function buildSnippet(
  content: string,
  terms: string[],
  radius = 70
): string {
  const body = content.replace(FRONTMATTER_RE, "").replace(/\s+/g, " ").trim();
  const head = (s: string) =>
    s.slice(0, radius * 2).trim() + (s.length > radius * 2 ? "…" : "");
  if (terms.length === 0) return head(body);

  const lower = body.toLowerCase();
  let pos = -1;
  for (const t of terms) {
    if (!t) continue;
    const i = lower.indexOf(t);
    if (i !== -1 && (pos === -1 || i < pos)) pos = i;
  }
  if (pos === -1) return head(body); // casou só no título

  const start = Math.max(0, pos - radius);
  const end = Math.min(body.length, pos + radius);
  let snip = body.slice(start, end).trim();
  if (start > 0) snip = "…" + snip;
  if (end < body.length) snip = snip + "…";
  return snip;
}

/** Resultado único da busca — compartilhado por lista, contadores, toolbar e consolidação. */
export type SearchResult = {
  /** Pós-ordenação e pós-resultLimit — o que a lista mostra. */
  results: Note[];
  /** Notas que casam ANTES do resultLimit — contadores do App/status bar. */
  matchedCount: number;
  /** Termos positivos da consulta — realce, snippet e contagem. */
  terms: string[];
};

let lastArgs: readonly [Note[], string, SearchPrefs, SortKey] | null = null;
let lastResult: SearchResult | null = null;

/**
 * Pipeline completo e único — filtra, ordena (relevância/ocorrências quando há
 * termo) e aplica o limite, com cache da última chamada por identidade dos
 * argumentos. Funciona porque a store sempre SUBSTITUI `notes`/`searchPrefs`
 * por referências novas; mutação in-place invalidaria o cache silenciosamente.
 */
export function runSearch(
  notes: Note[],
  query: string,
  prefs: SearchPrefs,
  sortKey: SortKey
): SearchResult {
  if (
    lastArgs &&
    lastArgs[0] === notes &&
    lastArgs[1] === query &&
    lastArgs[2] === prefs &&
    lastArgs[3] === sortKey
  ) {
    return lastResult!;
  }

  const pq = parseQuery(query, prefs.searchMode);
  const terms = positiveTermsOf(pq);
  const matched = pq.length
    ? notes.filter((n) => noteMatchesQuery(n, pq, prefs.includeBody))
    : notes;

  let ordered: Note[];
  if (sortKey === "relevance" && terms.length) {
    ordered = [...matched]
      .map((n) => ({ n, s: relevanceScore(n, terms, prefs.includeBody) }))
      .sort((a, b) => b.s - a.s || b.n.lastModified - a.n.lastModified)
      .map((x) => x.n);
  } else if (sortKey === "occurrences" && terms.length) {
    ordered = [...matched]
      .map((n) => ({
        n,
        c: countOccurrences(n, terms),
        s: relevanceScore(n, terms, prefs.includeBody),
      }))
      .sort((a, b) => b.c - a.c || b.s - a.s || b.n.lastModified - a.n.lastModified)
      .map((x) => x.n);
  } else {
    ordered = sortNotes(matched, sortKey);
  }

  const results =
    prefs.resultLimit > 0 ? ordered.slice(0, prefs.resultLimit) : ordered;

  lastArgs = [notes, query, prefs, sortKey];
  lastResult = { results, matchedCount: matched.length, terms };
  return lastResult;
}

/** Compat: mesmo pipeline (com cache), devolvendo só o array final. */
export function queryNotes(
  notes: Note[],
  query: string,
  prefs: SearchPrefs,
  sortKey: SortKey
): Note[] {
  return runSearch(notes, query, prefs, sortKey).results;
}
