import { APP_VERSION } from "../lib/version";
import { requestUpdateCheck } from "../lib/updater";

/**
 * Badge com a versão instalada (tag `vX.Y.Z`). Clique = "Buscar atualizações":
 * o UpdateBanner escuta o evento e mostra o resultado no topo.
 */
export function VersionBadge() {
  return (
    <button
      type="button"
      onClick={requestUpdateCheck}
      className="tb-btn font-mono-ui"
      title={`Versão instalada v${APP_VERSION} — clique para buscar atualizações`}
      aria-label={`Versão v${APP_VERSION}. Buscar atualizações`}
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3.5 w-3.5"
        aria-hidden
      >
        <path d="M8 2.5v7" />
        <path d="M5.5 7 8 9.5 10.5 7" />
        <path d="M3 11v1.5A1 1 0 0 0 4 13.5h8a1 1 0 0 0 1-1V11" />
      </svg>
      v{APP_VERSION}
    </button>
  );
}
