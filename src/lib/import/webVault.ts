/**
 * Vault WEB — fallback universal para navegadores sem File System Access API
 * (Firefox, Safari, celular) e para o PWA instalado.
 * O usuário sobe o .zip do export; as notas são parseadas no navegador
 * (mesmo pipeline puro do desktop: fflate → parser → sem cortesias) e ficam
 * salvas no IndexedDB, offline. Anti-duplicata natural: a chave é o uuid.
 */
import { extractConversationsJson } from "./zip";
import {
  parseConversations,
  dedupeByUuid,
  conversationToMarkdown,
} from "./claudeImport";
import { removeCortesias, prepareCortesias } from "./cortesias";
import { DEFAULT_CORTESIAS } from "./cortesias.rules";
import { parseCreatedAt } from "../noteDates";
import type { Note } from "../fileSystem";
import type { ImportProgress, ImportResult } from "./runImport";

export type WebVaultHandle = { kind: "webdb" };

export function isWebVaultHandle(h: unknown): h is WebVaultHandle {
  return !!h && (h as WebVaultHandle).kind === "webdb";
}

type StoredNote = {
  uuid: string;
  baseName: string;
  uuidName: string;
  content: string;
  updated: string;
  importedAt: number;
};

const DB_NAME = "cofre-notas-webvault";
const STORE = "notes";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: "uuid" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getAll(db: IDBDatabase): Promise<StoredNote[]> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    req.onsuccess = () => resolve((req.result as StoredNote[]) ?? []);
    req.onerror = () => reject(req.error);
  });
}

function putAll(db: IDBDatabase, notes: StoredNote[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    for (const n of notes) store.put(n);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Quantidade de notas salvas neste navegador. */
export async function webVaultCount(): Promise<number> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Carrega as notas do IndexedDB no formato do app (Note[]). */
export async function loadWebVaultNotes(): Promise<Note[]> {
  const db = await openDb();
  const stored = await getAll(db);
  const used = new Set<string>();
  const notes: Note[] = [];
  for (const s of stored) {
    let file = s.baseName;
    if (used.has(file)) file = s.uuidName;
    used.add(file);
    const name = file.replace(/\.md$/i, "");
    notes.push({
      path: file,
      name,
      content: s.content,
      lastModified: s.importedAt,
      createdAt: parseCreatedAt(s.content, name, s.importedAt),
    });
  }
  return notes;
}

/** Mesmo critério do desktop: o zip precisa conter conversations.json. */
export async function isCompatibleClaudeZipFile(f: File): Promise<boolean> {
  try {
    const bytes = new Uint8Array(await f.arrayBuffer());
    return extractConversationsJson(bytes).length > 0;
  } catch {
    return false;
  }
}

/**
 * Importa os .zip no navegador e grava as notas (sem cortesias) no IndexedDB.
 * Anti-duplicata por uuid: regrava a mesma conversa, pula versões já em dia.
 */
export async function importClaudeZipsWeb(
  files: File[],
  onProgress?: (p: ImportProgress) => void
): Promise<ImportResult> {
  const all: ReturnType<typeof parseConversations> = [];
  let read = 0;

  for (let i = 0; i < files.length; i++) {
    onProgress?.({
      phase: `Lendo ZIP ${i + 1}/${files.length}`,
      done: i,
      total: files.length,
    });
    try {
      const bytes = new Uint8Array(await files[i].arrayBuffer());
      for (const j of extractConversationsJson(bytes)) {
        const convs = parseConversations(j);
        all.push(...convs);
        read += convs.length;
      }
    } catch (e) {
      console.error("[import-web] falha ao ler", files[i].name, e);
    }
  }

  const unique = dedupeByUuid(all);
  const cort = prepareCortesias(DEFAULT_CORTESIAS);

  const db = await openDb();
  const existing = await getAll(db);
  const byUuid = new Map(existing.map((s) => [s.uuid, s.updated]));

  const importedAt = Date.now();
  const toPut: StoredNote[] = [];
  let written = 0;
  let updated = 0;
  let unchanged = 0;
  let empty = 0;

  for (let i = 0; i < unique.length; i++) {
    if (i % 50 === 0) {
      onProgress?.({
        phase: "Convertendo notas (sem cortesias)",
        done: i,
        total: unique.length,
      });
    }
    const conv = unique[i];
    const note = conversationToMarkdown(conv);
    if (!note) {
      empty++;
      continue;
    }
    const uuid = String(conv.uuid ?? "");
    const convUpdated = String(conv.updated_at ?? "");
    const existed = byUuid.has(uuid);
    if (existed && convUpdated && byUuid.get(uuid) === convUpdated) {
      unchanged++;
      continue;
    }
    toPut.push({
      uuid,
      baseName: note.baseName,
      uuidName: note.uuidName,
      content: removeCortesias(note.content, cort),
      updated: convUpdated,
      importedAt,
    });
    if (existed) updated++;
    else written++;
  }

  onProgress?.({
    phase: "Salvando no navegador",
    done: unique.length,
    total: unique.length,
  });
  await putAll(db, toPut);

  onProgress?.({ phase: "Concluído", done: unique.length, total: unique.length });
  return { read, unique: unique.length, written, updated, unchanged, empty };
}
