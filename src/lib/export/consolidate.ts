/**
 * Exportar / Consolidar — Fase 3 (porta TS de vaultCopy.ts, parte sem IA).
 * Funções PURAS: montam nomes, limpam markdown e geram o consolidado.
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** Remove lixo de export ("This block is not supported…") e colapsa linhas em branco. */
export function cleanExportMarkdown(text: string): string {
  let s = text.replace(
    /^``` *\r?\nThis block is not supported on your current device yet\.\s*\r?\n``` *\r?\n?/gm,
    ""
  );
  s = s.replace(/^.*This block is not supported.*$\n?/gim, "");
  return s.replace(/(\r\n|\n|\r){3,}/g, "\n\n").trim();
}

/** Título: frontmatter `title:` → primeiro H1 → nome do arquivo humanizado. */
export function extractTitle(content: string, fileName: string): string {
  let title = "";
  if (content.indexOf("---") === 0) {
    const end = content.indexOf("\n---", 3);
    if (end > 0) {
      const m = content.slice(0, end).match(/^title:\s*["']?(.+?)["']?\s*$/m);
      if (m) title = m[1].trim();
    }
  }
  if (!title) {
    const h1 = content.match(/^#\s+(.+)$/m);
    if (h1) title = h1[1].trim();
  }
  if (!title) {
    title = fileName
      .replace(/\.md$/i, "")
      .replace(/^\d{4}-\d{2}-\d{2}[-_ ]*/, "")
      .replace(/[-_]+/g, " ")
      .trim();
  }
  return title || fileName;
}

/** Data yyyy-MM-dd embutida no nome do arquivo, se houver. */
export function fileDate(fileName: string): string {
  const m = fileName.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : "";
}

/** Último segmento do caminho (basename). */
export function baseName(relPath: string): string {
  return String(relPath).replace(/\\/g, "/").split("/").pop() || relPath;
}

/** Subpasta datada para "Copiar arquivos": ddMMyy-HHmm_export. */
export function buildSubfolderName(date = new Date()): string {
  return (
    `${pad(date.getDate())}${pad(date.getMonth() + 1)}${pad(date.getFullYear() % 100)}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}_export`
  );
}

/** Nome do arquivo consolidado: consolidado_ddMMyy-HHmm.md. */
export function consolidadoFileName(date = new Date()): string {
  return (
    `consolidado_${pad(date.getDate())}${pad(date.getMonth() + 1)}` +
    `${String(date.getFullYear() % 100)}-${pad(date.getHours())}${pad(date.getMinutes())}.md`
  );
}

export type MergeConv = {
  fileName: string;
  title: string;
  date: string;
  content: string;
  resumo: string;
  tags: string[];
};

/**
 * Monta o consolidado: seção 1 = índice (data/tags/resumo), seção 2 = transcrições.
 * Sem IA, `resumo` fica vazio e o índice marca "resumo pendente".
 */
export function buildConsolidado(convs: MergeConv[], vaultLabel = "cofre"): string {
  const now = new Date();
  const human =
    `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}`;

  let capa =
    `# Consolidado de conversas — guia para IA\n\n` +
    `> Gerado em ${human} · ${convs.length} conversas · fonte: ${vaultLabel}\n\n` +
    `Esta seção 1 é apenas um índice explicativo, sem transcrições. Para cada conversa há número, data, um resumo (quando gerado com IA) e tags para localizar rapidamente a conversa certa antes de ler a transcrição.\n\n` +
    `A seção 2 (TRANSCRIÇÕES) traz o conteúdo cru de cada conversa, identificado pelo mesmo [conv-NN], em ordem da lista.\n\n` +
    `## Índice das conversas\n`;

  let corpo = `\n---\n# TRANSCRIÇÕES\n`;
  convs.forEach((c, i) => {
    const id = `conv-${pad(i + 1)}`;
    const data = c.date || "s/ data";
    const tagsLn = c.tags?.length ? c.tags.join(", ") : "—";
    const resumo = c.resumo ? c.resumo : "_resumo pendente (gerar com IA)_";
    capa += `\n### [${id}] ${c.title}\n**Data:** ${data} · **Tags:** ${tagsLn}\n\n${resumo}\n`;
    corpo += `\n## [${id}] ${c.title}\n\n${c.content}\n`;
  });

  return capa + "\n" + corpo;
}

export type LlmsRow = {
  fileName: string;
  title: string;
  date: string;
  resumo: string;
  tags: string[];
};

/** Gera o índice llms.txt (1 linha por conversa, com link relativo ao .md). */
export function buildLlmsTxt(rows: LlmsRow[]): string {
  const formatLine = (row: LlmsRow) => {
    const resumo = (row.resumo || "").replace(/\s+/g, " ").replace(/[.\s]+$/, "").trim();
    let line = `- [${row.date} · ${row.title}](${row.fileName})`;
    if (resumo) {
      line += `: ${resumo}.`;
      if (row.tags?.length) line += ` Tags: ${row.tags.join(", ")}.`;
    } else if (row.tags?.length) {
      line += `: Tags: ${row.tags.join(", ")}.`;
    }
    return line;
  };

  return (
    `# Índice de conversas — ${rows.length} itens\n\n` +
    `> Leia este arquivo primeiro. Cada item tem data, resumo e tags; use-os para\n` +
    `> escolher a conversa certa e abrir o .md correspondente nesta mesma pasta.\n` +
    `> As transcrições estão íntegras nos arquivos .md ao lado, sem edição.\n\n` +
    `## Conversas\n` +
    rows.map(formatLine).join("\n") +
    "\n"
  );
}
