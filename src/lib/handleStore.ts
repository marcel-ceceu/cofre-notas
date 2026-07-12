import type { VaultHandle } from "./fileSystem";
import { isTauriRuntime } from "./fileSystem.tauri";

const DB_NAME = "cofre-notas";
const STORE = "kv";
const KEY = "lastVaultHandle";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveLastVaultHandle(
  handle: VaultHandle
): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(handle, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadLastVaultHandle(): Promise<VaultHandle | null> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(KEY);
    req.onsuccess = () =>
      resolve((req.result as VaultHandle | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function clearLastVaultHandle(): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

type Perm = "granted" | "denied" | "prompt";

export async function verifyReadPermission(
  handle: VaultHandle,
  requestIfNeeded = false
): Promise<boolean> {
  // Tauri: acesso permanente, sem prompt de permissão.
  if (isTauriRuntime()) return true;
  // Vault web (IndexedDB): sempre acessível, não há permissão de disco.
  if ((handle as { kind?: string }).kind === "webdb") return true;

  const h = handle as unknown as {
    queryPermission?: (o: { mode: "read" | "readwrite" }) => Promise<Perm>;
    requestPermission?: (o: { mode: "read" | "readwrite" }) => Promise<Perm>;
  };
  if (!h.queryPermission || !h.requestPermission) return false;
  const opts = { mode: "read" as const };
  if ((await h.queryPermission(opts)) === "granted") return true;
  if (!requestIfNeeded) return false;
  return (await h.requestPermission(opts)) === "granted";
}
