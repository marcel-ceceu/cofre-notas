import { useCallback, useEffect, useRef, useState } from "react";

const KEY = "cofre-notas:sidebarWidth";
const MIN = 220;
const MAX = 600;
const DEFAULT = 288; // = w-72

function loadWidth(): number {
  try {
    const v = parseInt(localStorage.getItem(KEY) ?? "", 10);
    if (!Number.isNaN(v)) return Math.min(MAX, Math.max(MIN, v));
  } catch {
    /* ignora */
  }
  return DEFAULT;
}

/** Largura da sidebar arrastável + persistida (com mín/máx). */
export function useSidebarWidth() {
  const [width, setWidth] = useState<number>(loadWidth);
  const dragging = useRef(false);
  const widthRef = useRef(width);
  widthRef.current = width;

  const onHandleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current) return;
      const w = Math.min(MAX, Math.max(MIN, e.clientX));
      widthRef.current = w;
      setWidth(w);
    }
    function onUp() {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try {
        localStorage.setItem(KEY, String(widthRef.current));
      } catch {
        /* ignora */
      }
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  return { width, onHandleMouseDown };
}
