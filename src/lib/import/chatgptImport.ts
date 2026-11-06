/**
 * Importar ChatGPT — passos 2 e 3 depois do download (funções PURAS, sem I/O).
 * Entrada: os .md que o exportador (src-tauri/chatgpt_export.js) gravou em
 * D:\915_CofreNotas-Conversas\1_Chatgpt. Saída: o plano do que vai para o cofre.
 *
 * - Aceita o padrão do Cofre (exportador 1.3.0+) e converte o formato antigo
 *   (1.0–1.2: `id:`/`titulo:`/`alterado:` + `### Você — …`), para não ser
 *   preciso exportar tudo de novo.
 * - Duplicatas: mesma conversa (uuid) mais de uma vez na pasta → fica a de
 *   `updated` mais novo; contra o cofre → mesma regra do Claude/Cursor
 *   (uuid igual + `updated` igual = já está em dia).
 * A gravação (com remoção de cortesias) fica em runChatgptImport.ts.
 */
import { headerStatus, parseFrontmatter, REQUIRED_KEYS } from "./frontmatter";
import { datePrefix, slugify, type ImportedNote } from "./claudeImport";

export type OriginalChatgpt = { nome: string; raw: string };

export type ChatgptStatus =
  | "nova" // não está no cofre
  | "alterada" // está no cofre, mas a conversa mudou
  | "em-dia" // já está no cofre na mesma versão
  | "duplicada" // a mesma conversa aparece em outro arquivo mais novo da pasta
  | "fora-do-padrao" // não deu para ler como conversa do ChatGPT
  | "vazia"; // sem nenhum turno

export type ChatgptItem = {
  nome: string;
  status: ChatgptStatus;
  title: string;
  uuid: string;
  created: string;
  updated: string;
  /** nota já no padrão do Cofre (antes da limpeza de cortesias) */
  note: ImportedNote | null;
  /** veio no formato antigo e foi convertida */
  convertida: boolean;
  /** por que ficou de fora (fora-do-padrao / duplicada) */
  motivo?: string;
  /** importa, mas vale saber */
  aviso?: string;
};

type Convertida = {
  content: string;
  title: string;
  uuid: string;
  created: string;
  updated: string;
  convertida: boolean;
};

const TURNO_ANTIGO = /^### (Você|ChatGPT)(?: — (\S+))?[ \t]*$/gm;
const TURNO = /^## (?:👤 You|🤖 ChatGPT) \*\(/gm;
const RESPOSTA = /^## 🤖 ChatGPT \*\(/m;
/** Chaves do formato antigo que viram as chaves do padrão. */
const CHAVES_ANTIGAS = new Set(["id", "titulo", "criado", "alterado"]);

const semAspas = (v: string): string => v.replace(/^"(.*)"$/, "$1");
const hora = (iso: string): string =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso) ? iso.slice(0, 16).replace("T", " ") : "";

/**
 * Formato antigo → padrão do Cofre, no mesmo desenho que o exportador 1.3.0
 * grava: cabeçalho padrão, sem o `# título`, turnos `## 👤 You *(…)*`.
 */
function converterAntigo(raw: string): string | null {
  const fm = parseFrontmatter(raw);
  if (!fm) return null;
  const { map, order } = fm;
  const titulo = semAspas(map.titulo ?? "").replace(/"/g, "");
  const linhas = [
    "---",
    `title: "${titulo}"`,
    "origem: CHATGPT",
    `uuid: ${map.id}`,
    `created: ${map.criado ?? ""}`,
    `updated: ${map.alterado ?? ""}`,
    ...order.filter((k) => !CHAVES_ANTIGAS.has(k)).map((k) => `${k}: ${map[k]}`),
    "---",
    "",
  ];
  const corpo = raw
    .slice(fm.bodyIndex)
    .replace(/\r\n/g, "\n")
    .replace(/^# .*\n(?:\n)?/, "")
    .replace(TURNO_ANTIGO, (_m, quem: string, ts?: string) =>
      `## ${quem === "Você" ? "👤 You" : "🤖 ChatGPT"} *(${hora(ts ?? "")})*`
    );
  return `${linhas.join("\n")}\n${corpo}`;
}

/** Lê um original e devolve a nota no padrão do Cofre, ou o motivo de não dar. */
export function paraPadraoCofre(raw: string): Convertida | { problema: string } {
  const fm = parseFrontmatter(raw);
  if (!fm) return { problema: "sem cabeçalho (--- … ---) no topo" };
  const { map } = fm;

  let content: string;
  let convertida = false;
  if (map.origem === "CHATGPT") {
    content = raw;
  } else if (!map.origem && map.id && !map.uuid) {
    const novo = converterAntigo(raw);
    if (!novo) return { problema: "cabeçalho do formato antigo ilegível" };
    content = novo;
    convertida = true;
  } else {
    return {
      problema: map.origem
        ? `origem ${map.origem}, não é do ChatGPT`
        : "não parece uma conversa do exportador do ChatGPT",
    };
  }

  const ok = parseFrontmatter(content);
  if (!ok || headerStatus(content) !== "ok") {
    const falta = REQUIRED_KEYS.filter((k) => !ok?.map[k]).join(", ");
    return { problema: `cabeçalho incompleto (falta ${falta})` };
  }
  return {
    content,
    title: semAspas(ok.map.title),
    uuid: ok.map.uuid,
    created: ok.map.created,
    updated: ok.map.updated,
    convertida,
  };
}

/** Nome no cofre: mesma regra das notas do Claude ({data}-{slug}.md). */
function notaDoCofre(c: Convertida): ImportedNote {
  const pref = datePrefix(c.created);
  const slug = slugify(c.title) || "sem-titulo";
  const uuid8 = c.uuid.slice(0, 8) || "xxxxxxxx";
  return {
    baseName: `${pref}-${slug}.md`,
    uuidName: `${pref}-${slug}-${uuid8}.md`,
    content: c.content,
  };
}

function itemDe(nome: string, raw: string): ChatgptItem {
  const r = paraPadraoCofre(raw);
  if ("problema" in r) {
    return {
      nome,
      status: "fora-do-padrao",
      title: nome.replace(/\.md$/i, ""),
      uuid: "",
      created: "",
      updated: "",
      note: null,
      convertida: false,
      motivo: r.problema,
    };
  }
  const turnos = r.content.match(TURNO)?.length ?? 0;
  return {
    nome,
    status: turnos === 0 ? "vazia" : "nova",
    title: r.title,
    uuid: r.uuid,
    created: r.created,
    updated: r.updated,
    note: turnos === 0 ? null : notaDoCofre(r),
    convertida: r.convertida,
    aviso:
      turnos > 0 && !RESPOSTA.test(r.content)
        ? "sem resposta do ChatGPT (imagem gerada ou pesquisa aprofundada não vêm no export)"
        : undefined,
  };
}

/**
 * Plano do passo 2: classifica cada original contra os outros arquivos da
 * pasta (duplicatas) e contra o cofre (`noCofre`: uuid → updated gravado).
 * Não altera as entradas; devolve itens novos, do mais recente ao mais antigo.
 */
export function planejarChatgpt(
  originais: OriginalChatgpt[],
  noCofre: Map<string, { updated: string }>
): ChatgptItem[] {
  const itens = originais.map((o) => itemDe(o.nome, o.raw));

  const maisNovo = new Map<string, ChatgptItem>();
  for (const it of itens) {
    if (!it.note) continue;
    const atual = maisNovo.get(it.uuid);
    if (!atual || it.updated > atual.updated) maisNovo.set(it.uuid, it);
  }

  return itens
    .map((it): ChatgptItem => {
      if (!it.note) return it;
      const vencedor = maisNovo.get(it.uuid);
      if (vencedor && vencedor !== it) {
        return { ...it, status: "duplicada", motivo: `mesma conversa que ${vencedor.nome}` };
      }
      const gravada = noCofre.get(it.uuid);
      if (!gravada) return it;
      return { ...it, status: gravada.updated === it.updated ? "em-dia" : "alterada" };
    })
    .sort((a, b) => b.updated.localeCompare(a.updated));
}

/** Vai para o cofre: novas e alteradas. */
export function vaiParaOCofre(it: ChatgptItem): boolean {
  return it.status === "nova" || it.status === "alterada";
}
