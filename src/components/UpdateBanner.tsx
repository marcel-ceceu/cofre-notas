import { useEffect, useRef, useState } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import { checkForUpdate, installAndRelaunch } from "../lib/updater";

type Phase = "idle" | "available" | "downloading" | "installing" | "error";

export function UpdateBanner() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [version, setVersion] = useState<string | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const updateRef = useRef<Update | null>(null);

  // Verificação automática no startup.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const update = await checkForUpdate();
        if (cancelled || !update) return;
        updateRef.current = update;
        setVersion(update.version);
        setPhase("available");
      } catch (e) {
        // Sem internet / endpoint indisponível: falha silenciosa, não atrapalha o uso.
        console.warn("[updater] verificação falhou:", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleUpdate() {
    const update = updateRef.current;
    if (!update) return;
    try {
      setPhase("downloading");
      setPercent(0);
      await installAndRelaunch(update, (p) => {
        setPercent(p);
        if (p === 100) setPhase("installing");
      });
      // installAndRelaunch reinicia o app — não há retorno aqui.
    } catch (e) {
      console.error("[updater] instalação falhou:", e);
      setPhase("error");
    }
  }

  if (phase === "idle" || dismissed) return null;

  const busy = phase === "downloading" || phase === "installing";

  return (
    <div className="flex items-center gap-3 border-b border-violet-200 bg-violet-50 px-4 py-2 text-sm text-violet-900">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        className="h-4 w-4 shrink-0 text-violet-600"
        aria-hidden
      >
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zM9 9a1 1 0 012 0v3a1 1 0 11-2 0V9zm1-4a1 1 0 100 2 1 1 0 000-2z"
          clipRule="evenodd"
        />
      </svg>

      <div className="flex-1 min-w-0">
        {phase === "available" && (
          <span>
            Nova versão disponível{version ? ` (v${version})` : ""}.
          </span>
        )}
        {phase === "downloading" && (
          <span>
            Baixando atualização{percent != null ? ` — ${percent}%` : "…"}
          </span>
        )}
        {phase === "installing" && <span>Instalando e reiniciando…</span>}
        {phase === "error" && (
          <span className="text-red-700">
            Falha ao atualizar. Tente novamente mais tarde.
          </span>
        )}
      </div>

      {phase === "available" && (
        <>
          <button
            type="button"
            onClick={handleUpdate}
            className="shrink-0 rounded-md bg-violet-600 px-3 py-1 text-xs font-medium text-white hover:bg-violet-700"
          >
            Atualizar agora
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="shrink-0 rounded-md px-2 py-1 text-xs text-violet-700 hover:bg-violet-100"
          >
            Depois
          </button>
        </>
      )}

      {phase === "error" && (
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="shrink-0 rounded-md px-2 py-1 text-xs text-violet-700 hover:bg-violet-100"
        >
          Fechar
        </button>
      )}

      {busy && (
        <span className="shrink-0 text-xs text-violet-500">aguarde…</span>
      )}
    </div>
  );
}
