/**
 * Preferências de IA (chave/modelo/prompt) persistidas via plugin-store,
 * em arquivo no perfil do usuário — nunca no Git.
 */
import { load, type Store } from "@tauri-apps/plugin-store";
import { DEFAULT_AI_MODEL, PROMPT_CONSOLIDADO } from "./ai";

export type AiPrefs = { apiKey: string; model: string; prompt: string };

export const DEFAULT_AI_PREFS: AiPrefs = {
  apiKey: "",
  model: DEFAULT_AI_MODEL,
  prompt: PROMPT_CONSOLIDADO,
};

const FILE = "ai-prefs.json";
let storeP: Promise<Store> | null = null;

function store(): Promise<Store> {
  if (!storeP) storeP = load(FILE);
  return storeP;
}

export async function loadAiPrefs(): Promise<AiPrefs> {
  try {
    const s = await store();
    return {
      apiKey: (await s.get<string>("apiKey")) ?? DEFAULT_AI_PREFS.apiKey,
      model: (await s.get<string>("model")) ?? DEFAULT_AI_PREFS.model,
      prompt: (await s.get<string>("prompt")) ?? DEFAULT_AI_PREFS.prompt,
    };
  } catch {
    return { ...DEFAULT_AI_PREFS };
  }
}

export async function saveAiPrefs(p: AiPrefs): Promise<void> {
  try {
    const s = await store();
    await s.set("apiKey", p.apiKey);
    await s.set("model", p.model);
    await s.set("prompt", p.prompt);
    await s.save();
  } catch (e) {
    console.error("[aiPrefs] falha ao salvar", e);
  }
}
