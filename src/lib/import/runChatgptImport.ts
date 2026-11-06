/**
 * Importar ChatGPT — orquestrador de I/O (Tauri, desktop apenas).
 * Lê os originais de D:\915_CofreNotas-Conversas\1_Chatgpt (nunca os altera),
 * planeja com chatgptImport.ts e grava no cofre sem cortesias.
 */
import { join } from "@tauri-apps/api/path";
import { mkdir, readDir, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { scanExistingNotes, type ImportProgress } from "./runImport";
import { chooseTargetName } from "./claudeImport";
import {
  planejarChatgpt,
  vaiParaOCofre,
  type ChatgptItem,
  type OriginalChatgpt,
} from "./chatgptImport";
import { prepareCortesias, removeCortesias } from "./cortesias";
import { DEFAULT_CORTESIAS } from "./cortesias.rules";

export type ChatgptPlano = {
  itens: ChatgptItem[];
  /** arquivos .md que não deu para ler */
  ilegiveis: string[];
};

export type ChatgptImportResult = {
  written: number;
  updated: number;
  unchanged: number;
  failed: number;
};

async function lerOriginais(
  srcDir: string,
  onProgress?: (p: ImportProgress) => void
): Promise<{ originais: OriginalChatgpt[]; ilegiveis: string[] }> {
  let entries: Awaited<ReturnType<typeof readDir>>;
  try {
    entries = await readDir(srcDir);
  } catch {
    throw new Error(`Pasta das conversas do ChatGPT não encontrada: ${srcDir}`);
  }
  const mds = entries.filter((e) => e.isFile && /\.md$/i.test(e.name));
  const originais: OriginalChatgpt[] = [];
  const ilegiveis: string[] = [];
  for (let i = 0; i < mds.length; i++) {
    if (i % 25 === 0) {
      onProgress?.({ phase: "Lendo as conversas baixadas", done: i, total: mds.length });
    }
    const nome = mds[i].name;
    try {
      originais.push({ nome, raw: await readTextFile(await join(srcDir, nome)) });
    } catch {
      ilegiveis.push(nome);
    }
  }
  return { originais, ilegiveis };
}

/** Passo 2: lê a pasta de originais e confere contra o cofre (nada é gravado). */
export async function planejarImportChatgpt(
  srcDir: string,
  outDir: string,
  onProgress?: (p: ImportProgress) => void
): Promise<ChatgptPlano> {
  const { originais, ilegiveis } = await lerOriginais(srcDir, onProgress);
  const { byUuid } = await scanExistingNotes(outDir, onProgress);
  return { itens: planejarChatgpt(originais, byUuid), ilegiveis };
}

/** Passo 3: grava novas e alteradas no cofre, sem cortesias, 1 arquivo por conversa. */
export async function importarChatgpt(
  itens: ChatgptItem[],
  outDir: string,
  onProgress?: (p: ImportProgress) => void
): Promise<ChatgptImportResult> {
  await mkdir(outDir, { recursive: true });
  // Reconfere o cofre na hora de gravar (a janela pode ter ficado aberta).
  const { byUuid, names } = await scanExistingNotes(outDir, onProgress);
  const cort = prepareCortesias(DEFAULT_CORTESIAS);
  const fila = itens.filter(vaiParaOCofre);
  const r: ChatgptImportResult = { written: 0, updated: 0, unchanged: 0, failed: 0 };

  for (let i = 0; i < fila.length; i++) {
    const it = fila[i];
    if (i % 10 === 0) {
      onProgress?.({ phase: "Tirando cortesias e gravando no cofre", done: i, total: fila.length });
    }
    if (!it.note) continue;
    const alvo = chooseTargetName(it.note, it.uuid, byUuid, names);
    if (alvo.existed && byUuid.get(it.uuid)?.updated === it.updated) {
      r.unchanged++;
      continue;
    }
    try {
      await writeTextFile(await join(outDir, alvo.name), removeCortesias(it.note.content, cort));
      if (alvo.existed) r.updated++;
      else r.written++;
      names.add(alvo.name);
      byUuid.set(it.uuid, { name: alvo.name, updated: it.updated });
    } catch (e) {
      console.error("[import-chatgpt] falha ao gravar", alvo.name, e);
      r.failed++;
    }
  }

  onProgress?.({ phase: "Concluído", done: fila.length, total: fila.length });
  return r;
}
