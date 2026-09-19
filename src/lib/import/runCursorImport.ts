/**
 * Importar Cursor — orquestrador de I/O (Tauri, desktop apenas).
 * scan (Rust, 1 IPC) → reconcile com o cofre (uuid + updated) → import dos
 * itens escolhidos: lê o .jsonl, converte (cursorImport.ts) e grava o .md.
 */
import { invoke } from "@tauri-apps/api/core";
import { homeDir, join } from "@tauri-apps/api/path";
import { mkdir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { scanExistingNotes, type ImportProgress } from "./runImport";
import { chooseTargetName } from "./claudeImport";
import {
  cursorToMarkdown,
  deriveTitle,
  parseCursorTimestamp,
  parseCursorTranscript,
} from "./cursorImport";
import { prepareCortesias, removeCortesias } from "./cortesias";
import { DEFAULT_CORTESIAS } from "./cortesias.rules";

/** Espelho do struct `CursorTranscript` (src-tauri/src/cursor.rs). */
export type CursorTranscript = {
  path: string;
  project: string;
  uuid: string;
  sizeBytes: number;
  mtimeMs: number;
  ctimeMs: number | null;
  userTurns: number;
  firstUserQuery: string;
  firstTimestampRaw: string;
};

export type CursorStatus =
  | "new" // não existe no cofre
  | "changed" // existe, mas o .jsonl mudou desde a última importação
  | "unchanged" // existe e está em dia
  | "empty"; // transcript sem nenhuma pergunta real (só contexto injetado)

export type CursorItem = CursorTranscript & {
  title: string;
  status: CursorStatus;
  /** `updated:` que a nota vai receber — chave do anti-duplicata */
  updatedIso: string;
  /** ms da 1ª pergunta (ou ctime/mtime) — para ordenar/exibir */
  createdMs: number;
};

export type CursorImportResult = {
  selected: number;
  written: number;
  updated: number;
  unchanged: number;
  empty: number;
  failed: number;
};

/** `~/.cursor/projects` — onde o Cursor guarda os transcripts por projeto. */
export async function cursorProjectsRoot(): Promise<string> {
  return join(await homeDir(), ".cursor", "projects");
}

export async function listCursorTranscripts(): Promise<{
  items: CursorTranscript[];
  errors: string[];
}> {
  const root = await cursorProjectsRoot();
  return invoke<{ items: CursorTranscript[]; errors: string[] }>(
    "scan_cursor_transcripts",
    { root }
  );
}

function createdMsOf(t: CursorTranscript): number {
  const iso = parseCursorTimestamp(t.firstTimestampRaw);
  const ms = iso ? Date.parse(iso) : NaN;
  if (!Number.isNaN(ms)) return ms;
  return t.ctimeMs ?? t.mtimeMs;
}

/**
 * Classifica cada transcript contra as notas já gravadas em `outDir`.
 * Mesma regra do fluxo Claude: uuid igual + `updated` igual → em dia.
 */
export async function reconcileCursor(
  items: CursorTranscript[],
  outDir: string,
  onProgress?: (p: ImportProgress) => void
): Promise<CursorItem[]> {
  const { byUuid } = await scanExistingNotes(outDir, onProgress);
  const out: CursorItem[] = items.map((t) => {
    const updatedIso = new Date(t.mtimeMs).toISOString();
    const existing = byUuid.get(t.uuid);
    let status: CursorStatus;
    if (!t.firstUserQuery) status = "empty";
    else if (!existing) status = "new";
    else if (existing.updated === updatedIso) status = "unchanged";
    else status = "changed";
    return {
      ...t,
      title: deriveTitle(t.firstUserQuery),
      status,
      updatedIso,
      createdMs: createdMsOf(t),
    };
  });
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out;
}

export async function importCursorTranscripts(
  items: CursorItem[],
  outDir: string,
  onProgress?: (p: ImportProgress) => void
): Promise<CursorImportResult> {
  await mkdir(outDir, { recursive: true });

  // Reconfere o cofre na hora de gravar: a seleção pode ter ficado aberta
  // enquanto outra importação rodava.
  const { byUuid, names } = await scanExistingNotes(outDir, onProgress);
  const cort = prepareCortesias(DEFAULT_CORTESIAS);

  const r: CursorImportResult = {
    selected: items.length,
    written: 0,
    updated: 0,
    unchanged: 0,
    empty: 0,
    failed: 0,
  };

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    onProgress?.({
      phase: `Convertendo ${i + 1}/${items.length}: ${it.title}`,
      done: i,
      total: items.length,
    });

    try {
      const raw = await readTextFile(it.path);
      const parsed = parseCursorTranscript(raw);
      const note = cursorToMarkdown(
        {
          uuid: it.uuid,
          project: it.project,
          mtimeMs: it.mtimeMs,
          ctimeMs: it.ctimeMs,
        },
        parsed
      );
      if (!note) {
        r.empty++;
        continue;
      }

      const target = chooseTargetName(note, it.uuid, byUuid, names);
      if (target.existed && byUuid.get(it.uuid)?.updated === it.updatedIso) {
        r.unchanged++;
        continue;
      }

      const cleaned = removeCortesias(note.content, cort);
      await writeTextFile(await join(outDir, target.name), cleaned);
      if (target.existed) r.updated++;
      else r.written++;
      names.add(target.name);
      byUuid.set(it.uuid, { name: target.name, updated: it.updatedIso });
    } catch (e) {
      console.error("[import-cursor] falha em", it.path, e);
      r.failed++;
    }
  }

  onProgress?.({ phase: "Concluído", done: items.length, total: items.length });
  return r;
}
