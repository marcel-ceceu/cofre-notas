/**
 * Exportar / Consolidar no PWA — mesmo contrato de runExport.ts, saída via download.
 */
import { strToU8, zipSync } from "fflate";
import type { Note } from "../fileSystem";
import { triggerDownload } from "./download";
import {
  baseName,
  buildConsolidado,
  buildLlmsTxt,
  buildSubfolderName,
  cleanExportMarkdown,
  consolidadoFileName,
  extractTitle,
  fileDate,
  type LlmsRow,
  type MergeConv,
} from "./consolidate";
import { summarizeConversation } from "./ai";
import type {
  ConsolidateAIResult,
  ConsolidateResult,
  CopyFilesResult,
  ExportProgress,
  LlmsResult,
} from "./runExport";

export async function runCopyFilesWeb(
  notes: Note[],
  onProgress?: (p: ExportProgress) => void
): Promise<CopyFilesResult> {
  const sub = buildSubfolderName();
  const zipEntries: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  let copied = 0;

  for (let i = 0; i < notes.length; i++) {
    if (i % 20 === 0) {
      onProgress?.({ phase: "Preparando arquivos", done: i, total: notes.length });
    }
    let name = baseName(notes[i].path);
    if (used.has(name)) name = `${i + 1}-${name}`;
    used.add(name);
    zipEntries[`${sub}/${name}`] = strToU8(notes[i].content);
    copied++;
  }

  triggerDownload(`cofre-notas-${sub}.zip`, zipSync(zipEntries));
  onProgress?.({ phase: "Concluído", done: notes.length, total: notes.length });
  return { copied, total: notes.length, subfolder: sub };
}

export async function runConsolidateWeb(
  notes: Note[],
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
  triggerDownload(fname, strToU8(md));
  onProgress?.({ phase: "Concluído", done: notes.length, total: notes.length });
  return { file: fname, count: notes.length };
}

export async function runConsolidateAIWeb(
  notes: Note[],
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
  triggerDownload(fname, strToU8(md));
  onProgress?.({ phase: "Concluído", done: notes.length, total: notes.length });
  return { file: fname, count: notes.length, failed };
}

export async function runLlmsWeb(
  notes: Note[],
  apiKey: string,
  model: string,
  prompt: string,
  onProgress?: (p: ExportProgress) => void
): Promise<LlmsResult> {
  const sub = buildSubfolderName();
  const zipEntries: Record<string, Uint8Array> = {};
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
    zipEntries[`${sub}/${name}`] = strToU8(n.content);
    copied++;

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

  zipEntries[`${sub}/llms.txt`] = strToU8(buildLlmsTxt(rows));
  triggerDownload(`cofre-notas-llms-${sub}.zip`, zipSync(zipEntries));
  onProgress?.({ phase: "Concluído", done: notes.length, total: notes.length });
  return { subfolder: sub, copied, failed };
}
