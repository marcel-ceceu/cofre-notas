import { useEffect } from "react";
import { useVaultStore } from "../store/vaultStore";
import type { SearchMode, TriggerMode } from "../lib/search";

type Props = {
  onClose: () => void;
};

/** Botão de um segmented control (par de opções mutuamente exclusivas). */
function Segment<T extends string>({
  value,
  current,
  onSelect,
  children,
}: {
  value: T;
  current: T;
  onSelect: (v: T) => void;
  children: React.ReactNode;
}) {
  const active = value === current;
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      aria-pressed={active}
      className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
        active
          ? "bg-violet-600 text-white shadow-sm"
          : "text-zinc-600 hover:bg-zinc-100"
      }`}
    >
      {children}
    </button>
  );
}

export function SearchSettingsModal({ onClose }: Props) {
  const prefs = useVaultStore((s) => s.searchPrefs);
  const setSearchPrefs = useVaultStore((s) => s.setSearchPrefs);
  const resetSearchPrefs = useVaultStore((s) => s.resetSearchPrefs);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-lg border border-zinc-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="search-settings-title"
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
          <h2
            id="search-settings-title"
            className="text-sm font-semibold text-zinc-900"
          >
            Preferências de pesquisa
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

        <div className="p-4 space-y-5 text-sm">
          {/* Disparo */}
          <div className="space-y-2">
            <div>
              <span className="block font-medium text-zinc-800">Disparo</span>
              <span className="block text-xs text-zinc-500">
                Quando a busca consulta as notas.
              </span>
            </div>
            <div className="flex gap-1 rounded-lg bg-zinc-100 p-1">
              <Segment<TriggerMode>
                value="enter"
                current={prefs.triggerMode}
                onSelect={(v) => setSearchPrefs({ triggerMode: v })}
              >
                Ao pressionar Enter
              </Segment>
              <Segment<TriggerMode>
                value="auto"
                current={prefs.triggerMode}
                onSelect={(v) => setSearchPrefs({ triggerMode: v })}
              >
                Automático ao digitar
              </Segment>
            </div>
            {prefs.triggerMode === "auto" && (
              <label className="flex items-center justify-between gap-4 pt-1">
                <span className="text-xs text-zinc-600">
                  Mínimo de caracteres para disparar
                </span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={prefs.minChars}
                  onChange={(e) =>
                    setSearchPrefs({ minChars: Number(e.target.value) })
                  }
                  className="w-16 rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-800"
                />
              </label>
            )}
          </div>

          {/* Modo de busca */}
          <div className="space-y-2 border-t border-zinc-100 pt-4">
            <div>
              <span className="block font-medium text-zinc-800">
                Modo de busca
              </span>
              <span className="block text-xs text-zinc-500">
                {prefs.searchMode === "tokens"
                  ? "Palavras soltas: cada palavra é casada em qualquer campo (E entre palavras)."
                  : "Texto contínuo: procura o trecho exato como uma única substring."}
              </span>
            </div>
            <div className="flex gap-1 rounded-lg bg-zinc-100 p-1">
              <Segment<SearchMode>
                value="tokens"
                current={prefs.searchMode}
                onSelect={(v) => setSearchPrefs({ searchMode: v })}
              >
                Palavras soltas
              </Segment>
              <Segment<SearchMode>
                value="substring"
                current={prefs.searchMode}
                onSelect={(v) => setSearchPrefs({ searchMode: v })}
              >
                Texto contínuo
              </Segment>
            </div>
          </div>

          {/* Campos auxiliares */}
          <label className="flex items-center justify-between gap-4 border-t border-zinc-100 pt-4">
            <span>
              <span className="block font-medium text-zinc-800">
                Buscar no corpo da nota
              </span>
              <span className="block text-xs text-zinc-500">
                O título é sempre pesquisado. Desligue para buscar só nos
                títulos.
              </span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={prefs.includeBody}
              onClick={() => setSearchPrefs({ includeBody: !prefs.includeBody })}
              className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                prefs.includeBody ? "bg-violet-600" : "bg-zinc-300"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  prefs.includeBody ? "translate-x-4" : ""
                }`}
              />
            </button>
          </label>

          {/* Limite de resultados */}
          <label className="flex items-center justify-between gap-4 border-t border-zinc-100 pt-4">
            <span>
              <span className="block font-medium text-zinc-800">
                Limite de resultados
              </span>
              <span className="block text-xs text-zinc-500">
                Máximo de notas por consulta. 0 = sem limite.
              </span>
            </span>
            <input
              type="number"
              min={0}
              max={9999}
              value={prefs.resultLimit}
              onChange={(e) =>
                setSearchPrefs({ resultLimit: Number(e.target.value) })
              }
              className="w-20 shrink-0 rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-800"
            />
          </label>
        </div>

        <div className="flex justify-between gap-2 border-t border-zinc-200 px-4 py-3">
          <button
            type="button"
            onClick={resetSearchPrefs}
            className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
          >
            Restaurar padrões
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700"
          >
            Pronto
          </button>
        </div>
      </div>
    </div>
  );
}
