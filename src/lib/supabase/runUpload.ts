/**
 * runUpload — envio das notas ao Supabase (Fase 2), modelo de SENHA ÚNICA.
 *
 * A tabela é fechada na API; tudo passa pelas funções RPC que conferem a senha:
 *   cofre_hashes(p_senha, p_ids)   → reconciliação (dry-run)
 *   cofre_upsert(p_senha, p_rows)  → grava um lote (nova insere, existente atualiza)
 *
 * Fluxo:
 *  1. mapeia notas → linhas (só as com cabeçalho completo) e deduplica por chave;
 *  2. cofre_hashes traz os hashes já existentes do conjunto;
 *  3. classifica em inserir / atualizar / pular (hash igual);
 *  4. cofre_upsert em lotes por tamanho; no erro, isola a linha culpada;
 *  5. devolve o relatório (inseridas / atualizadas / puladas / erros).
 *
 * planUpload = passos 1-3 (dry-run) → alimenta a prévia.
 */

import type { Note } from "../fileSystem";
import { getSupabase } from "./client";
import { getSenha } from "./cofreAuth";
import { noteToRow, rowHash, rowKey, type VaultRow } from "./rows";

const NOT_CONFIGURED =
  "Supabase não configurado. Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no .env.";
const LOCKED = "Desbloqueie o cofre com a senha antes de sincronizar.";

/** Lote máximo por requisição (bytes de JSON). Conversas longas cabem sozinhas. */
const MAX_BATCH_BYTES = 3_000_000;
/** Máximo de ids por consulta de reconciliação (limita o payload). */
const SELECT_CHUNK = 200;

type RemoteHashRow = { origem: string; id_origem: string; hash_conteudo: string };

export type UploadPlan = {
  toInsert: VaultRow[];
  toUpdate: VaultRow[];
  skipped: number; // hash idêntico
  invalid: Note[]; // sem cabeçalho válido → não mapeáveis
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Remove duplicatas locais por (origem, id_origem), mantendo a mais recente. */
function dedupeRows(rows: VaultRow[]): VaultRow[] {
  const best = new Map<string, VaultRow>();
  for (const r of rows) {
    const k = rowKey(r);
    const cur = best.get(k);
    if (!cur || (r.dtconversafin ?? "") >= (cur.dtconversafin ?? "")) {
      best.set(k, r);
    }
  }
  return [...best.values()];
}

/** Agrupa linhas por tamanho de JSON; uma linha gigante fica sozinha no lote. */
function batchByBytes(rows: VaultRow[], maxBytes: number): VaultRow[][] {
  const batches: VaultRow[][] = [];
  let cur: VaultRow[] = [];
  let curBytes = 0;
  for (const row of rows) {
    const bytes = JSON.stringify(row).length + 1;
    if (cur.length > 0 && curBytes + bytes > maxBytes) {
      batches.push(cur);
      cur = [];
      curBytes = 0;
    }
    cur.push(row);
    curBytes += bytes;
  }
  if (cur.length > 0) batches.push(cur);
  return batches;
}

/** Dry-run: mapeia, reconcilia contra o banco e classifica. Não grava nada. */
export async function planUpload(notes: Note[]): Promise<UploadPlan> {
  const sb = getSupabase();
  if (!sb) throw new Error(NOT_CONFIGURED);
  const senha = getSenha();
  if (!senha) throw new Error(LOCKED);

  const mapped: VaultRow[] = [];
  const invalid: Note[] = [];
  for (const n of notes) {
    const r = noteToRow(n);
    if (r) mapped.push(r);
    else invalid.push(n);
  }
  const rows = dedupeRows(mapped);

  const remote = new Map<string, string>();
  const ids = rows.map((r) => r.id_origem);
  for (const part of chunk(ids, SELECT_CHUNK)) {
    const { data, error } = await sb.rpc("cofre_hashes", {
      p_senha: senha,
      p_ids: part,
    });
    if (error) throw new Error(`Falha ao ler o banco: ${error.message}`);
    for (const row of (data ?? []) as RemoteHashRow[]) {
      remote.set(rowKey(row), row.hash_conteudo);
    }
  }

  const plan: UploadPlan = { toInsert: [], toUpdate: [], skipped: 0, invalid };
  for (const r of rows) {
    const rh = remote.get(rowKey(r));
    if (rh === undefined) plan.toInsert.push(r);
    else if (rh !== rowHash(r)) plan.toUpdate.push(r);
    else plan.skipped++;
  }
  return plan;
}

export type UploadProgress = { phase: string; done: number; total: number };

export type UploadReport = {
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: { key: string; message: string }[];
};

/** Envia um grupo (inserts ou updates) via cofre_upsert, em lotes por bytes. */
async function sendGroup(
  rows: VaultRow[],
  senha: string,
  cursor: { done: number; total: number },
  onProgress: ((p: UploadProgress) => void) | undefined,
  report: UploadReport,
  kind: "inserted" | "updated"
): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error(NOT_CONFIGURED);

  const label = kind === "inserted" ? "Inserindo novas…" : "Atualizando…";

  for (const batch of batchByBytes(rows, MAX_BATCH_BYTES)) {
    onProgress?.({ phase: label, done: cursor.done, total: cursor.total });

    const { error } = await sb.rpc("cofre_upsert", {
      p_senha: senha,
      p_rows: batch,
    });

    if (!error) {
      report[kind] += batch.length;
    } else if (batch.length === 1) {
      report.failed += 1;
      report.errors.push({ key: rowKey(batch[0]), message: error.message });
    } else {
      // uma linha ruim derruba o lote: reenvia linha a linha para isolar.
      for (const row of batch) {
        const r = await sb.rpc("cofre_upsert", {
          p_senha: senha,
          p_rows: [row],
        });
        if (r.error) {
          report.failed += 1;
          report.errors.push({ key: rowKey(row), message: r.error.message });
        } else {
          report[kind] += 1;
        }
      }
    }
    cursor.done += batch.length;
    onProgress?.({ phase: label, done: cursor.done, total: cursor.total });
  }
}

/** Upload completo: dry-run + envio das inserções e atualizações. Idempotente. */
export async function runUpload(
  notes: Note[],
  onProgress?: (p: UploadProgress) => void
): Promise<UploadReport> {
  const senha = getSenha();
  if (!senha) throw new Error(LOCKED);

  const plan = await planUpload(notes);
  const total = plan.toInsert.length + plan.toUpdate.length;

  const report: UploadReport = {
    inserted: 0,
    updated: 0,
    skipped: plan.skipped,
    failed: 0,
    errors: [],
  };

  const cursor = { done: 0, total };
  await sendGroup(plan.toInsert, senha, cursor, onProgress, report, "inserted");
  await sendGroup(plan.toUpdate, senha, cursor, onProgress, report, "updated");

  onProgress?.({ phase: "Concluído", done: total, total });
  return report;
}
