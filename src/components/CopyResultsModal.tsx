import { useEffect, useMemo, useRef, useState } from "react";
import type { Note } from "../lib/fileSystem";

type LinkStyle = "none" | "wiki" | "markdown";
type ListPrefix = "none" | "bullet" | "number";

function formatResults(
  notes: Note[],
  showPath: boolean,
  linkStyle: LinkStyle,
  listPrefix: ListPrefix
): string {
  return notes
    .map((n, i) => {
      const display = showPath ? n.path : n.name;
      let line = display;
      if (linkStyle === "wiki") line = `[[${display}]]`;
      else if (linkStyle === "markdown") line = `[${display}](${n.path})`;
      if (listPrefix === "bullet") line = `- ${line}`;
      else if (listPrefix === "number") line = `${i + 1}. ${line}`;
      return line;
    })
    .join("\n");
}

type Props = {
  notes: Note[];
  onClose: () => void;
};

export function CopyResultsModal({ notes, onClose }: Props) {
  const [showPath, setShowPath] = useState(true);
  const [linkStyle, setLinkStyle] = useState<LinkStyle>("none");
  const [listPrefix, setListPrefix] = useState<ListPrefix>("none");
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const text = useMemo(
    () => formatResults(notes, showPath, linkStyle, listPrefix),
    [notes, showPath, linkStyle, listPrefix]
  );

  useEffect(() => {
    textareaRef.current?.select();
  }, [text]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      textareaRef.current?.select();
      document.execCommand("copy");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-lg border border-zinc-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="copy-results-title"
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
          <h2 id="copy-results-title" className="text-sm font-semibold text-zinc-900">
            Copiar resultados da pesquisa
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-700 text-lg leading-none px-1"
            aria-label="Fechar"
          >
            ×
          </button>
        </div>

        <div className="p-4 space-y-4">
          <textarea
            ref={textareaRef}
            readOnly
            value={text}
            rows={10}
            className="w-full resize-none rounded border border-zinc-300 bg-zinc-50 px-3 py-2 text-xs font-mono text-zinc-800 focus:outline-none focus:ring-1 focus:ring-violet-400"
          />

          <div className="space-y-3 text-sm">
            <label className="flex items-center justify-between gap-4 border-b border-zinc-100 pb-3">
              <span>
                <span className="block font-medium text-zinc-800">Mostrar caminho</span>
                <span className="block text-xs text-zinc-500">
                  Caminho completo em vez de só o nome do arquivo.
                </span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={showPath}
                onClick={() => setShowPath((v) => !v)}
                className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                  showPath ? "bg-violet-600" : "bg-zinc-300"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                    showPath ? "translate-x-4" : ""
                  }`}
                />
              </button>
            </label>

            <label className="flex items-center justify-between gap-4 border-b border-zinc-100 pb-3">
              <span>
                <span className="block font-medium text-zinc-800">Estilo de link</span>
                <span className="block text-xs text-zinc-500">
                  Opcionalmente, transforma cada resultado em link.
                </span>
              </span>
              <select
                value={linkStyle}
                onChange={(e) => setLinkStyle(e.target.value as LinkStyle)}
                className="shrink-0 rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-800"
              >
                <option value="none">Nenhum</option>
                <option value="wiki">Wiki [[...]]</option>
                <option value="markdown">Markdown</option>
              </select>
            </label>

            <label className="flex items-center justify-between gap-4">
              <span>
                <span className="block font-medium text-zinc-800">Prefixo de lista</span>
                <span className="block text-xs text-zinc-500">
                  Opcionalmente, adiciona prefixo de lista a cada resultado.
                </span>
              </span>
              <select
                value={listPrefix}
                onChange={(e) => setListPrefix(e.target.value as ListPrefix)}
                className="shrink-0 rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-800"
              >
                <option value="none">Nenhum</option>
                <option value="bullet">Marcador (-)</option>
                <option value="number">Numerado</option>
              </select>
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-zinc-200 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
          >
            Pronto
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="rounded bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700"
          >
            {copied ? "Copiado!" : "Copiar resultados"}
          </button>
        </div>
      </div>
    </div>
  );
}
