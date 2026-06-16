import {
  isTauriRuntime,
  pickVaultDirectoryTauri,
  readVaultTauri,
  type TauriDirHandle,
} from "./fileSystem.tauri";
import { parseCreatedAt } from "./noteDates";

export type Note = {
  path: string;
  name: string;
  content: string;
  /** Data de IMPORTAÇÃO (mtime do .md). */
  lastModified: number;
  /** Data ORIGINAL da conversa (frontmatter `created:` ou data do nome). */
  createdAt: number;
};

/** Handle opaco — varia conforme o runtime (web: FileSystemDirectoryHandle; Tauri: { path }). */
export type VaultHandle = FileSystemDirectoryHandle | TauriDirHandle;

declare global {
  interface Window {
    showDirectoryPicker: (options?: {
      mode?: "read" | "readwrite";
    }) => Promise<FileSystemDirectoryHandle>;
  }

  interface FileSystemDirectoryHandle {
    values: () => AsyncIterableIterator<
      FileSystemDirectoryHandle | FileSystemFileHandle
    >;
  }
}

export function isWebFileSystemSupported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

export async function pickVaultDirectory(): Promise<VaultHandle> {
  if (isTauriRuntime()) return pickVaultDirectoryTauri();
  if (!isWebFileSystemSupported()) {
    throw new Error(
      "Ambiente sem suporte a leitura de pastas. Use Chrome/Edge ou rode no app desktop."
    );
  }
  return window.showDirectoryPicker({ mode: "read" });
}

export async function readVault(handle: VaultHandle): Promise<Note[]> {
  if (isTauriRuntime() && (handle as TauriDirHandle).kind === "tauri") {
    return readVaultTauri(handle as TauriDirHandle);
  }
  const notes: Note[] = [];
  await walkWeb(handle as FileSystemDirectoryHandle, "", notes);
  return notes;
}

async function walkWeb(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  out: Note[]
): Promise<void> {
  for await (const entry of dir.values()) {
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.kind === "directory") {
      await walkWeb(entry as FileSystemDirectoryHandle, relPath, out);
      continue;
    }

    if (entry.kind === "file" && entry.name.toLowerCase().endsWith(".md")) {
      const fileHandle = entry as FileSystemFileHandle;
      const file = await fileHandle.getFile();
      const content = await file.text();
      const name = entry.name.replace(/\.md$/i, "");
      out.push({
        path: relPath,
        name,
        content,
        lastModified: file.lastModified,
        createdAt: parseCreatedAt(content, name, file.lastModified),
      });
    }
  }
}
