import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useVaultStore } from "../store/vaultStore";
import { stepIndex } from "../lib/noteFind";
import { NoteFindBar } from "./NoteFindBar";
import { SearchIcon } from "./icons";

/** Atraso antes de aplicar o termo: cada mudança re-parseia o markdown inteiro. */
const DEBOUNCE_MS = 150;
const CURRENT_CLASS = "hl-find--current";
const MARK_SELECTOR = "mark.hl-find";

type ResyncReason = "term" | "note" | "dom";

type Props = {
  /** Elemento com overflow-y que contém a nota (mesmo ref da régua). */
  scrollRef: RefObject<HTMLElement | null>;
};

/** Primeiro mark visível a partir do topo do viewport; senão o primeiro de todos. */
function pickInitialIndex(marks: HTMLElement[], root: HTMLElement): number {
  const top = root.getBoundingClientRect().top;
  const i = marks.findIndex((m) => m.getBoundingClientRect().top >= top);
  return i >= 0 ? i : 0;
}

function isInsideDialog(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[role="dialog"]') !== null;
}

/**
 * Busca dentro da nota (lupa flutuante / Ctrl+F).
 *
 * Só o TERMO vai para a store (o NoteViewer realça com ele). Índice atual,
 * total e navegação ficam aqui e são imperativos sobre os <mark> já no DOM:
 * Enter/Shift+Enter não re-renderizam o viewer (notas longas).
 */
export function NoteFind({ scrollRef }: Props) {
  const findTerm = useVaultStore((s) => s.findTerm);
  const setFindTerm = useVaultStore((s) => s.setFindTerm);
  const activePath = useVaultStore((s) => s.activePath);

  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [current, setCurrent] = useState(-1);
  const [total, setTotal] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const marksRef = useRef<HTMLElement[]>([]);
  const currentRef = useRef(-1);
  const currentElRef = useRef<HTMLElement | null>(null);
  const prevTermRef = useRef("");
  const restoreFocusRef = useRef(false);

  const applyCurrent = useCallback((index: number, scroll: boolean) => {
    const prev = currentElRef.current;
    if (prev) {
      prev.classList.remove(CURRENT_CLASS);
      prev.removeAttribute("aria-current");
    }
    const next = marksRef.current[index] ?? null;
    currentElRef.current = next;
    currentRef.current = next ? index : -1;
    setCurrent(currentRef.current);
    if (!next) return;
    next.classList.add(CURRENT_CLASS);
    next.setAttribute("aria-current", "true");
    if (scroll) next.scrollIntoView({ block: "center", behavior: "auto" });
  }, []);

  const resync = useCallback(
    (reason: ResyncReason) => {
      const root = scrollRef.current;
      const marks = root
        ? Array.from(root.querySelectorAll<HTMLElement>(MARK_SELECTOR))
        : [];
      marksRef.current = marks;
      setTotal(marks.length);
      if (!root || marks.length === 0) {
        applyCurrent(-1, false);
        return;
      }
      if (reason === "dom") {
        // Re-render do viewer sem troca de termo/nota: mantém o atual se sobreviveu.
        const el = currentElRef.current;
        const keep = el ? marks.indexOf(el) : -1;
        applyCurrent(keep >= 0 ? keep : pickInitialIndex(marks, root), false);
        return;
      }
      applyCurrent(pickInitialIndex(marks, root), true);
    },
    [scrollRef, applyCurrent]
  );

  const closeBar = useCallback(
    (restoreFocus: boolean) => {
      restoreFocusRef.current = restoreFocus;
      setOpen(false);
      setInputValue("");
      setFindTerm("");
    },
    [setFindTerm]
  );

  const openBar = useCallback(() => {
    setOpen(true);
    // Já aberta: o effect de foco não dispara de novo — refoca aqui.
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Debounce do termo. Vazio (ou só espaços) aplica na hora, como o SearchBox.
  useEffect(() => {
    if (!open) return;
    const term = inputValue.trim() === "" ? "" : inputValue;
    if (term === "") {
      setFindTerm("");
      return;
    }
    const t = setTimeout(() => setFindTerm(term), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [inputValue, open, setFindTerm]);

  // Sincroniza com os <mark> do viewer. Layout effect: o viewer é irmão e já
  // comitou os marks novos; evita um frame sem o "atual" e sem o scroll.
  useLayoutEffect(() => {
    if (!findTerm) {
      applyCurrent(-1, false);
      marksRef.current = [];
      setTotal(0);
      prevTermRef.current = "";
      return;
    }
    const reason: ResyncReason = prevTermRef.current === findTerm ? "note" : "term";
    prevTermRef.current = findTerm;
    resync(reason);

    const root = scrollRef.current;
    if (!root) return;
    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => resync("dom"));
    };
    // Sem `attributes`: o próprio classList.add do "atual" dispararia o observer.
    const mo = new MutationObserver(schedule);
    mo.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      cancelAnimationFrame(raf);
      mo.disconnect();
    };
  }, [findTerm, activePath, resync, applyCurrent, scrollRef]);

  // Foco: abrir → input; fechar pelo usuário → de volta à lupa.
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      inputRef.current?.select();
      return;
    }
    if (restoreFocusRef.current) {
      restoreFocusRef.current = false;
      buttonRef.current?.focus();
    }
  }, [open]);

  // Ctrl/Cmd+F global. Sempre preventDefault (senão o WebView2 abre o find
  // nativo); ignora quando o foco está num modal.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() !== "f") return;
      e.preventDefault();
      if (isInsideDialog(e.target)) return;
      if (useVaultStore.getState().activePath === null) return;
      openBar();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openBar]);

  // Nota fechada → barra fecha.
  useEffect(() => {
    if (activePath === null) closeBar(false);
  }, [activePath, closeBar]);

  function goNext() {
    applyCurrent(stepIndex(currentRef.current, marksRef.current.length, 1), true);
  }

  function goPrev() {
    applyCurrent(stepIndex(currentRef.current, marksRef.current.length, -1), true);
  }

  // No container (não só no input): clicar em anterior/próxima move o foco
  // para o botão e o Esc precisa continuar fechando a barra.
  function onBarKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeBar(true);
      return;
    }
    if (e.key === "Enter" && e.target === inputRef.current) {
      if (e.nativeEvent.isComposing) return;
      e.preventDefault();
      // Enter antes do debounce: aplica o termo já; o resync seleciona a 1ª.
      const term = inputValue.trim() === "" ? "" : inputValue;
      if (term !== findTerm) {
        setFindTerm(term);
        return;
      }
      if (e.shiftKey) goPrev();
      else goNext();
    }
  }

  if (activePath === null) return null;

  return (
    <div className="absolute top-2 right-6 z-20">
      {open ? (
        <NoteFindBar
          value={inputValue}
          onChange={setInputValue}
          onKeyDown={onBarKeyDown}
          current={current}
          total={total}
          isActive={findTerm !== ""}
          onPrev={goPrev}
          onNext={goNext}
          onClose={() => closeBar(true)}
          inputRef={inputRef}
        />
      ) : (
        <button
          ref={buttonRef}
          type="button"
          onClick={openBar}
          title="Buscar na nota (Ctrl+F)"
          aria-label="Buscar na nota (Ctrl+F)"
          className="tb-btn tb-btn--icon border-[var(--rule)] bg-[var(--paper-raised)] text-[var(--ink-muted)] shadow-sm"
        >
          <SearchIcon className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
