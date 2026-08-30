import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { readDir, readTextFile, stat } from "@tauri-apps/plugin-fs";
import type { Note } from "./fileSystem";
import { parseCreatedAt } from "./noteDates";

export type TauriDirHandle = { kind: "tauri"; path: string };

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function pickVaultDirectoryTauri(): Promise<TauriDirHandle> {
  console.log("[cofre] abrindo dialog...");
  const selected = await open({ directory: true, multiple: false });
  console.log("[cofre] dialog retornou:", selected);
  if (!selected || typeof selected !== "string") {
    const err = new Error("Dialog cancelado (retornou null/undefined)");
    err.name = "AbortError";
    throw err;
  }
  return { kind: "tauri", path: selected };
}

type RawVaultNote = {
  path: string;
  name: string;
  content: string;
  mtimeMs: number;
};
type RawVaultResult = { notes: RawVaultNote[]; errors: string[] };

export async function readVaultTauri(
  handle: TauriDirHandle
): Promise<Note[]> {
  const t0 = performance.now();
  let notes: Note[] | null = null;
  try {
    // Caminho rápido: comando Rust varre tudo em 1 round-trip IPC.
    notes = await readVaultFast(handle.path);
  } catch (e) {
    // Exe antigo sem o comando, ou falha inesperada — caminho legado (2 IPC/nota).
    console.warn("[cofre] read_vault (Rust) indisponivel, usando fallback:", e);
  }
  if (!notes) {
    notes = [];
    await walk(handle.path, "", notes);
  }
  // Log único de medição da abertura do cofre.
  console.log(
    `[cofre] readVault: ${Math.round(performance.now() - t0)}ms / ${notes.length} notas (${handle.path})`
  );
  return notes;
}

async function readVaultFast(root: string): Promise<Note[]> {
  const r = await invoke<RawVaultResult>("read_vault", { root });
  for (const err of r.errors) console.error("[cofre] read_vault:", err);
  return r.notes.map((n) => ({
    path: n.path,
    name: n.name,
    content: n.content,
    lastModified: n.mtimeMs,
    createdAt: parseCreatedAt(n.content, n.name, n.mtimeMs),
  }));
}

async function walk(
  absDir: string,
  relPrefix: string,
  out: Note[]
): Promise<void> {
  let entries: Awaited<ReturnType<typeof readDir>>;
  try {
    entries = await readDir(absDir);
  } catch (e) {
    console.error(`[cofre] FALHA readDir(${absDir}):`, e);
    throw new Error(
      `Falha ao ler diretorio "${absDir}": ${(e as Error).message ?? e}`
    );
  }

  for (const entry of entries) {
    const absChild = joinPath(absDir, entry.name);
    const relChild = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;

    if (entry.isDirectory) {
      await walk(absChild, relChild, out);
      continue;
    }
    if (entry.isFile && entry.name.toLowerCase().endsWith(".md")) {
      try {
        const [content, meta] = await Promise.all([
          readTextFile(absChild),
          stat(absChild),
        ]);
        const mtime = meta.mtime ? new Date(meta.mtime).getTime() : Date.now();
        const name = entry.name.replace(/\.md$/i, "");
        out.push({
          path: relChild,
          name,
          content,
          lastModified: mtime,
          createdAt: parseCreatedAt(content, name, mtime),
        });
      } catch (e) {
        console.error(`[cofre] FALHA lendo ${absChild}:`, e);
      }
    }
  }
}

function joinPath(dir: string, name: string): string {
  const sep = dir.includes("\\") ? "\\" : "/";
  return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`;
}
