/**
 * Importar Claude — reconhece os .zip de export na pasta Downloads.
 * Funções PURAS (sem I/O): quem chama lista a pasta e passa nome/caminho/mtime.
 *
 * Dois formatos convivem:
 * - antigo (até ago/2026): `data-<id>-<ts>-<id>-batch-0000.zip` (+ batch-0001…),
 *   com conversations.json, projects/, memories.json, users.json;
 * - novo (desde fim de ago/2026): `conversations-000.zip` (+ -001…), só com
 *   conversations.json. O navegador salva repetidos como `conversations-000 (1).zip`
 *   (Chrome/Edge) ou `conversations-000(1).zip` (Firefox).
 */

const LEGACY_RE = /^data-.*\.zip$/i;
/** Cópias repetidas: Chrome/Edge salvam "-000 (1).zip"; Firefox, "-000(1).zip". */
const PART_RE = /^conversations-(\d+)(?: ?\(\d+\))?\.zip$/i;

/**
 * Partes do formato novo baixadas com até 1 h de diferença da mais recente
 * contam como o mesmo export. Uma sobra de export antigo, se entrar, não faz
 * mal: o import deduplica por uuid ficando com a versão mais nova.
 */
export const PART_WINDOW_MS = 60 * 60 * 1000;

export type ExportFileInfo = { name: string; path: string; mtime: number };

/** O nome parece um .zip de export do Claude (formato novo ou antigo)? */
export function isExportZipName(name: string): boolean {
  return LEGACY_RE.test(name) || PART_RE.test(name);
}

/**
 * Escolhe o export mais recente e devolve os caminhos de todas as partes dele.
 * - antigo: os batches com o mesmo prefixo do mais recente (data-…-batch-NNNN);
 * - novo: uma cópia por número de parte (a mais recente), dentro da janela de
 *   PART_WINDOW_MS, em ordem de parte (-000, -001…).
 */
export function pickLatestExport(files: ExportFileInfo[]): string[] {
  const cands = files
    .filter((f) => isExportZipName(f.name))
    .sort((a, b) => b.mtime - a.mtime);
  if (cands.length === 0) return [];
  const newest = cands[0];

  if (LEGACY_RE.test(newest.name)) {
    const prefix = newest.name.replace(/batch-\d+\.zip$/i, "");
    return cands
      .filter((f) => LEGACY_RE.test(f.name) && f.name.startsWith(prefix))
      .map((f) => f.path);
  }

  const byPart = new Map<string, ExportFileInfo>();
  for (const f of cands) {
    const m = PART_RE.exec(f.name);
    if (!m || newest.mtime - f.mtime > PART_WINDOW_MS) continue;
    if (!byPart.has(m[1])) byPart.set(m[1], f); // cands já vem do mais novo ao mais velho
  }
  return [...byPart.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([, f]) => f.path);
}
