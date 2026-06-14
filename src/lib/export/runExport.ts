/**
 * Exportar / Consolidar — orquestrador de I/O (Tauri).
 * As notas já vêm com `content` em memória (vindas da busca), então só grava.
 */
import { mkdir, writeTextFile } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import type { Note } from "../fileSystem";
import {
  buildConsolidado,
  buildLlmsTxt,
  consolidadoFileName,
  buildSubfolderName,
  cleanExportMarkdown,
  extractTitle,
  fileDate,
  baseName,
  type MergeConv,
  type LlmsRow,
} from "./consolidate";
import { summarizeConversation } from "./ai";

export type ExportProgress = { phase: string; done: number; total: number };
export type CopyFilesResult = { copied: number; total: number; subfolder: string };
export type ConsolidateResult = { file: string; count: number };

/** Copia cada nota selecionada para uma subpasta datada dentro de destDir. */
export async function runCopyFiles(
  notes: Note[],
  destDir: string,
  onProgress?: (p: ExportProgress) => void
): Promise<CopyFilesResult> {
  const sub = buildSubfolderName();
  const subDir = await join(destDir, sub);
  await mkdir(subDir, { recursive: true });

  const used = new Set<string>();
  let copied = 0;
  for (let i = 0; i < notes.length; i++) {
    if (i % 20 === 0) {
      onProgress?.({ phase: "Copiando arquivos", done: i, total: notes.length });
    }
    let name = baseName(notes[i].path);
    if (used.has(name)) name = `${i + 1}-${name}`; // evita sobrescrever homônimos
    used.add(name);
    try {
      await writeTextFile(await join(subDir, name), notes[i].content);
      copied++;
    } catch (e) {
      console.error("[export] falha ao copiar", name, e);
    }
  }

  onProgress?.({ phase: "Concluído", done: notes.length, total: notes.length });
  return { copied, total: notes.length, subfolder: sub };
}

/** Gera um único .md consolidado (índice + transcrições) na raiz de destDir. */
export async function runConsolidate(
  notes: Note[],
  destDir: string,
  vaultLabel: string,
  onProgress?: (p: ExportProgress) => void
): Promise<ConsolidateResult> {
  onProgress?.({ phase: "Montando consolidado", done: 0, total: notes.length });

  const convs: MergeConv[] = notes.map((n) => {
    const fileName = baseName(n.path);
    const content = cleanExportMarkdown(n.content);
    return {
      fileName,
      title: extractTitle(content, fileName) || n.name,
      date: fileDate(fileName),
      content,
      resumo: "",
      tags: [],
    };
  });

  const md = buildConsolidado(convs, vaultLabel);
  const fname = consolidadoFileName();
  await mkdir(destDir, { recursive: true });
  await writeTextFile(await join(destDir, fname), md);

  onProgress?.({ phase: "Concluído", done: notes.length, total: notes.length });
  return { file: fname, count: notes.length };
}

export type ConsolidateAIResult = ConsolidateResult & { failed: number };
export type LlmsResult = { subfolder: string; copied: number; failed: number };

/** Consolida COM IA: resume cada nota (título/resumo/tags) e monta o consolidado. */
export async function runConsolidateAI(
  notes: Note[],
  destDir: string,
  vaultLabel: string,
  apiKey: string,
  model: string,
  prompt: string,
  onProgress?: (p: ExportProgress) => void
): Promise<ConsolidateAIResult> {
  const convs: MergeConv[] = [];
  let failed = 0;

  for (let i = 0; i < notes.length; i++) {
    onProgress?.({ phase: `Resumindo ${i + 1}/${notes.length}`, done: i, total: notes.length });
    const n = notes[i];
    const fileName = baseName(n.path);
    const content = cleanExportMarkdown(n.content);
    let resumo = "";
    let tags: string[] = [];
    let titulo = "";
    try {
      const s = await summarizeConversation(content, apiKey, model, prompt);
      if (s.ok) {
        resumo = s.resumo;
        tags = s.tags;
        titulo = s.titulo;
      } else failed++;
    } catch (e) {
      console.error("[ai] falha ao resumir", fileName, e);
      failed++;
    }
    convs.push({
      fileName,
      title: titulo || extractTitle(content, fileName) || n.name,
      date: fileDate(fileName),
      content,
      resumo,
      tags,
    });
  }

  const md = buildConsolidado(convs, vaultLabel);
  const fname = consolidadoFileName();
  await mkdir(destDir, { recursive: true });
  await writeTextFile(await join(destDir, fname), md);

  onProgress?.({ phase: "Concluído", done: notes.length, total: notes.length });
  return { file: fname, count: notes.length, failed };
}

/** Copia os .md numa subpasta datada e gera um llms.txt com resumos por IA. */
export async function runLlms(
  notes: Note[],
  destDir: string,
  apiKey: string,
  model: string,
  prompt: string,
  onProgress?: (p: ExportProgress) => void
): Promise<LlmsResult> {
  const sub = buildSubfolderName();
  const subDir = await join(destDir, sub);
  await mkdir(subDir, { recursive: true });

  const used = new Set<string>();
  const rows: LlmsRow[] = [];
  let copied = 0;
  let failed = 0;

  for (let i = 0; i < notes.length; i++) {
    onProgress?.({ phase: `Resumindo ${i + 1}/${notes.length}`, done: i, total: notes.length });
    const n = notes[i];
    let name = baseName(n.path);
    if (used.has(name)) name = `${i + 1}-${name}`;
    used.add(name);
    const content = cleanExportMarkdown(n.content);

    try {
      await writeTextFile(await join(subDir, name), n.content);
      copied++;
    } catch (e) {
      console.error("[export] falha ao copiar", name, e);
    }

    let resumo = "";
    let tags: string[] = [];
    let titulo = "";
    try {
      const s = await summarizeConversation(content, apiKey, model, prompt);
      if (s.ok) {
        resumo = s.resumo;
        tags = s.tags;
        titulo = s.titulo;
      } else failed++;
    } catch (e) {
      console.error("[ai] falha ao resumir", name, e);
      failed++;
    }
    rows.push({
      fileName: name,
      title: titulo || extractTitle(content, name) || n.name,
      date: fileDate(name),
      resumo,
      tags,
    });
  }

  await writeTextFile(await join(subDir, "llms.txt"), buildLlmsTxt(rows));
  onProgress?.({ phase: "Concluído", done: notes.length, total: notes.length });
  return { subfolder: sub, copied, failed };
}
