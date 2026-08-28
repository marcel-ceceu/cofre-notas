/**
 * Cabeçalho padrão (frontmatter YAML) das notas do cofre.
 *
 * Funções PURAS: recebem o conteúdo cru de um .md e devolvem análise ou um novo
 * conteúdo — sem I/O (a gravação em disco fica na camada run*, como no import).
 *
 * Modelo padrão (o mesmo que o import já escreve + `origem`):
 *   ---
 *   title: "..."
 *   origem: CLAUDEWEB
 *   uuid: ...
 *   created: 2026-06-06T20:49:00Z
 *   updated: 2026-06-07T13:00:31Z
 *   ---
 *
 * Mapa para a tabela public.vault_cofrenotas:
 *   uuid → id_origem · title → titulo · origem → origem
 *   created → dtconversaini · updated → dtconversafin · corpo → conteudo
 */

import type { Note } from "../fileSystem";

/** Fontes suportadas. Espelha o CHECK da migration. */
export type Origem = "CLAUDECODE" | "CURSOR" | "CLAUDEWEB" | "CHATGPT";

/** Campos exigidos pelo upload (todos precisam existir no frontmatter). */
export const REQUIRED_KEYS = [
  "title",
  "origem",
  "uuid",
  "created",
  "updated",
] as const;

/** Bloco de frontmatter localizado no topo: BOM? + abertura + miolo + fecho. */
const FRONTMATTER_RE = /^(﻿?)(---\r?\n)([\s\S]*?)(\r?\n---\r?\n)/;

export type Frontmatter = {
  /** valores por chave (última vence), já com espaços aparados */
  map: Record<string, string>;
  /** chaves na ordem em que aparecem */
  order: string[];
  /** miolo cru entre as cercas `---` (sem as cercas) */
  inner: string;
  /** quebra de linha detectada no bloco */
  eol: "\r\n" | "\n";
  /** índice logo após o bloco inteiro (onde começa o corpo) */
  bodyIndex: number;
};

/** Lê o frontmatter do topo. Retorna null se não houver bloco `--- … ---`. */
export function parseFrontmatter(raw: string): Frontmatter | null {
  const m = FRONTMATTER_RE.exec(raw);
  if (!m) return null;

  const inner = m[3];
  const eol: "\r\n" | "\n" = m[4].startsWith("\r\n") ? "\r\n" : "\n";
  const map: Record<string, string> = {};
  const order: string[] = [];

  for (const line of inner.split(/\r?\n/)) {
    const kv = /^\s*([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1];
    if (!(key in map)) order.push(key);
    map[key] = kv[2].trim();
  }

  return { map, order, inner, eol, bodyIndex: m[0].length };
}

export type HeaderStatus =
  | "ok" // tem todos os campos exigidos, incl. origem
  | "missing-origem" // tem frontmatter, mas falta origem
  | "incomplete" // tem frontmatter, mas falta outro campo exigido
  | "no-frontmatter"; // não há bloco --- no topo

/** Situação do cabeçalho de uma nota. */
export function headerStatus(raw: string): HeaderStatus {
  const fm = parseFrontmatter(raw);
  if (!fm) return "no-frontmatter";
  if (!fm.map.origem) return "missing-origem";
  const missing = REQUIRED_KEYS.some((k) => !fm.map[k]);
  return missing ? "incomplete" : "ok";
}

/**
 * Detecta a origem pelo formato do arquivo.
 * Hoje só CLAUDEWEB é conhecido (frontmatter estilo export + turnos
 * "## 👤 You" / "## 🤖 Claude"). As demais retornam null até termos um
 * exemplo real de cada uma para definir a regra.
 */
export function detectOrigem(raw: string): Origem | null {
  const fm = parseFrontmatter(raw);
  if (fm && /^##\s+(?:👤 You|🤖 Claude)\b/m.test(raw)) return "CLAUDEWEB";
  return null;
}

/**
 * Insere `origem: <valor>` no frontmatter existente, logo após `title:`
 * (ou no topo do bloco, se não houver title). Idempotente e não destrutivo:
 * preserva as demais linhas, o BOM e a quebra de linha originais.
 * Porta TS do script 2608_CRIAR_CABECALHO_PADRAO.
 *
 * Não cria frontmatter do zero: se não houver bloco, devolve o conteúdo
 * inalterado (a extração de título/id/datas de formatos crus é papel das
 * regras por origem, ainda a definir).
 */
export function ensureOrigem(
  raw: string,
  origem: Origem
): { content: string; changed: boolean } {
  const m = FRONTMATTER_RE.exec(raw);
  if (!m) return { content: raw, changed: false };

  const bom = m[1];
  const open = m[2];
  const inner = m[3];
  const close = m[4];
  const eol: "\r\n" | "\n" = close.startsWith("\r\n") ? "\r\n" : "\n";

  const lines = inner.split(/\r?\n/);
  if (lines.some((l) => /^\s*origem\s*:/i.test(l))) {
    return { content: raw, changed: false };
  }

  const out: string[] = [];
  let inserted = false;
  for (const line of lines) {
    out.push(line);
    if (!inserted && /^\s*title\s*:/i.test(line)) {
      out.push(`origem: ${origem}`);
      inserted = true;
    }
  }
  if (!inserted) out.unshift(`origem: ${origem}`);

  const rebuilt = bom + open + out.join(eol) + close + raw.slice(m[0].length);
  return { content: rebuilt, changed: true };
}

export type HeaderPlan = {
  /** já têm origem + campos exigidos */
  ready: Note[];
  /** falta origem, mas a origem foi detectada → prontas para carimbar */
  toStamp: { note: Note; origem: Origem }[];
  /** falta origem e não deu para detectar → precisam de regra por origem */
  unknown: Note[];
  /** sem frontmatter nenhum → precisam de extração completa */
  noFrontmatter: Note[];
};

/** Plano da ação "inserir cabeçalho padrão" (métrica A do modal). */
export function planHeaderStamp(notes: Note[]): HeaderPlan {
  const plan: HeaderPlan = {
    ready: [],
    toStamp: [],
    unknown: [],
    noFrontmatter: [],
  };
  for (const note of notes) {
    const status = headerStatus(note.content);
    if (status === "ok") {
      plan.ready.push(note);
    } else if (status === "no-frontmatter") {
      plan.noFrontmatter.push(note);
    } else {
      const origem = detectOrigem(note.content);
      if (origem) plan.toStamp.push({ note, origem });
      else plan.unknown.push(note);
    }
  }
  return plan;
}
