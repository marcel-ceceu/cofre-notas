/**
 * Importar Claude — Etapa 2 (porta TS de _Core.ps1 / Invoke-Cortesias).
 * Remove cortesias (oi/obrigado/ok…) do início/fim dos turnos, descarta turnos
 * 100% cortesia e preserva blocos de código. Funções PURAS (sem I/O).
 */

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** minúsculas + sem acento + só [a-z0-9 espaço], espaços colapsados. */
export function norm(s: string): string {
  let r = s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, ""); // remove marcas de acento (combining marks)
  r = r.replace(/[^a-z0-9\s]/g, " ");
  return r.replace(/\s+/g, " ").trim();
}

/** Normaliza, deduplica e ordena por comprimento desc (frases longas primeiro). */
export function prepareCortesias(rawPhrases: string[]): string[] {
  const set = new Set<string>();
  for (const p of rawPhrases) {
    const n = norm(p);
    if (n) set.add(n);
  }
  return [...set].sort((a, b) => b.length - a.length);
}

/**
 * Pré-compilado por lista de cortesias: as regex (antes recriadas a cada
 * chamada — 119 por trecho) e o conjunto de palavras que aparecem em alguma
 * cortesia. Cache por identidade do array devolvido por prepareCortesias.
 */
type Compiled = { regexes: RegExp[]; words: Set<string> };
const compiledCache = new WeakMap<string[], Compiled>();

function compiled(cort: string[]): Compiled {
  let c = compiledCache.get(cort);
  if (!c) {
    const words = new Set<string>(["marcel"]);
    for (const ph of cort) for (const w of ph.split(" ")) if (w) words.add(w);
    c = {
      regexes: cort
        .filter((ph) => ph)
        .map((ph) => new RegExp("\\b" + escapeRegex(ph) + "\\b", "g")),
      words,
    };
    compiledCache.set(cort, c);
  }
  return c;
}

/** Resíduo após remover "marcel" e todas as cortesias; sem espaços. */
function residual(n: string, regexes: RegExp[]): string {
  n = n.replace(/\bmarcel\b/g, " ");
  for (const re of regexes) n = n.replace(re, " ");
  return n.replace(/\s/g, "");
}

/**
 * Um trecho é "cortesia" se sobra ≤ 2 caracteres após remover as cortesias.
 * Atalho exato: cada remoção leva só palavras inteiras que fazem parte de
 * alguma cortesia; se as palavras que NÃO fazem já somam > 2 letras, o
 * resíduo nunca cabe em 2 — dispensa as 119 substituições (turnos longos).
 */
function isCourtesy(piece: string, cort: string[]): boolean {
  const n = norm(piece);
  const { regexes, words } = compiled(cort);
  let keep = 0;
  for (const w of n.split(" ")) {
    if (w && !words.has(w)) {
      keep += w.length;
      if (keep > 2) return false;
    }
  }
  return residual(n, regexes).length <= 2;
}

/** Apara frases de cortesia só do INÍCIO do parágrafo. */
function trimLeading(par: string, cort: string[]): string {
  let cut = 0;
  const re = /[^.!?,;\r\n]+[.!?,;]*/g;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(par)) !== null) {
    const seg = mm[0];
    if (mm.index === re.lastIndex) re.lastIndex++; // guarda anti-loop
    if (seg.trim() === "") continue;
    if (isCourtesy(seg, cort)) cut = mm.index + seg.length;
    else break;
  }
  return par.slice(cut).replace(/^[ ,;:\-\t]+/, "");
}

/** Limpa um turno; retorna null se o turno inteiro for cortesia. */
function cleanTurn(body: string, cort: string[]): string | null {
  if (isCourtesy(body, cort)) return null;
  const paras = body.split(/\r?\n\r?\n/);
  while (paras.length > 0 && isCourtesy(paras[0], cort)) paras.shift();
  while (paras.length > 0 && isCourtesy(paras[paras.length - 1], cort)) paras.pop();
  if (paras.length === 0) return null;
  paras[0] = trimLeading(paras[0], cort);
  return paras.join("\n\n").trim();
}

const HEADER_RE = /^##\s+\S+\s+(You|Claude|Cursor)\s+\*\([^)]*\)\*[^\r\n]*\r?\n/gm;
const CODE_FENCE_RE = /```[\s\S]*?```/g;

/**
 * Recebe o conteúdo cru de uma nota e devolve a versão sem cortesias.
 * Preserva o frontmatter YAML e os blocos de código intactos.
 */
export function removeCortesias(raw: string, cort: string[]): string {
  // separa frontmatter
  let yaml = "";
  let body = raw;
  const mY = raw.match(/^(---\r?\n[\s\S]*?\r?\n---\r?\n)/);
  if (mY) {
    yaml = mY[1];
    body = raw.slice(mY[1].length);
  }

  // protege code fences
  const codes: string[] = [];
  body = body.replace(CODE_FENCE_RE, (m) => `@@CODE_${codes.push(m) - 1}@@`);

  // localiza headers de turno
  const heads = [...body.matchAll(HEADER_RE)];

  let out: string;
  if (heads.length === 0) {
    out = yaml + body;
  } else {
    out = yaml + body.slice(0, heads[0].index ?? 0);
    for (let i = 0; i < heads.length; i++) {
      const h = heads[i];
      const start = (h.index ?? 0) + h[0].length;
      const end = i + 1 < heads.length ? heads[i + 1].index ?? body.length : body.length;
      const clean = cleanTurn(body.slice(start, end), cort);
      if (clean === null) continue; // turno removido
      out += h[0] + "\n" + clean + "\n\n";
    }
  }

  // restaura code fences (replacer função evita interpretação de $)
  for (let i = 0; i < codes.length; i++) {
    out = out.replace(`@@CODE_${i}@@`, () => codes[i]);
  }
  return out;
}
