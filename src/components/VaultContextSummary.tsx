import { useVaultStore } from "../store/vaultStore";
import { type TauriDirHandle } from "../lib/fileSystem.tauri";
import { isDesktopShell } from "../lib/runtime/shell";

/** Rodapé com cofre aberto, contagem de notas e interface (Tauri / PWA). */
export function VaultContextSummary() {
  const dirHandle = useVaultStore((s) => s.dirHandle);
  const notes = useVaultStore((s) => s.notes);
  const desktop = isDesktopShell();

  const vaultPath =
    dirHandle && (dirHandle as TauriDirHandle).kind === "tauri"
      ? (dirHandle as TauriDirHandle).path
      : dirHandle
        ? "cofre neste dispositivo (PWA)"
        : null;

  return (
    <dl className="space-y-1.5 rounded-md border border-[var(--rule)] bg-[var(--chrome)] px-2.5 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <dt className="meta-label">Cofre</dt>
        <dd
          className="min-w-0 truncate text-[11px] text-[var(--ink-muted)]"
          title={vaultPath ?? undefined}
        >
          {vaultPath ?? "nenhum aberto"}
        </dd>
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <dt className="meta-label">Notas</dt>
        <dd className="font-mono-ui text-[11px] text-[var(--ink-muted)]">
          {notes.length}
        </dd>
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <dt className="meta-label">Interface</dt>
        <dd className="text-[11px] text-[var(--ink-muted)]">
          {desktop ? "app instalado (Tauri)" : "PWA"}
        </dd>
      </div>
    </dl>
  );
}
