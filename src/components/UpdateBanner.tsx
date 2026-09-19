import { useCallback, useEffect, useRef, useState } from "react";
import type { Update } from "@tauri-apps/plugin-updater";
import {
  checkForUpdate,
  installAndRelaunch,
  UPDATE_CHECK_EVENT,
} from "../lib/updater";
import { isTauriRuntime } from "../lib/fileSystem.tauri";
import { APP_VERSION } from "../lib/version";

type Phase =
  | "idle"
  | "checking" // só na checagem manual
  | "available"
  | "uptodate" // manual: já está na última
  | "unsupported" // manual fora do desktop
  | "check-error" // manual: endpoint não respondeu
  | "downloading"
  | "installing"
  | "install-error";

/** App aberto o dia todo não fica para trás (mesmo intervalo do VENDASMODULO). */
const RECHECK_MS = 4 * 60 * 60 * 1000;
/** Avisos informativos somem sozinhos. */
const INFO_HIDE_MS = 6000;

export function UpdateBanner() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [version, setVersion] = useState<string | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const updateRef = useRef<Update | null>(null);
  const checkingRef = useRef(false);

  const verify = useCallback(async (manual: boolean) => {
    if (checkingRef.current) return;
    if (!isTauriRuntime()) {
      if (manual) setPhase("unsupported");
      return;
    }
    checkingRef.current = true;
    if (manual) setPhase("checking");
    try {
      const update = await checkForUpdate();
      if (update) {
        updateRef.current = update;
        setVersion(update.version);
        setPhase("available");
        // Checagem manual reabre o aviso mesmo se o usuário clicou "Depois".
        if (manual) setDismissed(false);
      } else if (manual) {
        setPhase("uptodate");
      }
    } catch (e) {
      // Automática: silenciosa (sem internet / endpoint fora) — tenta no próximo ciclo.
      console.warn("[updater] verificação falhou:", e);
      if (manual) setPhase("check-error");
    } finally {
      checkingRef.current = false;
    }
  }, []);

  // Automática ao abrir + a cada 4h; manual via evento do badge de versão.
  useEffect(() => {
    void verify(false);
    const interval = window.setInterval(() => void verify(false), RECHECK_MS);
    const onManual = () => void verify(true);
    window.addEventListener(UPDATE_CHECK_EVENT, onManual);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener(UPDATE_CHECK_EVENT, onManual);
    };
  }, [verify]);

  // Avisos informativos voltam ao idle sozinhos.
  useEffect(() => {
    if (phase !== "uptodate" && phase !== "unsupported") return;
    const t = window.setTimeout(() => setPhase("idle"), INFO_HIDE_MS);
    return () => window.clearTimeout(t);
  }, [phase]);

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
      setPhase("install-error");
    }
  }

  if (phase === "idle") return null;
  if (phase === "available" && dismissed) return null;

  const busy = phase === "downloading" || phase === "installing";
  const closable =
    phase === "uptodate" ||
    phase === "unsupported" ||
    phase === "check-error" ||
    phase === "install-error";

  return (
    <div className="flex items-center gap-3 border-b border-violet-200 bg-violet-50 px-4 py-2 text-sm text-violet-900">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        className={`h-4 w-4 shrink-0 text-violet-600 ${phase === "checking" ? "animate-pulse" : ""}`}
        aria-hidden
      >
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zM9 9a1 1 0 012 0v3a1 1 0 11-2 0V9zm1-4a1 1 0 100 2 1 1 0 000-2z"
          clipRule="evenodd"
        />
      </svg>

      <div className="flex-1 min-w-0">
        {phase === "checking" && <span>Buscando atualizações…</span>}
        {phase === "available" && (
          <span>
            Nova versão disponível{version ? ` (v${version})` : ""} — instalada:
            v{APP_VERSION}.
          </span>
        )}
        {phase === "uptodate" && (
          <span>Você já está na versão mais recente (v{APP_VERSION}).</span>
        )}
        {phase === "unsupported" && (
          <span>
            Atualização automática só no app desktop. No navegador, recarregue a
            página.
          </span>
        )}
        {phase === "check-error" && (
          <span className="text-red-700">
            Não foi possível verificar atualizações — o servidor de releases não
            respondeu. Confira a internet e tente de novo.
          </span>
        )}
        {phase === "downloading" && (
          <span>
            Baixando atualização{percent != null ? ` — ${percent}%` : "…"}
          </span>
        )}
        {phase === "installing" && <span>Instalando e reiniciando…</span>}
        {phase === "install-error" && (
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

      {closable && (
        <button
          type="button"
          onClick={() => setPhase("idle")}
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
