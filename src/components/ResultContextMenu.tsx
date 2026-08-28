import { useEffect, useState } from "react";

type Props = {
  x: number;
  y: number;
  count: number;
  onCopy: () => Promise<void> | void;
  onSendSupabase: () => void;
  onClose: () => void;
};

/** Menu de contexto dos resultados (botão direito): copiar ou enviar ao Supabase. */
export function ResultContextMenu({
  x,
  y,
  count,
  onCopy,
  onSendSupabase,
  onClose,
}: Props) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    function onDown() {
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  async function handleCopy() {
    await onCopy();
    setCopied(true);
    setTimeout(onClose, 700);
  }

  return (
    <div
      className="fixed z-[60] min-w-[170px] rounded-md border border-zinc-200 bg-white py-1 shadow-lg"
      style={{ top: y, left: x }}
      role="menu"
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        type="button"
        role="menuitem"
        onClick={handleCopy}
        className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm text-zinc-700 hover:bg-violet-50 hover:text-violet-700"
      >
        <span className="flex items-center gap-2">
          <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5 text-zinc-400" aria-hidden>
            <path d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1z" />
            <path d="M9.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5zm-3-1A1.5 1.5 0 0 0 5 1.5v1A1.5 1.5 0 0 0 6.5 4h3A1.5 1.5 0 0 0 11 2.5v-1A1.5 1.5 0 0 0 9.5 0z" />
          </svg>
          {copied ? "Copiado!" : "Copiar caminhos"}
        </span>
        {!copied && count > 1 && (
          <span className="text-[11px] text-zinc-400">{count}</span>
        )}
      </button>

      <div className="my-1 h-px bg-zinc-100" />

      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onSendSupabase();
          onClose();
        }}
        className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm text-zinc-700 hover:bg-violet-50 hover:text-violet-700"
      >
        <span className="flex items-center gap-2">
          <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5 text-zinc-400" aria-hidden>
            <path d="M11.5 0c-1.612 0-3.083.196-4.174.545-.545.174-1.017.4-1.366.678C5.612 1.5 5.3 1.897 5.3 2.4v3.2c0 .503.312.9.66 1.177.35.278.821.504 1.366.678C8.417 7.804 9.888 8 11.5 8s3.083-.196 4.174-.545c.11-.035.216-.073.32-.113A.5.5 0 0 0 16 6.8V2.4c0-.503-.312-.9-.66-1.177-.35-.278-.821-.504-1.366-.678C12.583.196 12.112 0 11.5 0z" />
            <path d="M2.5 3C1.12 3 0 3.672 0 4.5v7C0 12.328 1.12 13 2.5 13c.279 0 .548-.028.799-.08a4.5 4.5 0 0 1-.34-.997C2.79 11.973 2.65 12 2.5 12 1.4 12 1 11.53 1 11.5v-1.007c.4.27.94.454 1.5.535a4.5 4.5 0 0 1 .085-1.02C2.02 9.928 1.4 9.53 1 9.493V8.486c.4.27.94.455 1.5.536.04-.353.126-.692.253-1.01C2.02 7.928 1.4 7.53 1 7.493V6.5C1 6.47 1.4 6 2.5 6c.303 0 .58.036.816.098a4.5 4.5 0 0 1 .69-.783A5 5 0 0 0 2.5 5z" />
            <path d="M11.5 16a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9m.354-6.854 1.5 1.5a.5.5 0 0 1-.708.708L12 10.707V13.5a.5.5 0 0 1-1 0v-2.793l-.646.647a.5.5 0 0 1-.708-.708l1.5-1.5a.5.5 0 0 1 .708 0" />
          </svg>
          Enviar para o Supabase
        </span>
        {count > 1 && <span className="text-[11px] text-zinc-400">{count}</span>}
      </button>
    </div>
  );
}
