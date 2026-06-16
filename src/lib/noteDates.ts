/**
 * Data ORIGINAL da conversa de uma nota.
 * Ordem: `created:` do frontmatter → data yyyy-MM-dd do nome → fallback (importação).
 * Módulo isolado (sem dependências) para os dois leitores usarem sem ciclo de import.
 */
export function parseCreatedAt(
  content: string,
  name: string,
  fallbackMs: number
): number {
  // 1) created: dentro do bloco de frontmatter do topo
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fm) {
    const m = fm[1].match(/^created:\s*(.+)$/m);
    if (m) {
      const t = Date.parse(m[1].trim());
      if (!Number.isNaN(t)) return t;
    }
  }
  // 2) data no nome do arquivo (yyyy-MM-dd)
  const fn = name.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (fn) {
    const t = Date.parse(`${fn[1]}-${fn[2]}-${fn[3]}T00:00:00`);
    if (!Number.isNaN(t)) return t;
  }
  // 3) fallback: data de importação
  return fallbackMs;
}
