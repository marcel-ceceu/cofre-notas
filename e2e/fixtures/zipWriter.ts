/**
 * Escritor de ZIP que imita o layout binário do export REAL do Claude.ai.
 *
 * Conferido nos headers (só metadados, nunca o conteúdo) de exports reais:
 * - `conversations.json` (export novo `conversations-000.zip` e também o
 *   antigo `data-*-batch-0000.zip`): local header versão 45, flags 0, método 8
 *   (deflate), tamanhos 0xFFFFFFFF no local header + extra ZIP64 (id 0x0001,
 *   16 bytes: tamanho original, tamanho comprimido), CRC real no local header,
 *   SEM data descriptor, data DOS zerada (1980-01-01 00:00). No central
 *   directory: tamanhos reais de 32 bits, sem extra, "made by" 0x032d.
 *   É o que o `zipfile` do Python grava com `force_zip64=True` em arquivo
 *   com seek (ele volta e corrige o local header no fim).
 * - Demais arquivos do export antigo (users.json, projects.json,
 *   memories.json): local header versão 20, tamanhos normais.
 *
 * Duas formas de uso:
 * - `buildExportZip(entries)`: tudo em memória (zips pequenos dos testes);
 * - `FileExportZip`: grava em disco em streaming (export grande), corrigindo
 *   o local header no fim com escrita posicional, como o Python faz.
 */
import { closeSync, openSync, renameSync, writeSync } from "node:fs";
import { crc32 } from "node:zlib";
import { Deflate, deflateSync, strToU8 } from "fflate";

export interface EntryStyle {
  /** Local header no estilo do conversations.json real (extra ZIP64, versão 45). */
  readonly zip64LocalHeader: boolean;
  readonly dosTime: number;
  readonly dosDate: number;
}

/** Estilo do `conversations.json` real (data DOS 33 = 1980-01-01, hora 0). */
export const CONVERSATIONS_STYLE: EntryStyle = {
  zip64LocalHeader: true,
  dosTime: 0,
  dosDate: 33,
};

/** Estilo dos demais JSONs do export antigo (valores copiados de um export real). */
export const PLAIN_STYLE: EntryStyle = {
  zip64LocalHeader: false,
  dosTime: 45115,
  dosDate: 23696,
};

export interface ZipEntryInput {
  readonly name: string;
  readonly data: Uint8Array;
  readonly style: EntryStyle;
}

interface CentralRecord {
  readonly name: Uint8Array;
  readonly style: EntryStyle;
  readonly crc: number;
  readonly compressedSize: number;
  readonly size: number;
  readonly offset: number;
}

interface Sink {
  write(chunk: Uint8Array): void;
  writeAt(position: number, chunk: Uint8Array): void;
}

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const ZIP64_EXTRA_ID = 0x0001;
const ZIP64_EXTRA_LEN = 16;
const DEFLATE = 8;
const UNIX_RW_OWNER_ATTR = 0x01800000; // 0o600 << 16, igual ao export real
const MAX_U32 = 0xffffffff;
const DEFLATE_LEVEL = 6;

function localHeaderLength(nameLength: number, style: EntryStyle): number {
  return 30 + nameLength + (style.zip64LocalHeader ? 4 + ZIP64_EXTRA_LEN : 0);
}

function localHeader(
  name: Uint8Array,
  style: EntryStyle,
  crc: number,
  compressedSize: number,
  size: number
): Uint8Array {
  const out = new Uint8Array(localHeaderLength(name.length, style));
  const v = new DataView(out.buffer);
  v.setUint32(0, LOCAL_SIG, true);
  v.setUint16(4, style.zip64LocalHeader ? 45 : 20, true);
  v.setUint16(6, 0, true); // flags: sem data descriptor, nome ASCII
  v.setUint16(8, DEFLATE, true);
  v.setUint16(10, style.dosTime, true);
  v.setUint16(12, style.dosDate, true);
  v.setUint32(14, crc, true);
  v.setUint32(18, style.zip64LocalHeader ? MAX_U32 : compressedSize, true);
  v.setUint32(22, style.zip64LocalHeader ? MAX_U32 : size, true);
  v.setUint16(26, name.length, true);
  v.setUint16(28, style.zip64LocalHeader ? 4 + ZIP64_EXTRA_LEN : 0, true);
  out.set(name, 30);
  if (style.zip64LocalHeader) {
    const e = 30 + name.length;
    v.setUint16(e, ZIP64_EXTRA_ID, true);
    v.setUint16(e + 2, ZIP64_EXTRA_LEN, true);
    v.setBigUint64(e + 4, BigInt(size), true);
    v.setBigUint64(e + 12, BigInt(compressedSize), true);
  }
  return out;
}

function centralHeader(r: CentralRecord): Uint8Array {
  if (r.size >= MAX_U32 || r.compressedSize >= MAX_U32 || r.offset >= MAX_U32) {
    throw new Error("zipWriter: entrada >= 4 GB não suportada (o export real não usa ZIP64 no central directory)");
  }
  const out = new Uint8Array(46 + r.name.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, CENTRAL_SIG, true);
  v.setUint16(4, r.style.zip64LocalHeader ? 0x032d : 0x0314, true);
  v.setUint16(6, r.style.zip64LocalHeader ? 45 : 20, true);
  v.setUint16(8, 0, true);
  v.setUint16(10, DEFLATE, true);
  v.setUint16(12, r.style.dosTime, true);
  v.setUint16(14, r.style.dosDate, true);
  v.setUint32(16, r.crc, true);
  v.setUint32(20, r.compressedSize, true);
  v.setUint32(24, r.size, true);
  v.setUint16(28, r.name.length, true);
  // 30 extra, 32 comentário, 34 disco, 36 atributos internos: zero
  v.setUint32(38, UNIX_RW_OWNER_ATTR, true);
  v.setUint32(42, r.offset, true);
  out.set(r.name, 46);
  return out;
}

function endOfCentralDirectory(count: number, size: number, offset: number): Uint8Array {
  const out = new Uint8Array(22);
  const v = new DataView(out.buffer);
  v.setUint32(0, EOCD_SIG, true);
  v.setUint16(8, count, true);
  v.setUint16(10, count, true);
  v.setUint32(12, size, true);
  v.setUint32(16, offset, true);
  return out;
}

/** Entrada sendo gravada em streaming (o conteúdo chega em pedaços). */
export interface ZipEntryStream {
  push(chunk: Uint8Array): void;
  close(): void;
  /** Bytes NÃO comprimidos recebidos até agora. */
  readonly size: number;
}

class ExportZipWriter {
  private offset = 0;
  private readonly central: CentralRecord[] = [];

  constructor(private readonly sink: Sink) {}

  private emit(chunk: Uint8Array): void {
    this.sink.write(chunk);
    this.offset += chunk.length;
  }

  addFile(entry: ZipEntryInput): void {
    const compressed = deflateSync(entry.data, { level: DEFLATE_LEVEL });
    const crc = crc32(entry.data) >>> 0;
    const name = strToU8(entry.name);
    const offset = this.offset;
    this.emit(localHeader(name, entry.style, crc, compressed.length, entry.data.length));
    this.emit(compressed);
    this.central.push({
      name,
      style: entry.style,
      crc,
      compressedSize: compressed.length,
      size: entry.data.length,
      offset,
    });
  }

  openStream(entryName: string, style: EntryStyle): ZipEntryStream {
    const name = strToU8(entryName);
    const offset = this.offset;
    // Local header provisório (CRC/tamanhos zerados), corrigido no close().
    this.emit(localHeader(name, style, 0, 0, 0));
    let crc = 0;
    let size = 0;
    let compressedSize = 0;
    let closed = false;
    const deflate = new Deflate({ level: DEFLATE_LEVEL }, (chunk) => {
      compressedSize += chunk.length;
      this.emit(chunk);
    });
    return {
      push: (chunk: Uint8Array) => {
        if (closed) throw new Error("zipWriter: push após close");
        crc = crc32(chunk, crc) >>> 0;
        size += chunk.length;
        deflate.push(chunk, false);
      },
      close: () => {
        if (closed) return;
        closed = true;
        deflate.push(new Uint8Array(0), true);
        this.sink.writeAt(offset, localHeader(name, style, crc, compressedSize, size));
        this.central.push({ name, style, crc, compressedSize, size, offset });
      },
      get size() {
        return size;
      },
    };
  }

  finish(): void {
    const cdOffset = this.offset;
    for (const r of this.central) this.emit(centralHeader(r));
    this.emit(endOfCentralDirectory(this.central.length, this.offset - cdOffset, cdOffset));
  }
}

class MemorySink implements Sink {
  private readonly chunks: Uint8Array[] = [];
  private readonly patches: Array<{ position: number; data: Uint8Array }> = [];
  private length = 0;

  write(chunk: Uint8Array): void {
    this.chunks.push(chunk.slice());
    this.length += chunk.length;
  }

  writeAt(position: number, data: Uint8Array): void {
    this.patches.push({ position, data: data.slice() });
  }

  toBytes(): Uint8Array {
    const out = new Uint8Array(this.length);
    let p = 0;
    for (const c of this.chunks) {
      out.set(c, p);
      p += c.length;
    }
    for (const patch of this.patches) out.set(patch.data, patch.position);
    return out;
  }
}

/** Grava sempre com posição explícita (não depende do ponteiro do arquivo no Windows). */
class FileSink implements Sink {
  private position = 0;

  constructor(private readonly fd: number) {}

  write(chunk: Uint8Array): void {
    let done = 0;
    while (done < chunk.length) {
      done += writeSync(this.fd, chunk, done, chunk.length - done, this.position + done);
    }
    this.position += chunk.length;
  }

  writeAt(position: number, chunk: Uint8Array): void {
    let done = 0;
    while (done < chunk.length) {
      done += writeSync(this.fd, chunk, done, chunk.length - done, position + done);
    }
  }
}

/** Monta em memória um zip no layout do export real. */
export function buildExportZip(entries: readonly ZipEntryInput[]): Uint8Array {
  const sink = new MemorySink();
  const writer = new ExportZipWriter(sink);
  for (const e of entries) writer.addFile(e);
  writer.finish();
  return sink.toBytes();
}

/**
 * Zip gravado em disco em streaming. Escreve em `<destino>.partial` e só
 * renomeia para o destino no `finish()` — um cache pela metade nunca é
 * confundido com um arquivo pronto.
 */
export class FileExportZip {
  private readonly fd: number;
  private readonly writer: ExportZipWriter;
  private readonly partialPath: string;
  private done = false;

  constructor(private readonly destPath: string) {
    this.partialPath = `${destPath}.partial`;
    this.fd = openSync(this.partialPath, "w");
    this.writer = new ExportZipWriter(new FileSink(this.fd));
  }

  openStream(entryName: string, style: EntryStyle): ZipEntryStream {
    return this.writer.openStream(entryName, style);
  }

  finish(): void {
    if (this.done) return;
    this.done = true;
    this.writer.finish();
    closeSync(this.fd);
    renameSync(this.partialPath, this.destPath);
  }

  abort(): void {
    if (this.done) return;
    this.done = true;
    closeSync(this.fd);
  }
}
