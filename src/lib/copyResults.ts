import type { Note } from "./fileSystem";

export type LinkStyle = "none" | "wiki" | "markdown";
export type ListPrefix = "none" | "bullet" | "number";

/**
 * Formata uma lista de notas para a área de transferência.
 * Defaults (true, "none", "none") = caminhos, um por linha — o "Copiar caminhos".
 */
export function formatResults(
  notes: Note[],
  showPath: boolean,
  linkStyle: LinkStyle,
  listPrefix: ListPrefix
): string {
  return notes
    .map((n, i) => {
      const display = showPath ? n.path : n.name;
      let line = display;
      if (linkStyle === "wiki") line = `[[${display}]]`;
      else if (linkStyle === "markdown") line = `[${display}](${n.path})`;
      if (listPrefix === "bullet") line = `- ${line}`;
      else if (listPrefix === "number") line = `${i + 1}. ${line}`;
      return line;
    })
    .join("\n");
}

/** Copia texto para a área de transferência, com fallback (textarea + execCommand). */
export async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // fallback abaixo
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.top = "-1000px";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(ta);
  }
}
