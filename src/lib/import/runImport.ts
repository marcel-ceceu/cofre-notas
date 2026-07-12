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
  parseNoteMeta,
  chooseTargetName,
  type ClaudeConversation,
} from "./claudeImport";
import { removeCortesias, prepareCortesias } from "./cortesias";
import { DEFAULT_CORTESIAS } from "./cortesias.rules";

export type ImportProgress = { phase: string; done: number; total: number };
export type ImportResult = {
  read: number;
  unique: number;
  /** notas NOVAS gravadas */
  written: number;
  /** notas existentes regravadas (mesma conversa, versão mais nova) */
  updated: number;
  /** notas puladas: a mesma versão já estava gravada */
  unchanged: number;
  empty: number;
};

/**
 * Indexa as notas já existentes na pasta de saída pelo `uuid:` do frontmatter.
 * É a base do anti-duplicata entre importações: mesmo que o título ou a data
 * da conversa mudem entre exports, o uuid não muda.
 * Havendo mais de um arquivo com o mesmo uuid (duplicatas antigas), fica o de
 * `updated` mais recente como alvo.
 */
async function scanExistingNotes(
  outDir: string,
  onProgress?: (p: ImportProgress) => void
): Promise<{
  byUuid: Map<string, { name: string; updated: string }>;
  names: Set<string>;
}> {
  const byUuid = new Map<string, { name: string; updated: string }>();
  const names = new Set<string>();
  let entries: Awaited<ReturnType<typeof readDir>>;
  try {
    entries = await readDir(outDir);
  } catch {
    return { byUuid, names }; // pasta ainda não existe
  }
  const mds = entries.filter((e) => e.isFile && /\.md$/i.test(e.name));
  for (let i = 0; i < mds.length; i++) {
    if (i % 100 === 0) {
      onProgress?.({
        phase: "Conferindo notas existentes (anti-duplicata)",
        done: i,
        total: mds.length,
      });
    }
    const name = mds[i].name;
    names.add(name);
    try {
      const raw = await readTextFile(await join(outDir, name));
      const meta = parseNoteMeta(raw);
      if (!meta) continue;
      const cur = byUuid.get(meta.uuid);
      if (!cur || meta.updated > cur.updated) {
        byUuid.set(meta.uuid, { name, updated: meta.updated });
      }
    } catch {
      /* ilegível — ignora */
    }
  }
  return { byUuid, names };
}

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

  // Anti-duplicata ENTRE importações: indexa o que já existe por uuid.
  const { byUuid, names } = await scanExistingNotes(outDir, onProgress);

  // Fluxo oficial: grava SOMENTE a versão sem cortesias.
  const cort = prepareCortesias(DEFAULT_CORTESIAS);

  let written = 0;
  let updated = 0;
  let unchanged = 0;
  let empty = 0;

  for (let i = 0; i < unique.length; i++) {
    if (i % 25 === 0) {
      onProgress?.({ phase: "Gravando notas .md (sem cortesias)", done: i, total: unique.length });
    }
    const conv = unique[i];
    const note = conversationToMarkdown(conv);
    if (!note) {
      empty++;
      continue;
    }

    const uuid = String(conv.uuid ?? "");
    const convUpdated = String(conv.updated_at ?? "");
    const target = chooseTargetName(note, uuid, byUuid, names);

    // Mesma conversa, mesma versão → nada a fazer (preserva mtime/ordem de importação).
    if (target.existed && convUpdated && byUuid.get(uuid)?.updated === convUpdated) {
      unchanged++;
      continue;
    }

    const cleaned = removeCortesias(note.content, cort);
    try {
      await writeTextFile(await join(outDir, target.name), cleaned);
      if (target.existed) updated++;
      else written++;
      names.add(target.name);
      if (uuid) byUuid.set(uuid, { name: target.name, updated: convUpdated });
    } catch (e) {
      console.error("[import] falha ao gravar", target.name, e);
    }
  }

  onProgress?.({ phase: "Concluído", done: unique.length, total: unique.length });
  return { read, unique: unique.length, written, updated, unchanged, empty };
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
