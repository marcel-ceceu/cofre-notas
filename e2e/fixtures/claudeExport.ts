/**
 * Fixtures do export de conversas do Claude.ai para os testes E2E.
 *
 * O JSON imita o export real: `json.dumps` do Python com separadores ", " e
 * ": " e `ensure_ascii` (tudo fora de ASCII vira \uXXXX minúsculo, emoji vira
 * par de surrogates). Os blocos de conteúdo têm as mesmas chaves e a mesma
 * ordem do export real (text, thinking, tool_use, tool_result,
 * injected_prompt_block).
 *
 * Variantes de zip:
 * - `newFormatZip`       → conversations-000.zip / -001.zip (só conversations.json),
 *                          layout binário do export real (ver zipWriter.ts);
 * - `legacyZip`          → data-*-batch-0000.zip (users/projects/memories + conversations);
 * - `nonClaudeZip`       → zip qualquer, que deve ser recusado;
 * - `dataDescriptorZip`  → gravado com o `Zip` + `ZipDeflate` do fflate em
 *                          streaming (flag 3: data descriptor, tamanhos só no fim);
 * - `ensureBigExport`    → export GRANDE (≥ 600 MB descompactado) gravado em
 *                          disco em streaming, com cache em e2e/.tmp/.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Zip, ZipDeflate, strToU8, zipSync } from "fflate";
import {
  CONVERSATIONS_STYLE,
  FileExportZip,
  PLAIN_STYLE,
  buildExportZip,
} from "./zipWriter";

// ───────────────────────── marcadores ─────────────────────────

/** Texto que só existe dentro do <user_memory_snapshot> (nunca pode virar nota). */
export const MEMORY_MARKER = "MEMORIA-PRIVADA-DO-USUARIO";
/** Texto que só existe nos blocos `thinking`. */
export const THINKING_MARKER = "PENSAMENTO-INTERNO-DESCARTAVEL";
/** Texto que só existe nos blocos `tool_use` / `tool_result`. */
export const TOOL_MARKER = "RESULTADO-DE-FERRAMENTA-DESCARTAVEL";
/** Tags do bloco injetado de memória. */
export const MEMORY_TAG = "user_memory_snapshot";

// ───────────────────── JSON no estilo do Python ─────────────────────

/** JSON já serializado, emitido tal qual (evita re-escapar textos enormes). */
export class RawJson {
  constructor(readonly json: string) {}
}

export type Json =
  | null
  | boolean
  | number
  | string
  | RawJson
  | readonly Json[]
  | { readonly [key: string]: Json };

const SAFE_ASCII = /^[\x20-\x21\x23-\x5b\x5d-\x7e]*$/;

/** Escapa como o `json.dumps(ensure_ascii=True)` do Python, sem as aspas. */
export function pyEscape(s: string): string {
  if (SAFE_ASCII.test(s)) return s;
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x22) out += '\\"';
    else if (c === 0x5c) out += "\\\\";
    else if (c === 0x0a) out += "\\n";
    else if (c === 0x0d) out += "\\r";
    else if (c === 0x09) out += "\\t";
    else if (c === 0x08) out += "\\b";
    else if (c === 0x0c) out += "\\f";
    else if (c < 0x20 || c > 0x7e) out += "\\u" + c.toString(16).padStart(4, "0");
    else out += s[i];
  }
  return out;
}

export function pyJson(value: Json): string {
  if (value === null) return "null";
  if (value instanceof RawJson) return value.json;
  if (typeof value === "string") return `"${pyEscape(value)}"`;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("pyJson: número não finito");
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map((v) => pyJson(v)).join(", ")}]`;
  const obj = value as { readonly [key: string]: Json };
  const parts = Object.keys(obj).map((k) => `"${pyEscape(k)}": ${pyJson(obj[k])}`);
  return `{${parts.join(", ")}}`;
}

/** O export é 100% ASCII (ensure_ascii) — latin1 converte 1:1 e rápido. */
function asciiBytes(s: string): Uint8Array {
  return Buffer.from(s, "latin1");
}

// ───────────────────────── conversas ─────────────────────────

export type JsonText = string | RawJson;

export interface TurnSpec {
  readonly sender: "human" | "assistant";
  /** Texto visível do turno (bloco `text`). */
  readonly text: string;
  /** created_at da mensagem, ISO com microssegundos (ex.: 2026-08-10T14:03:22.418977Z). */
  readonly at: string;
  /** Só humano: corpo do <user_memory_snapshot> (gera um `injected_prompt_block`). */
  readonly memory?: string;
  /** Só assistente: bloco `thinking`. */
  readonly thinking?: JsonText;
  /** Só assistente: blocos `tool_use` (web_search) + `tool_result`. */
  readonly toolResult?: JsonText;
  /** `content: []` e texto só no campo `text` (caminho de fallback do importador). */
  readonly textOnlyField?: boolean;
}

export interface ConversationSpec {
  readonly uuid: string;
  readonly name: string;
  readonly summary?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly turns: readonly TurnSpec[];
}

const ACCOUNT_UUID = "5f0c9a1e-7b2d-4c3e-9f10-2a3b4c5d6e7f";
const ROOT_PARENT_UUID = "00000000-0000-4000-8000-000000000000";

/** UUID determinístico (FNV-1a) — mesmos dados geram o mesmo zip. */
export function pseudoUuid(seed: string): string {
  let hex = "";
  for (let round = 0; hex.length < 32; round++) {
    let h = 0x811c9dc5 ^ round;
    const s = `${round}:${seed}`;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    hex += h.toString(16).padStart(8, "0");
  }
  const h = hex.slice(0, 32);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function memoryPrompt(body: string, version = "3b9e2f71"): string {
  return (
    "<system-reminder>\n" +
    `<${MEMORY_TAG} version="${version}">\n${body}\n</${MEMORY_TAG}>\n` +
    "</system-reminder>"
  );
}

function timestamps(at: string): { start_timestamp: string; stop_timestamp: string } {
  return { start_timestamp: at, stop_timestamp: at };
}

function textBlock(at: string, text: string): Json {
  return { ...timestamps(at), flags: null, type: "text", text, citations: [] };
}

function contentBlocks(t: TurnSpec): Json[] {
  if (t.textOnlyField) return [];
  const blocks: Json[] = [];
  if (t.memory !== undefined) {
    blocks.push({
      ...timestamps(t.at),
      flags: null,
      type: "injected_prompt_block",
      prompt: memoryPrompt(t.memory),
      injection_source: "memory",
      initial_turn_only: true,
      skip_on_truncated_continuation: false,
    });
  }
  if (t.thinking !== undefined) {
    blocks.push({
      ...timestamps(t.at),
      flags: null,
      type: "thinking",
      thinking: t.thinking,
      summaries: [],
      cut_off: false,
    });
  }
  if (t.toolResult !== undefined) {
    blocks.push({
      ...timestamps(t.at),
      flags: null,
      type: "tool_use",
      name: "web_search",
      input: { query: `${TOOL_MARKER} consulta` },
    });
    blocks.push({
      ...timestamps(t.at),
      flags: null,
      type: "tool_result",
      name: "web_search",
      content: [{ type: "text", text: t.toolResult }],
      is_error: false,
    });
  }
  blocks.push(textBlock(t.at, t.text));
  return blocks;
}

function messageJson(c: ConversationSpec, t: TurnSpec, index: number): Json {
  return {
    uuid: pseudoUuid(`${c.uuid}#${index}`),
    text: t.text,
    content: contentBlocks(t),
    sender: t.sender,
    created_at: t.at,
    updated_at: t.at,
    attachments: [],
    files: [],
    parent_message_uuid: index === 0 ? ROOT_PARENT_UUID : pseudoUuid(`${c.uuid}#${index - 1}`),
  };
}

export function conversationJson(c: ConversationSpec): string {
  return pyJson({
    uuid: c.uuid,
    name: c.name,
    summary: c.summary ?? "",
    created_at: c.createdAt,
    updated_at: c.updatedAt,
    account: { uuid: ACCOUNT_UUID },
    chat_messages: c.turns.map((t, i) => messageJson(c, t, i)),
  });
}

/** Conteúdo de `conversations.json`: array de conversas. */
export function exportJson(convs: readonly ConversationSpec[]): string {
  return `[${convs.map(conversationJson).join(", ")}]`;
}

// ───────────────────────── zips pequenos ─────────────────────────

/** Export novo: conversations-000.zip (ou -001, …) com SÓ o conversations.json. */
export function newFormatZip(convs: readonly ConversationSpec[]): Uint8Array {
  return buildExportZip([
    { name: "conversations.json", data: asciiBytes(exportJson(convs)), style: CONVERSATIONS_STYLE },
  ]);
}

/**
 * Export novo com o conversations.json CORTADO no fim (download incompleto
 * recompactado): o ZIP é válido e passa na validação, mas a última conversa
 * fica pela metade — as anteriores entram e o arquivo vai para `failed`.
 */
export function truncatedNewFormatZip(convs: readonly ConversationSpec[], cutBytes: number): Uint8Array {
  const json = exportJson(convs);
  return buildExportZip([
    {
      name: "conversations.json",
      data: asciiBytes(json.slice(0, json.length - cutBytes)),
      style: CONVERSATIONS_STYLE,
    },
  ]);
}

/**
 * Export antigo `data-…-batch-0000.zip`, na ordem real das entradas:
 * users.json, projects.json, memories.json e, por ÚLTIMO, conversations.json
 * (um leitor em streaming precisa pular as entradas anteriores).
 */
export function legacyZip(convs: readonly ConversationSpec[]): Uint8Array {
  const users: Json = [
    {
      uuid: ACCOUNT_UUID,
      full_name: "Usuário de Teste",
      email_address: "teste@example.com",
      verified_phone_number: null,
    },
  ];
  const projects: Json = [0, 1, 2, 3].map((p) => ({
    uuid: pseudoUuid(`projeto-${p}`),
    name: `Projeto nº ${p + 1} — documentação`,
    description: "Base de conhecimento do projeto (conversations.json está em outra entrada).",
    is_private: true,
    is_starter_project: false,
    prompt_template: "",
    created_at: "2026-03-01T12:00:00.000000Z",
    updated_at: "2026-04-01T12:00:00.000000Z",
    creator: { uuid: ACCOUNT_UUID, full_name: "Usuário de Teste" },
    docs: [
      {
        uuid: pseudoUuid(`doc-${p}`),
        filename: `manual-${p + 1}.md`,
        content: randomProse(7000 + p, 60_000),
        created_at: "2026-03-02T09:30:00.000000Z",
      },
    ],
  }));
  const memories: Json = [
    {
      conversations_memory: `${MEMORY_MARKER}: resumo antigo das conversas (export legado).`,
      project_memories: {},
      account_uuid: ACCOUNT_UUID,
    },
  ];
  return buildExportZip([
    { name: "users.json", data: asciiBytes(pyJson(users)), style: PLAIN_STYLE },
    { name: "projects.json", data: asciiBytes(pyJson(projects)), style: PLAIN_STYLE },
    { name: "memories.json", data: asciiBytes(pyJson(memories)), style: PLAIN_STYLE },
    { name: "conversations.json", data: asciiBytes(exportJson(convs)), style: CONVERSATIONS_STYLE },
  ]);
}

/** Zip que NÃO é export do Claude (sem conversations.json). */
export function nonClaudeZip(): Uint8Array {
  return zipSync({
    "leia-me.txt": strToU8("Fotos da viagem de férias — não é um export do Claude.\n"),
    "fotos/lista.csv": strToU8("arquivo;data\npraia.jpg;2026-07-01\n"),
    "dados.json": strToU8('{"tipo": "planilha", "linhas": [1, 2, 3]}'),
  });
}

/**
 * Mesmo conteúdo do export novo, mas gravado com o `Zip` + `ZipDeflate` do
 * fflate em streaming: o local header sai com flag 3 (data descriptor) e
 * tamanhos zerados — os tamanhos só aparecem DEPOIS dos dados.
 */
export function dataDescriptorZip(convs: readonly ConversationSpec[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const failures: Error[] = [];
  const zip = new Zip((err, chunk) => {
    if (err) failures.push(err);
    else chunks.push(chunk);
  });
  const entry = new ZipDeflate("conversations.json", { level: 6 });
  zip.add(entry);
  const json = asciiBytes(exportJson(convs));
  const step = 16 * 1024;
  for (let p = 0; p < json.length; p += step) {
    entry.push(json.subarray(p, p + step), p + step >= json.length);
  }
  zip.end();
  if (failures.length > 0) throw failures[0];
  return concatBytes(chunks);
}

/** true se o PRIMEIRO local header do zip usa data descriptor (flag bit 3). */
export function zipUsesDataDescriptor(zip: Uint8Array): boolean {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  return v.getUint32(0, true) === 0x04034b50 && (v.getUint16(6, true) & 0x8) !== 0;
}

/** true se o PRIMEIRO local header tem tamanhos 0xFFFFFFFF + extra ZIP64 (layout real). */
export function zipUsesZip64LocalHeader(zip: Uint8Array): boolean {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  if (v.getUint32(0, true) !== 0x04034b50) return false;
  const sizesMasked = v.getUint32(18, true) === 0xffffffff && v.getUint32(22, true) === 0xffffffff;
  const extraStart = 30 + v.getUint16(26, true);
  return sizesMasked && v.getUint16(28, true) >= 20 && v.getUint16(extraStart, true) === 0x0001;
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

/** Payload para `locator.setInputFiles` (até ~50 MB; acima disso passe o caminho). */
export function zipPayload(
  name: string,
  bytes: Uint8Array
): { name: string; mimeType: string; buffer: Buffer } {
  return { name, mimeType: "application/zip", buffer: Buffer.from(bytes) };
}

// ───────────────────── texto volumoso determinístico ─────────────────────

/**
 * Vocabulário do "lixo" volumoso (thinking / tool_result). Traz de propósito
 * o que confunde um separador de objetos JSON feito em bytes: chaves e
 * colchetes dentro de strings, aspas escapadas, barras invertidas, \n, \t,
 * acentos (\u00e7), emoji (par de surrogates) e CJK.
 */
const BULK_WORDS: readonly string[] = [
  "análise", "código", "função", "módulo", "orçamento", "manutenção", "relatório",
  "inadimplência", "produção", "coração", "pão", "ação", "über", "naïve", "日本語",
  "😀", "🚀", "→", "∑", "{", "}", "[", "]", "{\"k\": [1, 2]}", "\"citação\"",
  "'apóstrofo'", "C:\\temp\\saída\\", "\\", "\\\\", "linha\nnova", "tab\there",
  "<tag>", "&amp;", "null", "true", "-0.5e3", "},{", "]]", "{{", "\"}\"",
  "objeto", "lista", "streaming", "descompactar", "conversa", "assistente",
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Prosa pseudoaleatória (pouco compressível) com ~`chars` caracteres. */
export function randomProse(seed: number, chars: number): string {
  const rnd = mulberry32(seed);
  const parts: string[] = [];
  let len = 0;
  while (len < chars) {
    const w = BULK_WORDS[Math.floor(rnd() * BULK_WORDS.length)];
    parts.push(w);
    len += w.length + 1;
  }
  return parts.join(" ");
}

/**
 * String JSON (já com aspas) de ~`jsonChars` caracteres: um parágrafo
 * escapado UMA vez e repetido (escapar é concatenável), terminando em
 * barra invertida escapada logo antes da aspa de fechamento (`…\\"`).
 */
export function bulkJsonString(seed: number, marker: string, jsonChars: number): RawJson {
  const unit = pyEscape(`${marker} ${randomProse(seed, 2048)} `);
  const tail = pyEscape(" fim do bloco C:\\");
  const reps = Math.max(1, Math.ceil((jsonChars - tail.length - 2) / unit.length));
  return new RawJson(`"${unit.repeat(reps)}${tail}"`);
}

// ───────────────────────── export grande ─────────────────────────

export const BIG_CONVERSATIONS = 1200;
/** ≥ 600 MiB descompactado: passa do limite de string do V8 (~536,8 M caracteres). */
export const BIG_MIN_UNCOMPRESSED_BYTES = 600 * 1024 * 1024;
const BIG_THINKING_CHARS = 240_000;
const BIG_TOOL_RESULT_CHARS = 290_000;
/** Mude ao alterar o formato do export grande (invalida o cache em e2e/.tmp). */
const BIG_GENERATOR_VERSION = 1;

const TMP_DIR = fileURLToPath(new URL("../.tmp/", import.meta.url));

export function bigUuid(i: number): string {
  return `0b16e000-0000-4000-8000-${String(i).padStart(12, "0")}`;
}

export function bigHumanMarker(i: number): string {
  return `MARCADOR-H-${i}`;
}

export function bigAssistantMarker(i: number): string {
  return `MARCADOR-A-${i}`;
}

function isoMicro(ms: number): string {
  return new Date(ms).toISOString().replace(/\.(\d{3})Z$/, ".$1000Z");
}

function bigConversation(i: number): ConversationSpec {
  const base = Date.UTC(2024, 0, 1, 8, 0, 0) + i * 17 * 3_600_000;
  const at = (min: number) => isoMicro(base + min * 60_000);
  return {
    uuid: bigUuid(i),
    name: `Exportação grande nº ${String(i + 1).padStart(4, "0")} — revisão de código`,
    summary: "",
    createdAt: at(0),
    updatedAt: at(3),
    turns: [
      {
        sender: "human",
        at: at(0),
        memory: `${MEMORY_MARKER}: prefere respostas em português, usa Tauri + React; ${randomProse(i, 1500)}`,
        text: `Pergunta ${i} sobre o módulo de importação: como tratar {"chave": [${i}]}? ${bigHumanMarker(i)}`,
      },
      {
        sender: "assistant",
        at: at(1),
        thinking: bulkJsonString(i * 2 + 1, THINKING_MARKER, BIG_THINKING_CHARS),
        toolResult: bulkJsonString(i * 2 + 2, TOOL_MARKER, BIG_TOOL_RESULT_CHARS),
        text: `Resposta ${i}: processe em streaming, objeto por objeto. ${bigAssistantMarker(i)}`,
      },
      { sender: "human", at: at(2), text: `Pergunta complementar ${i}: e os anexos?` },
      { sender: "assistant", at: at(3), text: `Resposta complementar ${i}: anexos são ignorados.` },
    ],
  };
}

export interface BigExportInfo {
  /** Caminho absoluto do zip (nome do arquivo: conversations-000.zip). */
  readonly path: string;
  readonly fileName: string;
  readonly conversations: number;
  /** Tamanho do conversations.json descompactado, em bytes (= caracteres, é ASCII). */
  readonly uncompressedBytes: number;
  readonly zipBytes: number;
  readonly generatedNow: boolean;
  readonly elapsedMs: number;
}

interface BigMeta {
  readonly version: number;
  readonly conversations: number;
  readonly uncompressedBytes: number;
  readonly zipBytes: number;
}

function readBigMeta(metaPath: string, zipPath: string): BigMeta | null {
  if (!existsSync(metaPath) || !existsSync(zipPath)) return null;
  try {
    const meta = JSON.parse(readFileSync(metaPath, "utf8")) as BigMeta;
    const ok =
      meta.version === BIG_GENERATOR_VERSION &&
      meta.conversations === BIG_CONVERSATIONS &&
      meta.uncompressedBytes >= BIG_MIN_UNCOMPRESSED_BYTES &&
      statSync(zipPath).size === meta.zipBytes;
    return ok ? meta : null;
  } catch {
    return null;
  }
}

/**
 * Garante o export grande em e2e/.tmp/grande/conversations-000.zip.
 * Gera em streaming (nunca monta o JSON inteiro em memória: cada conversa
 * de ~535 KB vira bytes, é comprimida e descartada) e reaproveita o arquivo
 * se ele já existir com o tamanho registrado no .meta.json.
 */
export async function ensureBigExport(): Promise<BigExportInfo> {
  const started = Date.now();
  const dir = join(TMP_DIR, "grande");
  mkdirSync(dir, { recursive: true });
  const fileName = "conversations-000.zip";
  const zipPath = join(dir, fileName);
  const metaPath = join(dir, "conversations-000.meta.json");

  const cached = readBigMeta(metaPath, zipPath);
  if (cached) {
    return {
      path: zipPath,
      fileName,
      conversations: cached.conversations,
      uncompressedBytes: cached.uncompressedBytes,
      zipBytes: cached.zipBytes,
      generatedNow: false,
      elapsedMs: Date.now() - started,
    };
  }

  rmSync(metaPath, { force: true });
  const zip = new FileExportZip(zipPath);
  let uncompressedBytes = 0;
  try {
    const entry = zip.openStream("conversations.json", CONVERSATIONS_STYLE);
    entry.push(asciiBytes("["));
    for (let i = 0; i < BIG_CONVERSATIONS; i++) {
      entry.push(asciiBytes((i > 0 ? ", " : "") + conversationJson(bigConversation(i))));
      // devolve o event loop de vez em quando (o worker do Playwright segue vivo)
      if (i % 50 === 49) await new Promise<void>((r) => setImmediate(r));
    }
    entry.push(asciiBytes("]"));
    entry.close();
    uncompressedBytes = entry.size;
    zip.finish();
  } catch (e) {
    zip.abort();
    throw e;
  }

  if (uncompressedBytes < BIG_MIN_UNCOMPRESSED_BYTES) {
    throw new Error(
      `export grande ficou com ${uncompressedBytes} bytes (< ${BIG_MIN_UNCOMPRESSED_BYTES}); ajuste os tamanhos`
    );
  }
  const zipBytes = statSync(zipPath).size;
  const meta: BigMeta = {
    version: BIG_GENERATOR_VERSION,
    conversations: BIG_CONVERSATIONS,
    uncompressedBytes,
    zipBytes,
  };
  writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  return {
    path: zipPath,
    fileName,
    conversations: BIG_CONVERSATIONS,
    uncompressedBytes,
    zipBytes,
    generatedNow: true,
    elapsedMs: Date.now() - started,
  };
}
