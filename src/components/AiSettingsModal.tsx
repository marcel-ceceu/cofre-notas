import { useEffect, useState } from "react";
import {
  AI_MODELS,
  PROMPT_CONSOLIDADO,
  PROMPT_CLASSICO,
} from "../lib/export/ai";
import type { AiPrefs } from "../lib/export/aiPrefs";

type Props = {
  initial: AiPrefs;
  onClose: () => void;
  onSave: (p: AiPrefs) => void;
};

export function AiSettingsModal({ initial, onClose, onSave }: Props) {
  const [apiKey, setApiKey] = useState(initial.apiKey);
  const [model, setModel] = useState(initial.model);
  const [prompt, setPrompt] = useState(initial.prompt);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-lg border border-zinc-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="ai-settings-title"
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
          <h2 id="ai-settings-title" className="text-sm font-semibold text-zinc-900">
            Configurações de IA
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

        <div className="p-4 space-y-4 text-sm">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-700">
              Chave API Anthropic
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-ant-…"
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded border border-zinc-300 px-2 py-1.5 font-mono text-xs outline-none focus:ring-1 focus:ring-violet-400"
            />
            <p className="mt-1 text-[11px] text-zinc-500">
              Guardada localmente no seu perfil (plugin-store). Não vai para o Git
              nem para servidor — só é usada na chamada à própria Anthropic.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-700">
              Modelo
            </label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full rounded border border-zinc-300 px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-violet-400"
            >
              {AI_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-xs font-medium text-zinc-700">
                Prompt (system)
              </label>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setPrompt(PROMPT_CONSOLIDADO)}
                  className="rounded border border-zinc-300 px-1.5 py-0.5 text-[10px] text-zinc-600 hover:bg-zinc-50"
                >
                  Consolidado (200)
                </button>
                <button
                  type="button"
                  onClick={() => setPrompt(PROMPT_CLASSICO)}
                  className="rounded border border-zinc-300 px-1.5 py-0.5 text-[10px] text-zinc-600 hover:bg-zinc-50"
                >
                  Clássico (500)
                </button>
              </div>
            </div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={6}
              className="w-full rounded border border-zinc-300 p-2 font-mono text-[11px] outline-none focus:ring-1 focus:ring-violet-400"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-zinc-200 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => {
              onSave({ apiKey: apiKey.trim(), model, prompt });
              onClose();
            }}
            className="rounded bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700"
          >
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
