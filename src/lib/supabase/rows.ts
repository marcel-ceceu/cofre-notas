/**
 * Mapeamento nota .md → linha da tabela public.vault_cofrenotas.
 * Funções puras: só leem o frontmatter e produzem a linha (sem I/O).
 */

import type { Note } from "../fileSystem";
import { parseFrontmatter, type Origem } from "../import/frontmatter";
import { md5Hex } from "./hash";

export const TABLE = "vault_cofrenotas";

const ORIGENS: readonly Origem[] = [
  "CLAUDECODE",
  "CURSOR",
  "CLAUDEWEB",
  "CHATGPT",
];

/** Linha enviada no upsert. `conteudo` é o arquivo cru inteiro (com frontmatter). */
export type VaultRow = {
  origem: Origem;
  id_origem: string;
  titulo: string;
  conteudo: string;
  dtconversaini: string | null;
  dtconversafin: string | null;
};

function stripQuotes(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && t[0] === '"' && t[t.length - 1] === '"') {
    return t.slice(1, -1);
  }
  return t;
}

/** Data válida para timestamptz: sem aspas e parseável; senão null. */
function validDate(s: string | undefined): string | null {
  const t = stripQuotes(s ?? "");
  if (!t) return null;
  return Number.isNaN(Date.parse(t)) ? null : t;
}

/**
 * Normaliza as datas para nunca quebrar o cast nem o CHECK do banco
 * (dtconversafin >= dtconversaini): remove aspas, descarta não-parseáveis, e
 * se a final for anterior à inicial, descarta a final.
 */
function sanitizeDates(
  created: string | undefined,
  updated: string | undefined
): { ini: string | null; fin: string | null } {
  const ini = validDate(created);
  let fin = validDate(updated);
  if (ini && fin && Date.parse(fin) < Date.parse(ini)) fin = null;
  return { ini, fin };
}

/**
 * Converte uma nota em linha. Retorna null se o cabeçalho não estiver completo
 * (sem origem válida, sem uuid ou sem título) ou se o conteúdo tiver um byte NUL
 * (rejeitado pelo tipo text do Postgres) — essas ficam de fora do upload.
 */
export function noteToRow(note: Note): VaultRow | null {
  if (note.content.includes("\u0000")) return null;

  const fm = parseFrontmatter(note.content);
  if (!fm) return null;

  const origem = fm.map.origem as Origem;
  if (!ORIGENS.includes(origem)) return null;

  const idOrigem = (fm.map.uuid ?? "").trim();
  const titulo = stripQuotes(fm.map.title ?? "");
  if (!idOrigem || !titulo) return null;

  const { ini, fin } = sanitizeDates(fm.map.created, fm.map.updated);

  return {
    origem,
    id_origem: idOrigem,
    titulo,
    conteudo: note.content,
    dtconversaini: ini,
    dtconversafin: fin,
  };
}

/** Hash local do conteúdo — comparado ao hash_conteudo do banco no dry-run. */
export function rowHash(row: VaultRow): string {
  return md5Hex(row.conteudo);
}

/** Chave natural (bate com o unique (origem, id_origem)). */
export function rowKey(row: { origem: string; id_origem: string }): string {
  return `${row.origem}|${row.id_origem}`;
}
