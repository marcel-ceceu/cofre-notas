import { unzipSync, strFromU8 } from "fflate";

/**
 * Descompacta o ZIP em memória e retorna o conteúdo de todos os
 * `conversations.json` encontrados (suporta export com subpastas).
 */
export function extractConversationsJson(zipBytes: Uint8Array): string[] {
  const files = unzipSync(zipBytes);
  const out: string[] = [];
  for (const name of Object.keys(files)) {
    if (/conversations\.json$/i.test(name)) {
      out.push(strFromU8(files[name]));
    }
  }
  return out;
}
