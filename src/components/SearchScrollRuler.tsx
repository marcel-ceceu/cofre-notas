import { useCallback, useEffect, useState, type RefObject } from "react";

type Tick = { top: number; el: HTMLElement };

type Props = {
  /** Elemento com overflow-y que contém os <mark> da busca. */
  scrollRef: RefObject<HTMLElement | null>;
  /** Recalcula quando muda nota / query. */
  deps: unknown[];
};

/**
 * Overview ruler: traços amarelos na borda direita do viewer,
 * um por cada <mark> de highlight da busca (estilo Firefox/VS Code).
 */
export function SearchScrollRuler({ scrollRef, deps }: Props) {
  const [ticks, setTicks] = useState<Tick[]>([]);

  const rebuild = useCallback(() => {
    const root = scrollRef.current;
    if (!root) {
      setTicks([]);
      return;
    }
    const marks = root.querySelectorAll<HTMLElement>("mark");
    if (marks.length === 0) {
      setTicks([]);
      return;
    }
    const scrollH = root.scrollHeight;
    const viewH = root.clientHeight;
    if (scrollH <= 0 || viewH <= 0) {
      setTicks([]);
      return;
    }
    const rootTop = root.getBoundingClientRect().top + root.scrollTop;
    const next: Tick[] = [];
    marks.forEach((el) => {
      const top = el.getBoundingClientRect().top + root.scrollTop - rootTop;
      const y = (top / scrollH) * viewH;
      next.push({ top: Math.max(0, Math.min(viewH - 3, y)), el });
    });
    setTicks(next);
  }, [scrollRef]);

  const depsKey = JSON.stringify(deps);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;

    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(rebuild);
    };

    schedule();

    const ro = new ResizeObserver(schedule);
    ro.observe(root);
    if (root.firstElementChild) ro.observe(root.firstElementChild);

    const mo = new MutationObserver(schedule);
    mo.observe(root, { childList: true, subtree: true, characterData: true });

    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [rebuild, scrollRef, depsKey]);

  if (ticks.length === 0) return null;

  return (
    <div
      className="pointer-events-none absolute inset-y-0 right-0 z-10 w-3.5"
      aria-hidden
    >
      {ticks.map((t, i) => (
        <button
          key={i}
          type="button"
          title="Ir ao trecho encontrado"
          className="pointer-events-auto absolute left-0.5 right-0.5 h-[3px] rounded-sm bg-yellow-400 shadow-[0_0_0_1px_rgba(234,179,8,0.35)] hover:h-1.5 hover:bg-yellow-500"
          style={{ top: t.top }}
          onClick={() => {
            t.el.scrollIntoView({ behavior: "smooth", block: "center" });
          }}
        />
      ))}
    </div>
  );
}
