import type { Note } from "../fileSystem";

/** Limpa uma linha colada (prefixos de lista, aspas, wiki [[..]], link [txt](path)). */
function cleanLine(line: string): string {
  let t = line.trim();
  if (!t || t.startsWith("//")) return "";
  t = t.replace(/^\s*\d+\.\s+/, "").replace(/^\s*[-*•]\s+/, "");
  t = t.replace(/^["']|["']$/g, "");
  const wiki = t.match(/^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]$/);
  if (wiki) t = wiki[1].trim();
  const md = t.match(/^\[[^\]]*\]\(([^)]+)\)$/);
  if (md) t = md[1].trim();
  return t.trim();
}

export type ResolveResult = { matched: Note[]; notFound: string[] };

/**
 * Casa cada linha colada com uma nota do cofre — por caminho completo, ou só
 * pelo nome do arquivo (com ou sem `.md`), sem diferenciar maiúsc/minúsc.
 * Mantém a ordem colada e remove duplicatas.
 */
export function resolvePastedPaths(
  text: string,
  allNotes: Note[]
): ResolveResult {
  const byPath = new Map<string, Note>();
  const byBase = new Map<string, Note>();
  const byBaseNoExt = new Map<string, Note>();
  for (const n of allNotes) {
    const p = n.path.replace(/\\/g, "/").toLowerCase();
    if (!byPath.has(p)) byPath.set(p, n);
    const base = p.split("/").pop() || p;
    if (!byBase.has(base)) byBase.set(base, n);
    const noExt = base.replace(/\.md$/i, "");
    if (!byBaseNoExt.has(noExt)) byBaseNoExt.set(noExt, n);
  }

  const matched: Note[] = [];
  const seen = new Set<string>();
  const notFound: string[] = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = cleanLine(raw);
    if (!line) continue;
    const key = line.replace(/\\/g, "/").toLowerCase();
    const base = key.split("/").pop() || key;
    const n =
      byPath.get(key) ||
      byBase.get(base) ||
      byBaseNoExt.get(base.replace(/\.md$/i, ""));
    if (n) {
      if (!seen.has(n.path)) {
        seen.add(n.path);
        matched.push(n);
      }
    } else {
      notFound.push(raw.trim());
    }
  }

  return { matched, notFound };
}
