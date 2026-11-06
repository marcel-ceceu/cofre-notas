import { describe, expect, it } from "vitest";
import { detectOrigem, headerStatus } from "./frontmatter";
import { prepareCortesias, removeCortesias } from "./cortesias";
import { DEFAULT_CORTESIAS } from "./cortesias.rules";
import { paraPadraoCofre, planejarChatgpt, vaiParaOCofre } from "./chatgptImport";
import { carregarExportador } from "./gptexport.fixture";

const gpt = carregarExportador();
const ID = "6a8edf44-be94-83e9-95e3-09c8a2444b65";
const CRIADO = "2026-08-26T12:43:30.569Z";
const ALTERADO = "2026-08-26T12:51:52.423Z";

/** A mesma conversa gravada pelo exportador 1.3.0 (padrão do Cofre). */
function exportada(updated = ALTERADO, resposta: string | null = "Veja estas opções.\n\nObrigado!"): string {
  const msg = (role: string, texto: string, t: string) => ({
    author: { role },
    create_time: Date.parse(t) / 1000,
    content: { content_type: "text", parts: [texto] },
    metadata: role === "assistant" ? { model_slug: "gpt-5-6-thinking" } : {},
  });
  const mapping: Record<string, unknown> = {
    n0: { id: "n0", parent: null, message: null },
    n1: { id: "n1", parent: "n0", message: msg("user", "Quais repos?", "2026-08-26T12:43:25.785Z") },
  };
  if (resposta !== null) {
    mapping.n2 = { id: "n2", parent: "n1", message: msg("assistant", resposta, "2026-08-26T12:44:41.853Z") };
  }
  const conv = {
    title: "Sugestões de repos GitHub",
    create_time: Date.parse(CRIADO) / 1000,
    current_node: resposta !== null ? "n2" : "n1",
    mapping,
  };
  return gpt.paraMd(conv, { id: ID, update_time: updated, projeto: "" }, gpt.novoEst());
}

/** A mesma conversa no formato antigo (exportador 1.2.0), como está em 1_Chatgpt hoje. */
const ANTIGA = [
  "---",
  `id: ${ID}`,
  'titulo: "Sugestões de repos GitHub"',
  `criado: ${CRIADO}`,
  `alterado: ${ALTERADO}`,
  'projeto: ""',
  "modelo: gpt-5-6-thinking",
  `url: https://chatgpt.com/c/${ID}`,
  "exportador: gptexport 1.2.0",
  "---",
  "# Sugestões de repos GitHub",
  "",
  "### Você — 2026-08-26T12:43:25.785Z",
  "",
  "Quais repos?",
  "",
  "### ChatGPT — 2026-08-26T12:44:41.853Z",
  "",
  "Veja estas opções.\n\nObrigado!",
  "",
].join("\n");

const semVersao = (md: string) => md.replace(/^exportador: .*$/m, "");

describe("passo 2 — leitura no padrão do Cofre", () => {
  it("arquivo do exportador 1.3.0 entra como está", () => {
    const r = paraPadraoCofre(exportada());
    expect(r).toMatchObject({ uuid: ID, updated: ALTERADO, convertida: false });
  });

  it("formato antigo vira exatamente o que o exportador 1.3.0 grava", () => {
    const r = paraPadraoCofre(ANTIGA);
    if ("problema" in r) throw new Error(r.problema);
    expect(r.convertida).toBe(true);
    expect(semVersao(r.content)).toBe(semVersao(exportada()));
    expect(headerStatus(r.content)).toBe("ok");
    expect(detectOrigem(r.content)).toBe("CHATGPT");
  });

  it("convertida passa pela limpeza de cortesias sem perder turnos", () => {
    const r = paraPadraoCofre(ANTIGA);
    if ("problema" in r) throw new Error(r.problema);
    const limpo = removeCortesias(r.content, prepareCortesias(DEFAULT_CORTESIAS));
    expect(limpo).toContain("## 👤 You *(2026-08-26 12:43)*");
    expect(limpo).toContain("Veja estas opções.");
    expect(limpo).not.toMatch(/Obrigado!/);
  });

  it("recusa arquivo sem cabeçalho ou de outra origem, com o motivo", () => {
    expect(paraPadraoCofre("# só texto")).toEqual({ problema: "sem cabeçalho (--- … ---) no topo" });
    expect(paraPadraoCofre("---\ntitle: x\norigem: CLAUDEWEB\nuuid: 1\n---\n")).toEqual({
      problema: "origem CLAUDEWEB, não é do ChatGPT",
    });
    const semUpdated = exportada().replace(/^updated: .*\n/m, "");
    expect(paraPadraoCofre(semUpdated)).toEqual({ problema: "cabeçalho incompleto (falta updated)" });
  });
});

describe("passo 2 — duplicatas", () => {
  const arq = (nome: string, raw: string) => ({ nome, raw });

  it("mesma conversa duas vezes na pasta: fica a mais nova, a outra é duplicada", () => {
    const itens = planejarChatgpt(
      [arq("velha.md", ANTIGA), arq("nova.md", exportada("2026-09-01T10:00:00.000Z"))],
      new Map()
    );
    expect(itens.map((i) => [i.nome, i.status])).toEqual([
      ["nova.md", "nova"],
      ["velha.md", "duplicada"],
    ]);
    expect(itens[1].motivo).toBe("mesma conversa que nova.md");
  });

  it("contra o cofre: mesmo updated = em dia; updated diferente = alterada", () => {
    const emDia = planejarChatgpt([arq("a.md", ANTIGA)], new Map([[ID, { updated: ALTERADO }]]));
    const mudou = planejarChatgpt([arq("a.md", ANTIGA)], new Map([[ID, { updated: CRIADO }]]));
    expect(emDia[0].status).toBe("em-dia");
    expect(mudou[0].status).toBe("alterada");
    expect([emDia[0], mudou[0]].map(vaiParaOCofre)).toEqual([false, true]);
  });

  it("conversa sem resposta entra com aviso; sem turno nenhum fica vazia", () => {
    const [soPergunta] = planejarChatgpt([arq("p.md", exportada(ALTERADO, null))], new Map());
    expect(soPergunta.status).toBe("nova");
    expect(soPergunta.aviso).toMatch(/sem resposta do ChatGPT/);

    const vazia = exportada().replace(/\n## [\s\S]*$/, "\n");
    const [v] = planejarChatgpt([arq("v.md", vazia)], new Map());
    expect(v.status).toBe("vazia");
    expect(vaiParaOCofre(v)).toBe(false);
  });

  it("nome no cofre segue o das notas do Claude: data de criação + título", () => {
    const [it] = planejarChatgpt([arq("2026-08-26_Sugestoes_6a8edf44.md", ANTIGA)], new Map());
    expect(it.note).toMatchObject({
      baseName: "2026-08-26-Sugestões-de-repos-GitHub.md",
      uuidName: "2026-08-26-Sugestões-de-repos-GitHub-6a8edf44.md",
    });
  });
});
