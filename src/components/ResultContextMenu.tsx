import { useEffect, useState } from "react";

type Props = {
  x: number;
  y: number;
  count: number;
  onCopy: () => Promise<void> | void;
  onClose: () => void;
};

/** Menu de contexto dos resultados (botão direito). Hoje: "Copiar caminhos". */
export function ResultContextMenu({ x, y, count, onCopy, onClose }: Props) {
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
        <span>{copied ? "Copiado!" : "Copiar caminhos"}</span>
        {!copied && count > 1 && (
          <span className="text-[11px] text-zinc-400">{count}</span>
        )}
      </button>
    </div>
  );
}
