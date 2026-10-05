/**
 * Importar Claude — leitura em FLUXO do export (.zip → conversa a conversa).
 *
 * O export novo (`conversations-000.zip`, fim de ago/2026) pode trazer um
 * conversations.json de centenas de MB — 711 MB no histórico completo, acima
 * do limite de string do V8 (~536 milhões de caracteres). Ler o arquivo
 * inteiro como texto e dar um JSON.parse estoura. Aqui nada vira string
 * grande: o ZIP chega aos pedaços, é descompactado em fluxo (fflate `Unzip`)
 * e o array JSON é fatiado em bytes; só cada conversa vira texto e passa
 * pelo JSON.parse, e já sai convertida em nota (o JSON bruto é descartado).
 *
 * Sem dependência de Tauri: o desktop entrega os pedaços via FileHandle
 * (runImport.ts) e o navegador via Blob/File (funções blob* abaixo).
 */
import { Unzip, UnzipInflate, UnzipPassThrough } from "fflate";
import {
  conversationToMarkdown,
  type ClaudeConversation,
  type ImportedNote,
} from "./claudeImport";
import type { ImportProgress } from "./runImport";

/** Entrada do ZIP com as conversas (na raiz ou em subpasta). */
export const CONVERSATIONS_ENTRY_RE = /(^|\/)conversations\.json$/i;

/** Tamanho de cada leitura do arquivo (desktop e navegador). */
export const CHUNK_BYTES = 8 * 1024 * 1024;

// ── Fatiador de JSON em bytes ──────────────────────────────────────────────

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const LBRACE = 0x7b;
const RBRACE = 0x7d;
const LBRACKET = 0x5b;
const RBRACKET = 0x5d;

function concatBytes(parts: Uint8Array[], last: Uint8Array): Uint8Array {
  if (parts.length === 0) return last;
  let len = last.length;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  out.set(last, o);
  return out;
}

/**
 * Recebe um array JSON (ou um objeto único) em pedaços arbitrários e entrega
 * cada objeto de topo, em bytes, para `onObject`.
 * Os caracteres estruturais do JSON são ASCII e nunca aparecem dentro de uma
 * sequência UTF-8 multibyte, então dá para varrer byte a byte sem decodificar.
 */
export class JsonObjectSplitter {
  private readonly onObject: (bytes: Uint8Array) => void;
  private depth = 0;
  /** Profundidade em que os objetos de topo abrem: 1 (raiz array), 0 (raiz objeto), -1 (raiz ainda não vista). */
  private baseDepth = -1;
  private inString = false;
  private escaped = false;
  private inObject = false;
  /** Pedaços já lidos do objeto em andamento (cópias). */
  private parts: Uint8Array[] = [];

  constructor(onObject: (bytes: Uint8Array) => void) {
    this.onObject = onObject;
  }

  push(chunk: Uint8Array): void {
    // Estado em variáveis locais: o laço roda por byte em arquivos de centenas de MB.
    let { depth, baseDepth, inString, escaped, inObject } = this;
    let start = inObject ? 0 : -1;
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === BACKSLASH) escaped = true;
        else if (c === QUOTE) inString = false;
        continue;
      }
      if (c === QUOTE) {
        inString = true;
      } else if (c === LBRACE || c === LBRACKET) {
        if (baseDepth < 0) baseDepth = c === LBRACKET ? 1 : 0;
        if (c === LBRACE && !inObject && depth === baseDepth) {
          inObject = true;
          start = i;
        }
        depth++;
      } else if (c === RBRACE || c === RBRACKET) {
        depth--;
        if (inObject && depth === baseDepth) {
          const bytes = concatBytes(this.parts, chunk.subarray(start, i + 1));
          this.parts = [];
          inObject = false;
          start = -1;
          this.onObject(bytes);
        }
      }
    }
    // O chamador pode reaproveitar o buffer: guarda cópia do pedaço pendente.
    if (inObject && start >= 0) this.parts.push(chunk.slice(start));
    this.depth = depth;
    this.baseDepth = baseDepth;
    this.inString = inString;
    this.escaped = escaped;
    this.inObject = inObject;
  }

  /** Fim do fluxo. Objeto pela metade = arquivo truncado (conversa perdida). */
  end(): void {
    if (this.inObject || this.inString) {
      throw new Error("conversations.json truncado: a última conversa está incompleta");
    }
  }
}

// ── Descompactação em fluxo ────────────────────────────────────────────────

/**
 * Lê um ZIP de export aos pedaços e entrega cada conversa de cada
 * conversations.json encontrado (as outras entradas são puladas sem
 * descompactar). Retorna quantos conversations.json havia.
 * ZIP corrompido ou JSON truncado viram exceção — as conversas entregues até
 * ali continuam válidas.
 */
export async function streamConversationsFromZip(
  chunks: AsyncIterable<Uint8Array>,
  onConversation: (c: ClaudeConversation) => void
): Promise<number> {
  const decoder = new TextDecoder("utf-8");
  let entries = 0;
  let failure: unknown = null;
  const fail = (e: unknown) => {
    if (failure === null) failure = e ?? new Error("falha ao descompactar o ZIP");
  };

  const unzip = new Unzip((file) => {
    if (!CONVERSATIONS_ENTRY_RE.test(file.name)) return; // sem start(): dados pulados
    entries++;
    const splitter = new JsonObjectSplitter((bytes) => {
      onConversation(JSON.parse(decoder.decode(bytes)) as ClaudeConversation);
    });
    file.ondata = (err, data, final) => {
      if (failure !== null) return;
      if (err) return fail(err);
      try {
        splitter.push(data);
        if (final) splitter.end();
      } catch (e) {
        fail(e);
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  unzip.register(UnzipPassThrough);

  for await (const chunk of chunks) {
    unzip.push(chunk);
    if (failure !== null) throw failure;
  }
  unzip.push(new Uint8Array(0), true);
  if (failure !== null) throw failure;
  return entries;
}

// ── Validação rápida (só o diretório central) ──────────────────────────────

/** Acesso aleatório a um arquivo (desktop: seek+read; navegador: Blob.slice). */
export type RandomAccess = {
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
};

const EOCD_SIG = 0x06054b50;
const EOCD64_LOCATOR_SIG = 0x07064b50;
const EOCD64_SIG = 0x06064b50;
const CENTRAL_HEADER_SIG = 0x02014b50;
const EOCD_MIN = 22;
const MAX_CENTRAL_DIR_BYTES = 64 * 1024 * 1024;

function view(b: Uint8Array): DataView {
  return new DataView(b.buffer, b.byteOffset, b.byteLength);
}

function readU64(dv: DataView, offset: number): number {
  return dv.getUint32(offset, true) + dv.getUint32(offset + 4, true) * 2 ** 32;
}

/**
 * Lista os nomes das entradas de um ZIP lendo só o fim do arquivo (EOCD +
 * diretório central, com suporte a ZIP64). Valida um export de centenas de
 * MB em milissegundos, sem descompactar nada. Lança erro se não for ZIP.
 */
export async function listZipEntryNames(file: RandomAccess): Promise<string[]> {
  if (file.size < EOCD_MIN) throw new Error("não é um arquivo ZIP");
  const tailLen = Math.min(file.size, EOCD_MIN + 0xffff);
  const tailStart = file.size - tailLen;
  const tail = await file.read(tailStart, tailLen);
  const tv = view(tail);
  let eocd = -1;
  for (let i = tail.length - EOCD_MIN; i >= 0; i--) {
    if (tv.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("não é um arquivo ZIP");

  const count16 = tv.getUint16(eocd + 10, true);
  let cdSize = tv.getUint32(eocd + 12, true);
  let cdOffset = tv.getUint32(eocd + 16, true);
  if (count16 === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const loc = eocd - 20;
    if (loc < 0 || tv.getUint32(loc, true) !== EOCD64_LOCATOR_SIG) {
      throw new Error("ZIP64 sem localizador");
    }
    const rec = await file.read(readU64(tv, loc + 8), 56);
    const rv = view(rec);
    if (rec.length < 56 || rv.getUint32(0, true) !== EOCD64_SIG) {
      throw new Error("ZIP64 com registro final inválido");
    }
    cdSize = readU64(rv, 40);
    cdOffset = readU64(rv, 48);
  }
  if (cdSize > MAX_CENTRAL_DIR_BYTES || cdOffset + cdSize > file.size) {
    throw new Error("diretório central do ZIP inválido");
  }

  const cd = await file.read(cdOffset, cdSize);
  const cv = view(cd);
  const dec = new TextDecoder("utf-8");
  const names: string[] = [];
  let p = 0;
  while (p + 46 <= cd.length && cv.getUint32(p, true) === CENTRAL_HEADER_SIG) {
    const nameLen = cv.getUint16(p + 28, true);
    const extraLen = cv.getUint16(p + 30, true);
    const commentLen = cv.getUint16(p + 32, true);
    names.push(dec.decode(cd.subarray(p + 46, p + 46 + nameLen)));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

/** O ZIP tem a assinatura de um export do Claude (um conversations.json)? */
export async function isCompatibleExport(file: RandomAccess): Promise<boolean> {
  try {
    return (await listZipEntryNames(file)).some((n) => CONVERSATIONS_ENTRY_RE.test(n));
  } catch {
    return false;
  }
}

// ── Coleta (dedupe + conversão na hora) ────────────────────────────────────

/** Conversa já convertida em nota — só o necessário fica na memória. */
export type CollectedConversation = {
  uuid: string;
  updated: string;
  note: ImportedNote | null;
};

/**
 * Acumula as conversas lidas convertendo cada uma em nota na hora, para não
 * segurar o JSON bruto (thinking, tool_use, memória injetada…) na memória.
 * Deduplica por uuid ficando com a de updated_at mais recente (empate: a
 * primeira lida). Conversas sem uuid nunca colapsam entre si.
 */
export class ConversationCollector {
  read = 0;
  private readonly best = new Map<string, CollectedConversation>();

  add(c: ClaudeConversation): void {
    this.read++;
    const uuid = String(c?.uuid ?? "");
    const updated = String(c?.updated_at ?? "");
    const key = uuid || `sem-uuid-${this.read}`;
    const cur = this.best.get(key);
    if (cur && !(updated > cur.updated)) return;
    this.best.set(key, { uuid, updated, note: conversationToMarkdown(c) });
  }

  get unique(): CollectedConversation[] {
    return [...this.best.values()];
  }
}

/** Um .zip a importar: nome (para a tela), tamanho e leitura sequencial. */
export type ZipSource = {
  name: string;
  size: number;
  chunks(): AsyncIterable<Uint8Array>;
};

function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(0);
}

async function* countingChunks(
  chunks: AsyncIterable<Uint8Array>,
  onChunk: (bytes: number) => void
): AsyncIterable<Uint8Array> {
  for await (const c of chunks) {
    yield c;
    onChunk(c.length);
  }
}

/**
 * Lê todos os .zip em sequência e coleta as conversas (partes -000/-001 e
 * batches antigos entram juntos; o dedupe resolve sobreposição).
 * Um .zip que falhe não derruba os outros: o nome vai para `failed`.
 */
export async function collectConversations(
  sources: ZipSource[],
  onProgress?: (p: ImportProgress) => void
): Promise<{ collector: ConversationCollector; failed: string[] }> {
  const collector = new ConversationCollector();
  const failed: string[] = [];
  for (let zi = 0; zi < sources.length; zi++) {
    const src = sources[zi];
    const label = `Lendo ZIP ${zi + 1}/${sources.length} — ${src.name}`;
    let done = 0;
    onProgress?.({ phase: label, done: 0, total: src.size });
    try {
      const counted = countingChunks(src.chunks(), (n) => {
        done += n;
        onProgress?.({
          phase: `${label} (${mb(done)} de ${mb(src.size)} MB · ${collector.read} conversas)`,
          done,
          total: src.size,
        });
      });
      await streamConversationsFromZip(counted, (c) => collector.add(c));
    } catch (e) {
      console.error("[import] falha ao ler", src.name, e);
      failed.push(src.name);
    }
  }
  return { collector, failed };
}

// ── Fontes no navegador (Blob/File) ────────────────────────────────────────

/** Acesso aleatório sobre um Blob/File (validação pelo diretório central). */
export function blobRandomAccess(blob: Blob): RandomAccess {
  return {
    size: blob.size,
    read: async (offset, length) =>
      new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer()),
  };
}

/** Leitura sequencial de um Blob/File em pedaços de CHUNK_BYTES. */
export function blobZipSource(name: string, blob: Blob): ZipSource {
  return {
    name,
    size: blob.size,
    chunks: async function* () {
      for (let o = 0; o < blob.size; o += CHUNK_BYTES) {
        yield new Uint8Array(await blob.slice(o, o + CHUNK_BYTES).arrayBuffer());
      }
    },
  };
}
