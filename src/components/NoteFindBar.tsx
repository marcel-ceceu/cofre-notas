import type React from "react";

type Props = {
  value: string;
  onChange: (value: string) => void;
  /** Teclado da barra inteira (Esc fecha mesmo com foco nos botões; Enter navega no input). */
  onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
  /** Índice da ocorrência atual; -1 = nenhuma. */
  current: number;
  total: number;
  /** Termo não vazio (após trim) — só então o contador aparece. */
  isActive: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  inputRef: React.RefObject<HTMLInputElement>;
};

function ChevronIcon({ direction }: { direction: "up" | "down" }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3.5 w-3.5"
      aria-hidden
    >
      {direction === "up" ? <path d="M5 12.5l5-5 5 5" /> : <path d="M5 7.5l5 5 5-5" />}
    </svg>
  );
}

/** Barra flutuante da busca dentro da nota — apresentação pura, sem estado. */
export function NoteFindBar({
  value,
  onChange,
  onKeyDown,
  current,
  total,
  isActive,
  onPrev,
  onNext,
  onClose,
  inputRef,
}: Props) {
  const hasResults = total > 0;
  const counter = !isActive
    ? ""
    : hasResults
      ? `${Math.max(current + 1, 0)} de ${total}`
      : "Sem resultados";

  return (
    <div
      role="search"
      aria-label="Buscar na nota"
      onKeyDown={onKeyDown}
      className="flex items-center gap-1 rounded-md border border-[var(--rule)] bg-[var(--paper-raised)] p-1 shadow-md"
    >
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        spellCheck={false}
        placeholder="Buscar na nota…"
        aria-label="Buscar na nota"
        className="field h-[26px] w-[220px] px-2"
      />
      <span
        aria-live="polite"
        aria-atomic="true"
        className={`min-w-[7ch] px-1 text-center font-mono-ui text-[11px] tabular-nums ${
          isActive && !hasResults ? "text-red-700" : "text-[var(--ink-muted)]"
        }`}
      >
        {counter}
      </span>
      <button
        type="button"
        tabIndex={-1}
        disabled={!hasResults}
        onClick={onPrev}
        title="Anterior (Shift+Enter)"
        aria-label="Ocorrência anterior (Shift+Enter)"
        className="tb-btn tb-btn--icon"
      >
        <ChevronIcon direction="up" />
      </button>
      <button
        type="button"
        tabIndex={-1}
        disabled={!hasResults}
        onClick={onNext}
        title="Próxima (Enter)"
        aria-label="Próxima ocorrência (Enter)"
        className="tb-btn tb-btn--icon"
      >
        <ChevronIcon direction="down" />
      </button>
      <button
        type="button"
        onClick={onClose}
        title="Fechar (Esc)"
        aria-label="Fechar busca na nota (Esc)"
        className="tb-btn tb-btn--icon text-base leading-none"
      >
        ×
      </button>
    </div>
  );
}
