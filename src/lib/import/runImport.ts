/**
 * Importar Claude — orquestrador de I/O (Tauri).
 * Lê os ZIPs aos pedaços (exportStream.ts), deduplica e grava os .md na pasta de saída.
 */
import {
  open,
  SeekMode,
  readTextFile,
  writeTextFile,
  mkdir,
  readDir,
  stat,
} from "@tauri-apps/plugin-fs";
import { join, downloadDir } from "@tauri-apps/api/path";
import { parseNoteMeta, chooseTargetName } from "./claudeImport";
import {
  collectConversations,
  isCompatibleExport,
  CHUNK_BYTES,
  type RandomAccess,
  type ZipSource,
} from "./exportStream";
import { isExportZipName, pickLatestExport } from "./exportFiles";
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
  /** .zip que não puderam ser lidos (inteiros ou a partir de algum ponto) */
  failed: string[];
};

/**
 * Indexa as notas já existentes na pasta de saída pelo `uuid:` do frontmatter.
 * É a base do anti-duplicata entre importações: mesmo que o título ou a data
 * da conversa mudem entre exports, o uuid não muda.
 * Havendo mais de um arquivo com o mesmo uuid (duplicatas antigas), fica o de
 * `updated` mais recente como alvo.
 * Não-recursivo de propósito: cada fluxo (Claude na raiz, Cursor em `Cursor\`)
 * só enxerga a própria pasta. Exportado para runCursorImport.ts.
 */
export async function scanExistingNotes(
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
 * Acha o export mais recente em Downloads e devolve todas as partes dele:
 * formato novo `conversations-000.zip` (+ -001…) ou antigo `data-…-batch-NNNN.zip`.
 * A escolha em si é pura (exportFiles.ts); aqui só a listagem da pasta.
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
  const zips = entries.filter((e) => e.isFile && isExportZipName(e.name));
  if (zips.length === 0) return [];

  const files = await Promise.all(
    zips.map(async (e) => {
      const path = await join(dir, e.name);
      let mtime = 0;
      try {
        const s = await stat(path);
        mtime = s.mtime ? new Date(s.mtime).getTime() : 0;
      } catch {
        /* ignora */
      }
      return { name: e.name, path, mtime };
    })
  );
  return pickLatestExport(files);
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Abre o arquivo e entrega leitura com seek (para o diretório central do ZIP). */
async function withRandomAccess<T>(
  path: string,
  fn: (ra: RandomAccess) => Promise<T>
): Promise<T> {
  const size = (await stat(path)).size;
  const fh = await open(path, { read: true });
  try {
    return await fn({
      size,
      read: async (offset, length) => {
        await fh.seek(offset, SeekMode.Start);
        const out = new Uint8Array(length);
        let got = 0;
        while (got < length) {
          const n = await fh.read(out.subarray(got));
          if (!n) break;
          got += n;
        }
        return out.subarray(0, got);
      },
    });
  } finally {
    await fh.close();
  }
}

/** Leitura sequencial do .zip em pedaços (nunca o arquivo inteiro na memória). */
async function zipSourceFromPath(path: string): Promise<ZipSource> {
  const size = await stat(path).then(
    (s) => s.size,
    () => 0
  );
  return {
    name: fileName(path),
    size,
    chunks: async function* () {
      const fh = await open(path, { read: true });
      try {
        for (;;) {
          const buf = new Uint8Array(CHUNK_BYTES);
          const n = await fh.read(buf);
          if (!n) break;
          yield n === buf.length ? buf : buf.subarray(0, n);
        }
      } finally {
        await fh.close();
      }
    },
  };
}

/**
 * Verifica se um .zip tem a "assinatura" de um export de conversas do Claude
 * (um `conversations.json`) lendo só o diretório central no fim do arquivo —
 * instantâneo mesmo para exports de centenas de MB.
 * Retorna false em qualquer falha (arquivo corrompido, não-zip, sem o JSON).
 */
export async function isCompatibleClaudeZip(path: string): Promise<boolean> {
  try {
    return await withRandomAccess(path, isCompatibleExport);
  } catch {
    return false;
  }
}

export async function importClaudeZips(
  zipPaths: string[],
  outDir: string,
  onProgress?: (p: ImportProgress) => void
): Promise<ImportResult> {
  const sources = await Promise.all(zipPaths.map(zipSourceFromPath));
  const { collector, failed } = await collectConversations(sources, onProgress);
  const unique = collector.unique;
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
    const { uuid, updated: convUpdated, note } = unique[i];
    if (!note) {
      empty++;
      continue;
    }

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
  return {
    read: collector.read,
    unique: unique.length,
    written,
    updated,
    unchanged,
    empty,
    failed,
  };
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
