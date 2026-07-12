import { useEffect, useState } from "react";
import { useVaultStore } from "./store/vaultStore";
import {
  pickVaultDirectory,
  readVault,
  type VaultHandle,
} from "./lib/fileSystem";
import {
  loadLastVaultHandle,
  saveLastVaultHandle,
  verifyReadPermission,
} from "./lib/handleStore";
import { filterNotes } from "./lib/search";
import { NoteList } from "./components/NoteList";
import { NoteViewer } from "./components/NoteViewer";
import { SortControl } from "./components/SortControl";
import { SearchBox } from "./components/SearchBox";
import { UpdateBanner } from "./components/UpdateBanner";
import { ImportClaudeModal } from "./components/ImportClaudeModal";
import { useSidebarWidth } from "./lib/useSidebarWidth";

export default function App() {
  const notes = useVaultStore((s) => s.notes);
  const loading = useVaultStore((s) => s.loading);
  const error = useVaultStore((s) => s.error);
  const query = useVaultStore((s) => s.query);
  const searchPrefs = useVaultStore((s) => s.searchPrefs);
  const setDirHandle = useVaultStore((s) => s.setDirHandle);
  const setNotes = useVaultStore((s) => s.setNotes);
  const setActivePath = useVaultStore((s) => s.setActivePath);
  const setLoading = useVaultStore((s) => s.setLoading);
  const setError = useVaultStore((s) => s.setError);
  const [importOpen, setImportOpen] = useState(false);
  const { width: sidebarWidth, onHandleMouseDown } = useSidebarWidth();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await loadLastVaultHandle();
        if (!saved || cancelled) return;
        const ok = await verifyReadPermission(saved, false);
        if (!ok || cancelled) {
          setDirHandle(saved);
          return;
        }
        setLoading(true);
        const found = await readVault(saved);
        if (cancelled) return;
        setDirHandle(saved);
        setNotes(found);
        setActivePath(found[0]?.path ?? null);
      } catch {
        // silencioso — usuário pode abrir manualmente
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setDirHandle, setNotes, setActivePath, setLoading]);

  async function handleOpenVault() {
    setError(null);
    setLoading(true);
    try {
      const handle = await pickVaultDirectory();
      const found = await readVault(handle);
      setDirHandle(handle);
      setNotes(found);
      setActivePath(found[0]?.path ?? null);
      await saveLastVaultHandle(handle);
      if (found.length === 0) {
        setError(
          "Pasta lida com sucesso, mas nenhum arquivo .md foi encontrado (varredura recursiva). Abra DevTools (F12) e veja o log [cofre]."
        );
      }
    } catch (e) {
      const err = e as Error;
      if (err.name === "AbortError") {
        setError("Selecao cancelada.");
      } else {
        setError(`${err.name ?? "Erro"}: ${err.message ?? String(e)}`);
        console.error("[cofre] handleOpenVault erro:", e);
      }
    } finally {
      setLoading(false);
    }
  }

  /**
   * Pós-importação: no desktop recarrega a pasta aberta; no navegador ativa
   * o cofre web (IndexedDB) e carrega as notas recém-importadas.
   */
  async function handleImported(dest: string) {
    if (dest !== "web") return handleReloadVault();
    setError(null);
    setLoading(true);
    try {
      const handle: VaultHandle = { kind: "webdb" };
      const found = await readVault(handle);
      setDirHandle(handle);
      setNotes(found);
      setActivePath(found[0]?.path ?? null);
      await saveLastVaultHandle(handle);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleReloadVault() {
    const handle = useVaultStore.getState().dirHandle;
    if (!handle) return handleOpenVault();
    setError(null);
    setLoading(true);
    try {
      const ok = await verifyReadPermission(handle, true);
      if (!ok) {
        setError("Permissão negada para o cofre.");
        return;
      }
      const found = await readVault(handle);
      setNotes(found);
      if (!found.find((n) => n.path === useVaultStore.getState().activePath)) {
        setActivePath(found[0]?.path ?? null);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const matchCount = filterNotes(notes, query, searchPrefs).length;

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-zinc-50">
      <UpdateBanner />
      <div className="flex flex-1 overflow-hidden">
        <aside
          style={{ width: sidebarWidth }}
          className="shrink-0 border-r border-zinc-200 bg-white flex flex-col"
        >
        <div className="p-3 border-b border-zinc-200 space-y-2">
          <div className="flex gap-2">
            <button
              onClick={handleOpenVault}
              disabled={loading}
              className="flex-1 px-3 py-2 text-sm font-medium rounded-md bg-zinc-900 text-white hover:bg-zinc-700 disabled:opacity-50"
            >
              {loading ? "Lendo..." : "Abrir cofre"}
            </button>
            <button
              onClick={handleReloadVault}
              disabled={loading || !notes.length}
              className="px-2 py-2 text-sm rounded-md border border-zinc-300 text-zinc-700 hover:bg-zinc-100 disabled:opacity-40"
              title="Recarregar"
            >
              ⟳
            </button>
          </div>
          <SearchBox />
          <SortControl />
          <button
            onClick={() => setImportOpen(true)}
            className="w-full px-3 py-1.5 text-xs font-medium rounded-md border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100"
            title="Importar conversas exportadas do Claude.ai (.zip) como notas .md"
          >
            ⬇ Importar conversas do Claude
          </button>
          {error && (
            <p className="text-xs text-red-600 break-words">{error}</p>
          )}
          <p className="text-xs text-zinc-500">
            {query
              ? `${matchCount} de ${notes.length} nota${notes.length === 1 ? "" : "s"}`
              : `${notes.length} nota${notes.length === 1 ? "" : "s"}`}
          </p>
        </div>

        <NoteList />
      </aside>

        <div
          onMouseDown={onHandleMouseDown}
          className="w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-violet-300 active:bg-violet-400"
          title="Arraste para ajustar a largura"
        />

        <main className="flex-1 overflow-y-auto bg-white">
          <NoteViewer />
        </main>
      </div>
      {importOpen && (
        <ImportClaudeModal
          onClose={() => setImportOpen(false)}
          onImported={handleImported}
        />
      )}
    </div>
  );
}
