import { useEffect, useRef, useState } from "react";
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
import { SearchScrollRuler } from "./components/SearchScrollRuler";
import { SortControl } from "./components/SortControl";
import { SearchBox } from "./components/SearchBox";
import { UpdateBanner } from "./components/UpdateBanner";
import { ImportClaudeModal } from "./components/ImportClaudeModal";
import { SearchSettingsModal } from "./components/SearchSettingsModal";
import { ToolbarActions } from "./components/ToolbarActions";
import { ActivityRail, type RailView } from "./components/ActivityRail";
import { ImportPanel } from "./components/ImportPanel";
import { ConsolidatePanel } from "./components/ConsolidatePanel";
import { SyncSupabaseModal } from "./components/SyncSupabaseModal";
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
  const activePath = useVaultStore((s) => s.activePath);
  const selectedPaths = useVaultStore((s) => s.selectedPaths);
  const setSyncScope = useVaultStore((s) => s.setSyncScope);
  const [importOpen, setImportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [railView, setRailView] = useState<RailView>("notes");
  const { width: sidebarWidth, onHandleMouseDown } = useSidebarWidth();
  const viewerScrollRef = useRef<HTMLElement>(null);

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
  const activeNote = notes.find((n) => n.path === activePath) ?? null;

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[var(--paper)]">
      <UpdateBanner />

      {/* Barra de ferramentas — todas as ações do cofre em um lugar só */}
      <header className="toolbar flex shrink-0 items-center gap-2 px-2.5">
        <div className="flex items-center gap-2 pr-1" title="Cofre de Notas">
          <span
            className="grid h-6 w-6 place-items-center rounded-md bg-[var(--accent)] shadow-sm"
            aria-hidden
          >
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="white"
              strokeWidth="1.4"
              strokeLinecap="round"
              className="h-[14px] w-[14px]"
            >
              <circle cx="7" cy="8" r="3.1" />
              <path d="M7 8h4.2" />
              <circle cx="7" cy="8" r="0.55" fill="white" stroke="none" />
            </svg>
          </span>
          <span className="flex items-baseline gap-1 leading-none">
            <span className="text-[13px] font-semibold tracking-tight text-[var(--ink)]">
              Cofre
            </span>
            <span className="text-[11px] font-medium text-[var(--ink-faint)]">
              de Notas
            </span>
          </span>
        </div>

        <span className="h-4 w-px bg-[var(--rule)]" />

        <button
          onClick={handleOpenVault}
          disabled={loading}
          className="tb-btn tb-btn--primary"
          title="Selecionar a pasta do cofre"
        >
          {loading ? "Lendo…" : "Abrir cofre"}
        </button>

        <button
          onClick={handleReloadVault}
          disabled={loading || !notes.length}
          className="tb-btn"
          title="Recarregar cofre"
        >
          <svg
            viewBox="0 0 16 16"
            fill="currentColor"
            className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
            aria-hidden
          >
            <path d="M11.534 7h3.932a.25.25 0 0 1 .192.41l-1.966 2.36a.25.25 0 0 1-.384 0l-1.966-2.36a.25.25 0 0 1 .192-.41m-11 2h3.932a.25.25 0 0 0 .192-.41L2.692 6.23a.25.25 0 0 0-.384 0L.342 8.59A.25.25 0 0 0 .534 9" />
            <path
              fillRule="evenodd"
              d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5.002 5.002 0 0 0 8 3M3.1 9a5.002 5.002 0 0 0 8.757 2.182.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9z"
            />
          </svg>
          Recarregar
        </button>

        <button
          onClick={() => setRailView("import")}
          className="tb-btn"
          title="Abrir o fluxo de importação de conversas do Claude.ai"
        >
          <svg
            viewBox="0 0 16 16"
            fill="currentColor"
            className="h-3.5 w-3.5"
            aria-hidden
          >
            <path
              fillRule="evenodd"
              d="M3.5 10a.5.5 0 0 1-.5-.5v-8a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 .5.5v8a.5.5 0 0 1-.5.5h-2a.5.5 0 0 0 0 1h2A1.5 1.5 0 0 0 14 9.5v-8A1.5 1.5 0 0 0 12.5 0h-9A1.5 1.5 0 0 0 2 1.5v8A1.5 1.5 0 0 0 3.5 11h2a.5.5 0 0 0 0-1z"
            />
            <path
              fillRule="evenodd"
              d="M7.646 15.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 14.293V5.5a.5.5 0 0 0-1 0v8.793l-2.146-2.147a.5.5 0 0 0-.708.708z"
            />
          </svg>
          Importar
        </button>

        <div className="flex-1" />

        {error && (
          <p
            className="max-w-[42ch] truncate rounded-[4px] border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700"
            title={error}
          >
            {error}
          </p>
        )}

        <span className="h-4 w-px bg-[var(--rule)]" />

        <ToolbarActions />
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <ActivityRail
          active={railView}
          onChange={setRailView}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenSync={() => {
            setSyncScope(null);
            setSyncOpen(true);
          }}
          selectedCount={selectedPaths.length}
        />

        <aside
          style={{ width: sidebarWidth }}
          className="flex shrink-0 flex-col border-r border-[var(--rule)] bg-[var(--paper)]"
        >
          {railView === "notes" && (
            <>
              <div className="space-y-1.5 border-b border-[var(--rule)] px-2.5 py-2">
                <SearchBox />
                <SortControl />
              </div>

              <div className="pane-head">
                <span className="pane-title">Notas</span>
                <span className="h-px flex-1 bg-[var(--rule)]" />
                <span className="meta-label tabular-nums">
                  {query ? `${matchCount}/${notes.length}` : notes.length}
                </span>
              </div>

              <NoteList onRequestSync={() => setSyncOpen(true)} />
            </>
          )}

          {railView === "import" && <ImportPanel onImported={handleImported} />}

          {railView === "consolidate" && <ConsolidatePanel />}
        </aside>

        <div
          onMouseDown={onHandleMouseDown}
          className="group relative w-1.5 shrink-0 cursor-col-resize bg-transparent"
          title="Arraste para ajustar a largura"
        >
          <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-[var(--accent-ring)] group-active:bg-[var(--accent)]" />
        </div>

        <div className="relative min-h-0 min-w-0 flex-1">
          <main
            ref={viewerScrollRef}
            className="paper-grain h-full overflow-y-auto"
          >
            <NoteViewer />
          </main>
          {query ? (
            <SearchScrollRuler
              scrollRef={viewerScrollRef}
              deps={[activePath, query, searchPrefs.searchMode]}
            />
          ) : null}
        </div>
      </div>

      {/* Barra de status — contexto permanente, sem ocupar a leitura */}
      <footer className="statusbar flex shrink-0 items-center gap-3 px-2.5">
        <span className="shrink-0">
          {loading ? "lendo cofre…" : `${notes.length} nota(s)`}
        </span>
        <span className="h-3 w-px shrink-0 bg-[var(--rule)]" />
        <span className="min-w-0 flex-1 truncate" title={activeNote?.path}>
          {activeNote ? activeNote.path : "nenhuma nota aberta"}
        </span>
        {query && (
          <span className="shrink-0 text-[var(--accent)]">
            filtro: “{query}” · {matchCount} resultado(s)
          </span>
        )}
        <span className="hidden shrink-0 items-center gap-1 sm:flex">
          <span className="kbd">Ctrl</span>
          <span className="kbd">K</span>
          <span>buscar</span>
        </span>
      </footer>

      {syncOpen && (
        <SyncSupabaseModal
          onClose={() => {
            setSyncOpen(false);
            setSyncScope(null);
          }}
          onStamped={handleReloadVault}
        />
      )}

      {settingsOpen && (
        <SearchSettingsModal onClose={() => setSettingsOpen(false)} />
      )}

      {importOpen && (
        <ImportClaudeModal
          onClose={() => setImportOpen(false)}
          onImported={handleImported}
        />
      )}
    </div>
  );
}
