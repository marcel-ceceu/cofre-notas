import { describe, it, expect } from "vitest";
import { Zip, ZipDeflate, zipSync, strToU8 } from "fflate";
import {
  JsonObjectSplitter,
  streamConversationsFromZip,
  listZipEntryNames,
  isCompatibleExport,
  ConversationCollector,
  collectConversations,
  blobRandomAccess,
  blobZipSource,
  type ZipSource,
} from "./exportStream";
import type { ClaudeConversation } from "./claudeImport";

// ── Fixtures no formato REAL do export (set/2026) ─────────────────────────

/** JSON como o export escreve: não-ASCII em \uXXXX, separadores ", " e ": ". */
function pyJson(v: unknown): string {
  return JSON.stringify(v)
    .replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"))
    .replace(/","/g, '", "')
    .replace(/":/g, '": ');
}

function conv(
  uuid: string,
  name: string,
  updated: string,
  humanText: string,
  assistantText: string
): ClaudeConversation {
  const ts = { start_timestamp: updated, stop_timestamp: updated, flags: null };
  // Formato real tem mais campos do que o tipo do importador declara.
  const real: unknown = {
    uuid,
    name,
    summary: "",
    created_at: "2026-09-01T10:00:00.000000Z",
    updated_at: updated,
    account: { uuid: "acc" },
    chat_messages: [
      {
        uuid: uuid + "-h",
        text: humanText,
        content: [
          {
            ...ts,
            type: "injected_prompt_block",
            prompt:
              '<system-reminder>\n<user_memory_snapshot version="abc">memoria secreta</user_memory_snapshot>\n</system-reminder>',
            injection_source: "memory",
            initial_turn_only: true,
            skip_on_truncated_continuation: false,
          },
          { ...ts, type: "text", text: humanText, citations: [] },
        ],
        sender: "human",
        created_at: "2026-09-01T10:00:00.000000Z",
        updated_at: updated,
        attachments: [],
        files: [],
        parent_message_uuid: "00000000-0000-4000-8000-000000000000",
      },
      {
        uuid: uuid + "-a",
        text: "",
        content: [
          { ...ts, type: "thinking", thinking: "pensamento interno", summaries: [], cut_off: false },
          { ...ts, type: "tool_use", name: "web_search", input: { query: "x" } },
          {
            ...ts,
            type: "tool_result",
            name: "web_search",
            content: [{ type: "text", text: "resultado da ferramenta" }],
            is_error: false,
          },
          { ...ts, type: "text", text: assistantText, citations: [] },
        ],
        sender: "assistant",
        created_at: "2026-09-01T10:01:00.000000Z",
        updated_at: updated,
        attachments: [],
        files: [],
        parent_message_uuid: uuid + "-h",
      },
    ],
  };
  return real as ClaudeConversation;
}

const C1 = conv("u-1", "Otimização do painel", "2026-09-02T10:00:00Z", "Pergunta { com } chaves", 'Resposta com "aspas" e \\ barra');
const C2 = conv("u-2", "Ação ✓ 😀", "2026-09-03T10:00:00Z", "oi", "olá");
const C2_NOVA = conv("u-2", "Ação ✓ 😀", "2026-09-04T10:00:00Z", "oi", "olá — versão nova");

const enc = (s: string) => strToU8(s);

async function* chunksOf(bytes: Uint8Array, size: number): AsyncIterable<Uint8Array> {
  for (let i = 0; i < bytes.length; i += size) yield bytes.slice(i, i + size);
}

/** ZIP escrito em fluxo (fflate Zip): entradas com data descriptor, sem tamanho no cabeçalho local. */
function streamingZip(entries: Record<string, Uint8Array>): Uint8Array {
  const out: Uint8Array[] = [];
  const z = new Zip((err, data) => {
    if (err) throw err;
    out.push(data);
  });
  for (const [name, data] of Object.entries(entries)) {
    const f = new ZipDeflate(name, { level: 6 });
    z.add(f);
    // empurra em pedaços para simular escrita incremental
    for (let i = 0; i < data.length; i += 1000) f.push(data.slice(i, i + 1000), false);
    f.push(new Uint8Array(0), true);
  }
  z.end();
  const len = out.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(len);
  let o = 0;
  for (const p of out) {
    buf.set(p, o);
    o += p.length;
  }
  return buf;
}

/** Converte um ZIP comum em ZIP64 (EOCD64 + localizador + EOCD com sentinelas). */
function toZip64(zip: Uint8Array): Uint8Array {
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = zip.length - 22; // sem comentário
  const count = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  const body = zip.slice(0, eocd);
  const out = new Uint8Array(body.length + 56 + 20 + 22);
  out.set(body, 0);
  const o = new DataView(out.buffer);
  const r64 = body.length;
  o.setUint32(r64, 0x06064b50, true);
  o.setUint32(r64 + 4, 44, true); // tamanho do registro (u64, parte baixa)
  o.setUint16(r64 + 12, 45, true);
  o.setUint16(r64 + 14, 45, true);
  o.setUint32(r64 + 24, count, true);
  o.setUint32(r64 + 32, count, true);
  o.setUint32(r64 + 40, cdSize, true);
  o.setUint32(r64 + 48, cdOffset, true);
  const loc = r64 + 56;
  o.setUint32(loc, 0x07064b50, true);
  o.setUint32(loc + 8, r64, true);
  o.setUint32(loc + 16, 1, true);
  const e = loc + 20;
  o.setUint32(e, 0x06054b50, true);
  o.setUint16(e + 8, 0xffff, true);
  o.setUint16(e + 10, 0xffff, true);
  o.setUint32(e + 12, 0xffffffff, true);
  o.setUint32(e + 16, 0xffffffff, true);
  return out;
}

/** Acrescenta um comentário de arquivo (fim do EOCD) — desloca o EOCD para trás. */
function withArchiveComment(zip: Uint8Array, text: string): Uint8Array {
  const c = enc(text);
  const out = new Uint8Array(zip.length + c.length);
  out.set(zip, 0);
  out.set(c, zip.length);
  new DataView(out.buffer).setUint16(zip.length - 22 + 20, c.length, true);
  return out;
}

function bytesAccess(b: Uint8Array) {
  return {
    size: b.length,
    read: async (offset: number, length: number) => b.slice(offset, offset + length),
  };
}

// ── JsonObjectSplitter ─────────────────────────────────────────────────────

describe("JsonObjectSplitter", () => {
  const TRICKY = [
    { a: "}", b: "{", c: "]", d: "[" },
    { s: 'aspas \" e barra \\ e \\" seguidas', n: [1, [2, { x: "}" }]] },
    { u: "ação ✓ 😀 — multibyte cru", e: "ç" },
    {},
    { last: true },
  ];
  const DOC = enc(" \n[ " + TRICKY.map((t) => JSON.stringify(t)).join(" ,\n ") + " ] \n");

  function split(bytes: Uint8Array, chunkSize: number): unknown[] {
    const got: unknown[] = [];
    const dec = new TextDecoder();
    const s = new JsonObjectSplitter((b) => got.push(JSON.parse(dec.decode(b))));
    for (let i = 0; i < bytes.length; i += chunkSize) s.push(bytes.slice(i, i + chunkSize));
    s.end();
    return got;
  }

  it("fatia um array em objetos de topo", () => {
    expect(split(DOC, DOC.length)).toEqual(TRICKY);
  });

  it("dá o mesmo resultado com qualquer fronteira de pedaço (inclusive byte a byte)", () => {
    for (const size of [1, 2, 3, 5, 7, 13, 64]) {
      expect(split(DOC, size)).toEqual(TRICKY);
    }
  });

  it("aceita um objeto único na raiz (export de uma conversa só)", () => {
    expect(split(enc(JSON.stringify(TRICKY[1])), 4)).toEqual([TRICKY[1]]);
  });

  it("array vazio não emite nada", () => {
    expect(split(enc("[]"), 1)).toEqual([]);
  });

  it("acusa arquivo truncado no meio de um objeto", () => {
    const s = new JsonObjectSplitter(() => {});
    s.push(enc('[{"a": 1}, {"b": "meio'));
    expect(() => s.end()).toThrow(/truncado/);
  });
});

// ── streamConversationsFromZip ─────────────────────────────────────────────

describe("streamConversationsFromZip", () => {
  const JSON_NOVO = enc(pyJson([C1, C2]));

  async function readAll(zip: Uint8Array, chunkSize = 7_000) {
    const got: ClaudeConversation[] = [];
    const entries = await streamConversationsFromZip(chunksOf(zip, chunkSize), (c) => got.push(c));
    return { entries, got };
  }

  it("lê o formato novo (conversations-000.zip só com conversations.json)", async () => {
    const { entries, got } = await readAll(zipSync({ "conversations.json": JSON_NOVO }));
    expect(entries).toBe(1);
    expect(got.map((c) => c.uuid)).toEqual(["u-1", "u-2"]);
    expect(got[1].name).toBe("Ação ✓ 😀");
  });

  it("lê o formato antigo (data-*.zip com projects/, memories.json…) usando só conversations.json", async () => {
    const zip = zipSync({
      "users.json": enc('[{"uuid": "x"}]'),
      "projects/019a.json": enc('{"uuid": "p", "docs": [{"content": "não é conversa"}]}'),
      "memories.json": enc('[{"conversations_memory": "..."}]'),
      "conversations.json": JSON_NOVO,
    });
    const { entries, got } = await readAll(zip);
    expect(entries).toBe(1);
    expect(got).toHaveLength(2);
  });

  it("lê ZIP escrito em fluxo (data descriptor) com outra entrada antes", async () => {
    const zip = streamingZip({ "users.json": enc('[{"uuid": "x"}]'), "conversations.json": JSON_NOVO });
    const { entries, got } = await readAll(zip, 333);
    expect(entries).toBe(1);
    expect(got.map((c) => c.uuid)).toEqual(["u-1", "u-2"]);
  });

  it("lê entrada sem compressão (stored)", async () => {
    const zip = zipSync({ "conversations.json": [JSON_NOVO, { level: 0 }] });
    const { got } = await readAll(zip);
    expect(got).toHaveLength(2);
  });

  it("aceita conversations.json em subpasta e ignora nomes parecidos", async () => {
    const zip = zipSync({
      "export/conversations.json": JSON_NOVO,
      "shared_conversations.json": enc(pyJson([C2_NOVA])),
    });
    const { entries, got } = await readAll(zip);
    expect(entries).toBe(1);
    expect(got).toHaveLength(2);
  });

  it("ZIP sem conversations.json não emite nada", async () => {
    const { entries, got } = await readAll(zipSync({ "outro.json": enc("[]") }));
    expect(entries).toBe(0);
    expect(got).toEqual([]);
  });

  it("JSON truncado vira erro (as conversas anteriores já foram entregues)", async () => {
    const cut = JSON_NOVO.slice(0, JSON_NOVO.length - 40);
    const got: ClaudeConversation[] = [];
    await expect(
      streamConversationsFromZip(chunksOf(zipSync({ "conversations.json": cut }), 500), (c) => got.push(c))
    ).rejects.toThrow(/truncado/);
    expect(got.map((c) => c.uuid)).toEqual(["u-1"]);
  });
});

// ── listZipEntryNames / isCompatibleExport ────────────────────────────────

describe("listZipEntryNames", () => {
  it("lista as entradas lendo só o diretório central", async () => {
    const zip = zipSync({ "users.json": enc("[]"), "projects/a.json": enc("{}"), "conversations.json": enc("[]") });
    expect((await listZipEntryNames(bytesAccess(zip))).sort()).toEqual(
      ["conversations.json", "projects/a.json", "users.json"]
    );
  });

  it("funciona com comentário de arquivo e de entrada", async () => {
    const zip = withArchiveComment(
      zipSync({ "conversations.json": enc("[]"), "b.txt": enc("b") }, { comment: "comentário da entrada" }),
      "export do claude"
    );
    expect((await listZipEntryNames(bytesAccess(zip))).sort()).toEqual(["b.txt", "conversations.json"]);
  });

  it("funciona com ZIP64", async () => {
    const zip = toZip64(zipSync({ "a.txt": enc("a"), "conversations.json": enc("[]") }));
    expect((await listZipEntryNames(bytesAccess(zip))).sort()).toEqual(["a.txt", "conversations.json"]);
  });

  it("funciona com ZIP escrito em fluxo", async () => {
    const zip = streamingZip({ "conversations.json": enc("[]") });
    expect(await listZipEntryNames(bytesAccess(zip))).toEqual(["conversations.json"]);
  });

  it("recusa o que não é ZIP", async () => {
    await expect(listZipEntryNames(bytesAccess(enc("não sou zip")))).rejects.toThrow();
  });
});

describe("isCompatibleExport", () => {
  it("aceita export novo e antigo; recusa zip qualquer e lixo", async () => {
    expect(await isCompatibleExport(bytesAccess(zipSync({ "conversations.json": enc("[]") })))).toBe(true);
    expect(
      await isCompatibleExport(bytesAccess(zipSync({ "users.json": enc("[]"), "conversations.json": enc("[]") })))
    ).toBe(true);
    expect(await isCompatibleExport(bytesAccess(zipSync({ "fotos/a.jpg": enc("x") })))).toBe(false);
    expect(await isCompatibleExport(bytesAccess(enc("lixo")))).toBe(false);
  });

  it("funciona sobre Blob/File (caminho do navegador)", async () => {
    const zip = zipSync({ "conversations.json": enc("[]") });
    expect(await isCompatibleExport(blobRandomAccess(new Blob([zip])))).toBe(true);
  });
});

// ── ConversationCollector / collectConversations ───────────────────────────

describe("ConversationCollector", () => {
  it("converte na hora e deduplica por uuid ficando com o updated_at mais novo", () => {
    const col = new ConversationCollector();
    col.add(C2);
    col.add(C1);
    col.add(C2_NOVA);
    col.add(C2); // mais velha depois da nova: ignorada
    expect(col.read).toBe(4);
    const byUuid = new Map(col.unique.map((u) => [u.uuid, u]));
    expect(byUuid.size).toBe(2);
    expect(byUuid.get("u-2")?.updated).toBe("2026-09-04T10:00:00Z");
    expect(byUuid.get("u-2")?.note?.content).toContain("versão nova");
  });

  it("empate de updated_at mantém a primeira lida", () => {
    const col = new ConversationCollector();
    col.add(conv("u-9", "A", "2026-09-01T00:00:00Z", "primeira", "x"));
    col.add(conv("u-9", "A", "2026-09-01T00:00:00Z", "segunda", "x"));
    expect(col.unique[0].note?.content).toContain("primeira");
  });

  it("conversas sem uuid não colapsam entre si", () => {
    const col = new ConversationCollector();
    col.add({ name: "a", chat_messages: [{ sender: "human", text: "1" }] });
    col.add({ name: "b", chat_messages: [{ sender: "human", text: "2" }] });
    expect(col.unique).toHaveLength(2);
    expect(col.unique.every((u) => u.uuid === "")).toBe(true);
  });

  it("nota não leva memória injetada, thinking nem saída de ferramenta", () => {
    const col = new ConversationCollector();
    col.add(C1);
    const md = col.unique[0].note?.content ?? "";
    expect(md).toContain("Pergunta { com } chaves");
    expect(md).toContain('Resposta com "aspas" e \\ barra');
    expect(md).not.toContain("user_memory_snapshot");
    expect(md).not.toContain("memoria secreta");
    expect(md).not.toContain("pensamento interno");
    expect(md).not.toContain("resultado da ferramenta");
  });

  it("conversa vazia vira note null", () => {
    const col = new ConversationCollector();
    col.add({ uuid: "v", updated_at: "x", chat_messages: [] });
    expect(col.unique[0].note).toBeNull();
  });
});

describe("collectConversations", () => {
  it("junta as partes -000/-001, deduplica e reporta progresso em bytes", async () => {
    const p0 = blobZipSource("conversations-000.zip", new Blob([zipSync({ "conversations.json": enc(pyJson([C1, C2])) })]));
    const p1 = blobZipSource("conversations-001.zip", new Blob([zipSync({ "conversations.json": enc(pyJson([C2_NOVA])) })]));
    const phases: string[] = [];
    let lastDone = 0;
    const r = await collectConversations([p0, p1], (p) => {
      phases.push(p.phase);
      lastDone = p.done;
    });
    expect(r.failed).toEqual([]);
    expect(r.collector.read).toBe(3);
    expect(r.collector.unique).toHaveLength(2);
    expect(phases.some((p) => p.includes("conversations-001.zip"))).toBe(true);
    expect(lastDone).toBeGreaterThan(0);
  });

  it("um ZIP ruim não derruba os outros: vai para failed", async () => {
    const ok = blobZipSource("conversations-000.zip", new Blob([zipSync({ "conversations.json": enc(pyJson([C1])) })]));
    const bad: ZipSource = {
      name: "quebrado.zip",
      size: 10,
      chunks: async function* () {
        yield enc("PK\u0003\u0004 lixo lixo lixo");
        throw new Error("falha de leitura");
      },
    };
    const r = await collectConversations([bad, ok]);
    expect(r.failed).toEqual(["quebrado.zip"]);
    expect(r.collector.unique.map((u) => u.uuid)).toEqual(["u-1"]);
  });
});
