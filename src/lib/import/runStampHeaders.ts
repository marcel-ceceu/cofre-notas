/**
 * Gravação do cabeçalho padrão — camada de I/O da ação "inserir cabeçalho".
 *
 * Recebe o plano (nota + origem detectada), aplica `ensureOrigem` e grava o
 * .md de volta no cofre. Segue a mesma segurança do script 2608:
 * idempotente e com backup .bak antes de sobrescrever (no desktop).
 *
 * Suporta desktop (Tauri) e o cofre do navegador (IndexedDB). O modo de leitura
 * direta de pasta no navegador (File System Access) é aberto somente-leitura,
 * então não é suportado aqui — a mensagem orienta usar o app desktop.
 */

import {
  readTextFile,
  writeTextFile,
  copyFile,
  exists,
} from "@tauri-apps/plugin-fs";
import type { Note, VaultHandle } from "../fileSystem";
import { isTauriRuntime, type TauriDirHandle } from "../fileSystem.tauri";
import { isWebVaultHandle, updateWebVaultContent } from "./webVault";
import { ensureOrigem, parseFrontmatter, type Origem } from "./frontmatter";

export type StampTarget = { note: Note; origem: Origem };

export type StampProgress = { phase: string; done: number; total: number };

export type StampResult = {
  total: number;
  stamped: number;
  skipped: number; // já tinha origem / nada a mudar
  failed: number;
  errors: { path: string; message: string }[];
};

function joinPath(base: string, rel: string): string {
  const sep = base.includes("\\") ? "\\" : "/";
  const cleanRel = rel.replace(/[\\/]+/g, sep);
  return base.endsWith(sep) ? `${base}${cleanRel}` : `${base}${sep}${cleanRel}`;
}

/** Aplica o cabeçalho padrão às notas do plano e grava no cofre. */
export async function runStampHeaders(
  handle: VaultHandle,
  targets: StampTarget[],
  onProgress?: (p: StampProgress) => void
): Promise<StampResult> {
  const result: StampResult = {
    total: targets.length,
    stamped: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  const isTauri =
    isTauriRuntime() && (handle as TauriDirHandle).kind === "tauri";
  const isWebDb = isWebVaultHandle(handle);

  if (!isTauri && !isWebDb) {
    throw new Error(
      "Gravar o cabeçalho só é suportado no app desktop ou no cofre do " +
        "navegador. A pasta aberta neste navegador é somente-leitura."
    );
  }

  const base = isTauri ? (handle as TauriDirHandle).path : "";

  for (let i = 0; i < targets.length; i++) {
    const { note, origem } = targets[i];
    onProgress?.({
      phase: `Carimbando ${i + 1}/${targets.length}`,
      done: i,
      total: targets.length,
    });

    try {
      if (isTauri) {
        const abs = joinPath(base, note.path);
        const raw = await readTextFile(abs);
        const { content, changed } = ensureOrigem(raw, origem);
        if (!changed) {
          result.skipped++;
          continue;
        }
        const bak = `${abs}.bak`;
        if (!(await exists(bak))) await copyFile(abs, bak);
        await writeTextFile(abs, content);
        result.stamped++;
      } else {
        // IndexedDB: a chave é o uuid do frontmatter.
        const { content, changed } = ensureOrigem(note.content, origem);
        if (!changed) {
          result.skipped++;
          continue;
        }
        const uuid = parseFrontmatter(content)?.map.uuid ?? "";
        const ok = uuid && (await updateWebVaultContent(uuid, content));
        if (!ok) throw new Error("nota não encontrada no cofre do navegador");
        result.stamped++;
      }
    } catch (e) {
      result.failed++;
      result.errors.push({
        path: note.path,
        message: (e as Error).message ?? String(e),
      });
    }
  }

  onProgress?.({
    phase: "Concluído",
    done: targets.length,
    total: targets.length,
  });
  return result;
}
