/**
 * Carrega o exportador real (src-tauri/chatgpt_export.js) numa sandbox, para os
 * testes conferirem a saída dele com as funções do próprio Cofre.
 * Não é teste (não termina em .test.ts): só o carregador compartilhado.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

export type ArquivoExistente = { nome: string; uuid: string; updated: string; padrao: boolean };

export type Gptexport = {
  paraMd: (conv: unknown, meta: unknown, est: unknown) => string;
  novoEst: () => unknown;
  conferir: (md: string) => string[];
  lerCabecalho: (nome: string, txt: string) => ArquivoExistente | null;
  classificar: (
    lista: { id: string; update_time: unknown }[],
    idx: Map<string, ArquivoExistente>
  ) => { id: string; situacao: string; arquivo?: string }[];
};

export function carregarExportador(): Gptexport {
  const caminho = fileURLToPath(new URL("../../../src-tauri/chatgpt_export.js", import.meta.url));
  const ctx: Record<string, unknown> = {
    location: { hostname: "chatgpt.com" },
    // "loading": o script só registra o listener e não monta o painel (sem DOM aqui)
    document: { readyState: "loading", cookie: "", addEventListener: () => {} },
    crypto: { randomUUID: () => "teste" },
    console,
  };
  ctx.window = ctx;
  ctx.top = ctx;
  vm.runInNewContext(readFileSync(caminho, "utf8"), ctx);
  return ctx.__GPTEXPORT__ as Gptexport;
}
