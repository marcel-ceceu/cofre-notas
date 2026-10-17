/**
 * Manifest JSON que o Claude.ai envia por e-mail (desde ~ago/2026).
 * Lista URLs de download por categoria; o Cofre importa só `conversations`.
 */

export type ClaudeManifestDataFile = {
  batch_index: number;
  export_url: string;
  category: string;
  part: number;
  filename: string;
};

export type ClaudeExportManifest = {
  version: string;
  instructions?: string;
  created_at?: string;
  total_files?: number;
  data_files: ClaudeManifestDataFile[];
};

export function isLikelyClaudeExportManifest(value: unknown): value is ClaudeExportManifest {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  if (!Array.isArray(o.data_files)) return false;
  return o.data_files.every(
    (f) =>
      f &&
      typeof f === "object" &&
      typeof (f as ClaudeManifestDataFile).export_url === "string" &&
      typeof (f as ClaudeManifestDataFile).category === "string"
  );
}

/** Lê o JSON do manifest; falha com mensagem curta se inválido. */
export function parseClaudeExportManifest(raw: string): ClaudeExportManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Arquivo JSON inválido.");
  }
  if (!isLikelyClaudeExportManifest(parsed)) {
    throw new Error(
      "Não parece um manifest de export do Claude (faltam data_files com export_url)."
    );
  }
  return parsed;
}

/** Entradas de conversas, ordenadas por part (000, 001…). */
export function conversationDownloadsFromManifest(
  manifest: ClaudeExportManifest
): ClaudeManifestDataFile[] {
  return manifest.data_files
    .filter((f) => f.category === "conversations")
    .sort((a, b) => a.part - b.part || a.batch_index - b.batch_index);
}

export function isClaudeManifestFileName(name: string): boolean {
  return /^manifest-.*\.json$/i.test(name);
}
