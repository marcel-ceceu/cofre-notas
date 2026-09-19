/**
 * Importar Cursor — módulo PURO (sem I/O), irmão de claudeImport.ts.
 * Converte um transcript `.jsonl` do Cursor IDE em nota .md com só o diálogo:
 * pergunta do usuário + texto do assistente. Blocos `tool_use` e o contexto
 * que o Cursor injeta nas mensagens do usuário são descartados.
 *
 * Formato de entrada (uma linha por mensagem):
 *   {"role":"user"|"assistant","message":{"content":[{type:"text"|"tool_use",...}]}}
 *   {"type":"turn_ended","status":"success"|"error"}        ← sem role, ignorada
 * Texto do usuário:
 *   <timestamp>Saturday, Sep 19, 2026, 10:42 AM (UTC-3)</timestamp>
 *   <user_query>…</user_query>
 * Linhas `user` SEM <user_query> são contexto injetado (subagents, tools) → puladas.
 */
import { slugify, datePrefix, type ImportedNote } from "./claudeImport";

export type CursorTurn = {
  role: "user" | "assistant";
  text: string;
  /** ISO com offset local (vem do <timestamp> do usuário); assistente herda o anterior. */
  ts: string | null;
};

export type ParsedTranscript = {
  turns: CursorTurn[];
  /** linhas que não eram JSON válido (arquivo rasgado/corrompido) */
  badLines: number;
  /** primeiro timestamp encontrado — vira o `created:` da nota */
  firstTs: string | null;
};

/** Metadados vindos do scan (Rust): identidade e datas do arquivo. */
export type CursorNoteMeta = {
  uuid: string;
  project: string;
  mtimeMs: number;
  ctimeMs: number | null;
};

const TITLE_MAX = 80;
const PROJECT_MAX = 120;

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/**
 * "Saturday, Sep 19, 2026, 10:42 AM (UTC-3)" → "2026-09-19T10:42:00-03:00".
 * Mantém o offset de origem (não converte para Z) para que a data do nome do
 * arquivo seja a data local em que a conversa aconteceu.
 */
export function parseCursorTimestamp(raw: string): string | null {
  const m = String(raw ?? "")
    .trim()
    .match(
      /^(?:[A-Za-z]+,\s*)?([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{1,2}),\s*(\d{4}),?\s+(\d{1,2}):(\d{2})\s*(AM|PM)?(?:\s*\(UTC([+-])(\d{1,2})(?::?(\d{2}))?\))?$/i
    );
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  if (!month) return null;

  let hour = Number(m[4]);
  const ampm = m[6]?.toUpperCase();
  if (ampm === "AM" && hour === 12) hour = 0;
  else if (ampm === "PM" && hour < 12) hour += 12;
  if (hour > 23 || Number(m[5]) > 59) return null;

  const day = m[2].padStart(2, "0");
  const hh = String(hour).padStart(2, "0");
  const offset = m[7]
    ? `${m[7]}${m[8].padStart(2, "0")}:${(m[9] ?? "00").padStart(2, "0")}`
    : "";
  return `${m[3]}-${month}-${day}T${hh}:${m[5]}:00${offset}`;
}

/** Junta os blocos `text` de uma mensagem (descarta tool_use). */
function textBlocks(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const b of content) {
    const blk = b as { type?: unknown; text?: unknown } | null;
    if (blk && String(blk.type) === "text" && typeof blk.text === "string" && blk.text) {
      parts.push(blk.text);
    }
  }
  return parts.join("\n\n");
}

/**
 * Separa a pergunta real do envelope do Cursor. Retorna null quando a linha
 * `user` não tem <user_query> — é contexto injetado, não fala do usuário.
 */
function extractUserQuery(text: string): { query: string; ts: string | null } | null {
  const q = text.match(/<user_query>([\s\S]*?)<\/user_query>/);
  if (!q) return null;
  const t = text.match(/<timestamp>([^<]*)<\/timestamp>/);
  const query = q[1]
    .replace(/<image_files>[\s\S]*?<\/image_files>/g, "[imagem anexada]")
    .trim();
  return { query, ts: t ? parseCursorTimestamp(t[1]) : null };
}

/** Lê o transcript linha a linha; tolera linhas corrompidas e rasgadas. */
export function parseCursorTranscript(jsonl: string): ParsedTranscript {
  const turns: CursorTurn[] = [];
  let badLines = 0;
  let firstTs: string | null = null;
  let lastTs: string | null = null;

  for (const line of String(jsonl ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    let obj: { role?: unknown; message?: { content?: unknown } } | null;
    try {
      obj = JSON.parse(line);
    } catch {
      badLines++;
      continue;
    }
    const role = obj && typeof obj.role === "string" ? obj.role : "";
    if (role !== "user" && role !== "assistant") continue; // turn_ended etc.

    const text = textBlocks(obj?.message?.content);

    if (role === "user") {
      const u = extractUserQuery(text);
      if (!u || !u.query) continue;
      if (u.ts) {
        lastTs = u.ts;
        if (!firstTs) firstTs = u.ts;
      }
      turns.push({ role: "user", text: u.query, ts: lastTs });
      continue;
    }

    const body = text.trim();
    if (!body) continue; // só tool_use
    const prev = turns[turns.length - 1];
    if (prev && prev.role === "assistant") {
      // Um turno do assistente se espalha por várias linhas (uma por passo).
      turns[turns.length - 1] = { ...prev, text: `${prev.text}\n\n${body}` };
    } else {
      turns.push({ role: "assistant", text: body, ts: lastTs });
    }
  }

  return { turns, badLines, firstTs };
}

/**
 * Título a partir da primeira pergunta: 1ª linha útil, sem menções `@caminho`
 * nem marcação markdown, cortado em ~80 chars na fronteira de palavra.
 */
export function deriveTitle(firstQuery: string): string {
  const line =
    String(firstQuery ?? "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? "";
  let t = line
    .replace(/@\S+/g, " ")
    .replace(/[#*`_>~]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length > TITLE_MAX) {
    const cut = t.lastIndexOf(" ", TITLE_MAX);
    t = t.slice(0, cut > TITLE_MAX / 2 ? cut : TITLE_MAX).trim();
  }
  return t || "sem-titulo";
}

function isoFromMs(ms: number): string {
  return new Date(ms).toISOString();
}

function headerTs(ts: string | null): string {
  return ts ? ts.slice(0, 16).replace("T", " ") : "";
}

/** Converte um transcript parseado em nota .md. null se não houver diálogo. */
export function cursorToMarkdown(
  meta: CursorNoteMeta,
  parsed: ParsedTranscript
): ImportedNote | null {
  if (parsed.turns.length === 0) return null;

  const lines: string[] = [];
  for (const t of parsed.turns) {
    const who = t.role === "user" ? "👤 You" : "🤖 Cursor";
    lines.push(`## ${who} *(${headerTs(t.ts)})*`, "", t.text, "");
  }

  const firstUser = parsed.turns.find((t) => t.role === "user")?.text ?? "";
  const titulo = deriveTitle(firstUser).replace(/"/g, "");
  const created = parsed.firstTs ?? isoFromMs(meta.ctimeMs ?? meta.mtimeMs);
  const updated = isoFromMs(meta.mtimeMs);

  // `projeto` por último: parseNoteMeta lê só os 600 primeiros chars do
  // arquivo e precisa alcançar uuid/updated mesmo com nomes de projeto longos.
  const frontmatter = [
    "---",
    `title: "${titulo}"`,
    "origem: CURSOR",
    `uuid: ${meta.uuid}`,
    `created: ${created}`,
    `updated: ${updated}`,
    `projeto: ${String(meta.project ?? "").slice(0, PROJECT_MAX)}`,
    "---",
  ].join("\n");

  const pref = datePrefix(created);
  const slug = slugify(titulo) || "sem-titulo";
  const uuid8 = meta.uuid.slice(0, Math.min(8, meta.uuid.length)) || "xxxxxxxx";

  return {
    baseName: `${pref}-${slug}.md`,
    uuidName: `${pref}-${slug}-${uuid8}.md`,
    content: frontmatter + "\n\n" + lines.join("\n"),
  };
}
