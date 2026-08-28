/**
 * MD5 puro sobre os bytes UTF-8 de uma string.
 *
 * Precisa bater exatamente com o `md5(conteudo)` do Postgres (coluna gerada
 * hash_conteudo). Postgres calcula o md5 dos bytes UTF-8 do texto e devolve
 * hex minúsculo — é o que esta função reproduz. Usado no dry-run para pular
 * conversas idênticas (evita reescrever à toa).
 *
 * O navegador (SubtleCrypto) não oferece MD5, por isso a implementação própria.
 */

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5,
  9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11,
  16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15,
  21,
];

const K = [
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a,
  0xa8304613, 0xfd469501, 0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
  0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821, 0xf61e2562, 0xc040b340,
  0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8,
  0x676f02d9, 0x8d2a4c8a, 0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
  0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70, 0x289b7ec6, 0xeaa127fa,
  0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92,
  0xffeff47d, 0x85845dd1, 0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
  0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
];

function rotl(x: number, c: number): number {
  return ((x << c) | (x >>> (32 - c))) >>> 0;
}

function toHexLe(word: number): string {
  let out = "";
  for (let i = 0; i < 4; i++) {
    const b = (word >>> (i * 8)) & 0xff;
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

function md5Bytes(msg: Uint8Array): string {
  const n = msg.length;
  const totalLen = (((n + 8) >> 6) + 1) * 64;
  const bytes = new Uint8Array(totalLen);
  bytes.set(msg);
  bytes[n] = 0x80;

  const bitLen = n * 8;
  const lenPos = totalLen - 8;
  bytes[lenPos] = bitLen & 0xff;
  bytes[lenPos + 1] = (bitLen >>> 8) & 0xff;
  bytes[lenPos + 2] = (bitLen >>> 16) & 0xff;
  bytes[lenPos + 3] = (bitLen >>> 24) & 0xff;
  const hi = Math.floor(bitLen / 0x100000000);
  bytes[lenPos + 4] = hi & 0xff;
  bytes[lenPos + 5] = (hi >>> 8) & 0xff;
  bytes[lenPos + 6] = (hi >>> 16) & 0xff;
  bytes[lenPos + 7] = (hi >>> 24) & 0xff;

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const m = new Int32Array(16);
  for (let off = 0; off < totalLen; off += 64) {
    for (let i = 0; i < 16; i++) {
      const j = off + i * 4;
      m[i] =
        bytes[j] |
        (bytes[j + 1] << 8) |
        (bytes[j + 2] << 16) |
        (bytes[j + 3] << 24);
    }

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) & 15;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) & 15;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) & 15;
      }
      f = (f + a + K[i] + m[g]) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + rotl(f, S[i])) >>> 0;
    }

    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  return toHexLe(a0) + toHexLe(b0) + toHexLe(c0) + toHexLe(d0);
}

/** md5 hex (minúsculo) dos bytes UTF-8 de `input` — igual ao md5() do Postgres. */
export function md5Hex(input: string): string {
  return md5Bytes(new TextEncoder().encode(input));
}
