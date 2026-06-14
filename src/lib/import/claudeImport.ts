/**
 * Importar Claude — Etapa 1 (porta TS de _Core.ps1 / Invoke-Conversor).
 * Funções PURAS: dado o JSON do export, produz notas .md limpas (sem "thinking").
 * Sem I/O aqui — facilita teste. O I/O fica em runImport.ts.
 */

export type ClaudeContentBlock = { type?: string; text?: string };
export type ClaudeMessage = {
  sender?: string;
  text?: string;
  content?: ClaudeContentBlock[];
  created_at?: string;
};
export type ClaudeConversation = {
  uuid?: string;
  name?: string;
  created_at?: string;
  updated_at?: string;
  chat_messages?: ClaudeMessage[];
};

/** Junta apenas os blocos de texto da mensagem (descarta thinking/tool-calls). */
export function extractMessageText(m: ClaudeMessage): string {
  const cont = m.content;
  if (Array.isArray(cont) && cont.length >= 1) {
    const parts: string[] = [];
    for (const b of cont) {
      if (String(b?.type) === "text" && String(b?.text ?? "").length > 0) {
        parts.push(String(b.text));
      }
    }
    return parts.join("\n\n").trim();
  }
  return String(m.text ?? "").trim();
}

/** Aceita array de conversas ou objeto único. */
export function parseConversations(jsonText: string): ClaudeConversation[] {
  const d = JSON.parse(jsonText);
  return Array.isArray(d) ? d : [d];
}

/** Deduplica por uuid mantendo a conversa de updated_at mais recente. */
export function dedupeByUuid(convs: ClaudeConversation[]): ClaudeConversation[] {
  const best = new Map<string, ClaudeConversation>();
  for (const c of convs) {
    const u = String(c?.uuid ?? "") || cryptoRandom();
    const cur = best.get(u);
    if (!cur || String(c?.updated_at ?? "") > String(cur?.updated_at ?? "")) {
      best.set(u, c);
    }
  }
  return [...best.values()];
}

function cryptoRandom(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return "id-" + Date.now().toString(36);
  }
}

/**
 * Slug do título: troca caracteres inválidos de nome de arquivo por espaço,
 * mantém só letras/dígitos/espaço/hífen (Unicode), espaços→'-', colapsa, máx 55.
 */
function slugify(title: string): string {
  let sl = title
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  if (sl.length > 55) sl = sl.slice(0, 55).replace(/-+$/g, "");
  return sl;
}

/** Prefixo de data yyyy-MM-dd a partir do created_at ISO (estável, sem timezone). */
function datePrefix(createdAt?: string): string {
  const m = String(createdAt ?? "").match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : "0000-00-00";
}

export type ImportedNote = {
  /** nome preferido: {data}-{slug}.md */
  baseName: string;
  /** alternativo em colisão: {data}-{slug}-{uuid8}.md */
  uuidName: string;
  content: string;
};

/** Converte uma conversa em nota .md (frontmatter + turnos). null se ficar vazia. */
export function conversationToMarkdown(c: ClaudeConversation): ImportedNote | null {
  const lines: string[] = [];
  for (const m of c.chat_messages ?? []) {
    const txt = extractMessageText(m);
    if (!txt) continue;
    const snd = String(m.sender ?? "").toLowerCase();
    const who = snd === "human" || snd === "user" ? "👤 You" : "🤖 Claude";
    let ts = String(m.created_at ?? "");
    if (ts.length >= 16) ts = ts.slice(0, 16).replace("T", " ");
    lines.push(`## ${who} *(${ts})*`, "", txt, "");
  }
  if (lines.length === 0) return null;

  const titulo = String(c.name ?? "") || "sem-titulo";
  const frontmatter = [
    "---",
    `title: "${titulo.replace(/"/g, "")}"`,
    `uuid: ${String(c.uuid ?? "")}`,
    `created: ${String(c.created_at ?? "")}`,
    `updated: ${String(c.updated_at ?? "")}`,
    "---",
  ].join("\n");

  const pref = datePrefix(c.created_at);
  const slug = slugify(titulo) || "sem-titulo";
  const uuid = String(c.uuid ?? "");
  const uuid8 = uuid.slice(0, Math.min(8, uuid.length)) || "xxxxxxxx";

  return {
    baseName: `${pref}-${slug}.md`,
    uuidName: `${pref}-${slug}-${uuid8}.md`,
    content: frontmatter + "\n\n" + lines.join("\n"),
  };
}
