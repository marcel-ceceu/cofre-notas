/**
 * Busca dentro da nota — lógica PURA (sem React/DOM).
 *
 * Comparação sem distinguir maiúsculas nem acentos: "acao" acha "ação" e
 * "Ação". Substring literal (sem operadores da busca global).
 *
 * Limites aceitos: "ß" não vira "ss" (toLowerCase não expande) e ligaduras
 * como "ﬁ" ficam literais (usamos NFD, não NFKD, para não transformar
 * "²"→"2" ou "…"→"...").
 */

export type Span = { start: number; end: number };

/** Texto "dobrado" para comparar + mapa de volta ao original (índices UTF-16). */
export type Folded = {
  folded: string;
  /** map[i] = índice no ORIGINAL do caractere que gerou folded[i]; map[folded.length] = original.length. */
  map: number[];
};

const COMBINING_START = 0x0300;
const COMBINING_END = 0x036f;
const ASCII_LIMIT = 128;
const UPPER_A = 65;
const UPPER_Z = 90;
const CASE_OFFSET = 32;

function isCombining(code: number): boolean {
  return code >= COMBINING_START && code <= COMBINING_END;
}

export function foldText(s: string): Folded {
  let folded = "";
  const map: number[] = [];
  let i = 0;
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (code < ASCII_LIMIT) {
      // Fast path: texto PT-BR é majoritariamente ASCII; evita normalize() por char.
      folded +=
        code >= UPPER_A && code <= UPPER_Z
          ? String.fromCharCode(code + CASE_OFFSET)
          : ch;
      map.push(i);
    } else {
      const out = ch.toLowerCase().normalize("NFD");
      for (let k = 0; k < out.length; k++) {
        if (isCombining(out.charCodeAt(k))) continue;
        folded += out[k];
        map.push(i);
      }
    }
    i += ch.length;
  }
  map.push(s.length);
  return { folded, map };
}

/** Cache de 1 entrada: findMatches roda por nó de texto com o mesmo termo. */
let termCache: { term: string; folded: string } | null = null;

function foldTerm(term: string): string {
  if (termCache && termCache.term === term) return termCache.folded;
  const folded = foldText(term).folded;
  termCache = { term, folded };
  return folded;
}

/** Ocorrências do termo no texto, em posições do ORIGINAL, sem sobreposição, em ordem. */
export function findMatches(text: string, term: string): Span[] {
  if (term.trim() === "" || text.length === 0) return [];
  const ft = foldTerm(term);
  if (ft.length === 0) return [];
  const { folded, map } = foldText(text);
  const spans: Span[] = [];
  let i = 0;
  while (i < folded.length) {
    const idx = folded.indexOf(ft, i);
    if (idx === -1) break;
    spans.push({ start: map[idx], end: map[idx + ft.length] });
    i = idx + ft.length;
  }
  return spans;
}

/** Próximo índice com wrap-around. -1 = "nenhum atual". */
export function stepIndex(current: number, total: number, delta: 1 | -1): number {
  if (total <= 0) return -1;
  if (current < 0) return delta > 0 ? 0 : total - 1;
  return (current + delta + total) % total;
}
