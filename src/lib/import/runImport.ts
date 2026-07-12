/**
 * Importar Claude — orquestrador de I/O (Tauri).
 * Lê os ZIPs, descompacta, parseia, deduplica e grava os .md na pasta de saída.
 */
import {
  readFile,
  readTextFile,
  writeTextFile,
  mkdir,
  readDir,
  stat,
} from "@tauri-apps/plugin-fs";
import { join, downloadDir } from "@tauri-apps/api/path";
import { extractConversationsJson } from "./zip";
import {
  parseConversations,
  dedupeByUuid,
  conversationToMarkdown,
  type ClaudeConversation,
} from "./claudeImport";
import { removeCortesias, prepareCortesias } from "./cortesias";
import { DEFAULT_CORTESIAS } from "./cortesias.rules";

export type ImportProgress = { phase: string; done: number; total: number };
export type ImportResult = {
  read: number;
  unique: number;
  written: number;
  empty: number;
};

/**
 * Acha o export mais recente em Downloads (data-*.zip) e inclui todos os
 * batches do mesmo export (data-...-batch-0000.zip, -0001, ...).
 */
export async function findLatestExportZips(): Promise<string[]> {
  let dir: string;
  try {
    dir = await downloadDir();
  } catch {
    return [];
  }
  let entries: Awaited<ReturnType<typeof readDir>>;
  try {
    entries = await readDir(dir);
  } catch {
    return [];
  }
  const zips = entries.filter(
    (e) => e.isFile && /^data-.*\.zip$/i.test(e.name)
  );
  if (zips.length === 0) return [];

  const withTime = await Promise.all(
    zips.map(async (e) => {
      const full = await join(dir, e.name);
      let m = 0;
      try {
        const s = await stat(full);
        m = s.mtime ? new Date(s.mtime).getTime() : 0;
      } catch {
        /* ignora */
      }
      return { name: e.name, full, m };
    })
  );
  withTime.sort((a, b) => b.m - a.m);
  const newest = withTime[0];
  const prefix = newest.name.replace(/batch-\d+\.zip$/i, "");
  const group = withTime
    .filter((z) => z.name.startsWith(prefix))
    .map((z) => z.full);
  return group.length ? group : [newest.full];
}

/**
 * Verifica se um .zip tem a "assinatura" de um export de conversas do Claude:
 * descompacta em memória e confere se contém ao menos um `conversations.json`.
 * Retorna false em qualquer falha (arquivo corrompido, não-zip, sem o JSON).
 */
export async function isCompatibleClaudeZip(path: string): Promise<boolean> {
  try {
    const bytes = await readFile(path);
    return extractConversationsJson(bytes).length > 0;
  } catch {
    return false;
  }
}

export async function importClaudeZips(
  zipPaths: string[],
  outDir: string,
  onProgress?: (p: ImportProgress) => void
): Promise<ImportResult> {
  const all: ClaudeConversation[] = [];
  let read = 0;

  for (let zi = 0; zi < zipPaths.length; zi++) {
    onProgress?.({
      phase: `Lendo ZIP ${zi + 1}/${zipPaths.length}`,
      done: zi,
      total: zipPaths.length,
    });
    const bytes = await readFile(zipPaths[zi]);
    let jsons: string[] = [];
    try {
      jsons = extractConversationsJson(bytes);
    } catch (e) {
      console.error("[import] falha ao descompactar", zipPaths[zi], e);
    }
    for (const j of jsons) {
      try {
        const convs = parseConversations(j);
        all.push(...convs);
        read += convs.length;
      } catch (e) {
        console.error("[import] falha ao parsear conversations.json", e);
      }
    }
  }

  const unique = dedupeByUuid(all);
  await mkdir(outDir, { recursive: true });

  // Fluxo oficial: grava SOMENTE a versão sem cortesias.
  const cort = prepareCortesias(DEFAULT_CORTESIAS);

  const used = new Set<string>();
  let written = 0;
  let empty = 0;

  for (let i = 0; i < unique.length; i++) {
    if (i % 25 === 0) {
      onProgress?.({ phase: "Gravando notas .md (sem cortesias)", done: i, total: unique.length });
    }
    const note = conversationToMarkdown(unique[i]);
    if (!note) {
      empty++;
      continue;
    }
    const cleaned = removeCortesias(note.content, cort);
    let name = note.baseName;
    if (used.has(name)) name = note.uuidName;
    used.add(name);
    try {
      await writeTextFile(await join(outDir, name), cleaned);
      written++;
    } catch (e) {
      console.error("[import] falha ao gravar", name, e);
    }
  }

  onProgress?.({ phase: "Concluído", done: unique.length, total: unique.length });
  return { read, unique: unique.length, written, empty };
}

export type CortesiasResult = {
  total: number;
  processed: number;
  skipped: number;
};

/**
 * Etapa 2 — lê os .md de `srcDir`, remove cortesias e grava em `destDir`.
 * Incremental: pula arquivos cujo destino já está atualizado (salvo `force`).
 */
export async function runCortesias(
  srcDir: string,
  destDir: string,
  onProgress?: (p: ImportProgress) => void,
  force = false
): Promise<CortesiasResult> {
  const cort = prepareCortesias(DEFAULT_CORTESIAS);
  await mkdir(destDir, { recursive: true });

  const entries = await readDir(srcDir);
  const mds = entries.filter((e) => e.isFile && /\.md$/i.test(e.name));
  let processed = 0;
  let skipped = 0;

  for (let i = 0; i < mds.length; i++) {
    if (i % 25 === 0) {
      onProgress?.({ phase: "Removendo cortesias", done: i, total: mds.length });
    }
    const name = mds[i].name;
    const srcPath = await join(srcDir, name);
    const destPath = await join(destDir, name);

    if (!force) {
      try {
        const ss = await stat(srcPath);
        const ds = await stat(destPath); // lança se destino não existe
        const sm = ss.mtime ? new Date(ss.mtime).getTime() : 0;
        const dm = ds.mtime ? new Date(ds.mtime).getTime() : 0;
        if (dm >= sm) {
          skipped++;
          continue;
        }
      } catch {
        /* destino não existe → processa */
      }
    }

    try {
      const raw = await readTextFile(srcPath);
      await writeTextFile(destPath, removeCortesias(raw, cort));
      processed++;
    } catch (e) {
      console.error("[cortesias] falha", name, e);
    }
  }

  onProgress?.({ phase: "Concluído", done: mds.length, total: mds.length });
  return { total: mds.length, processed, skipped };
}
