/**
 * O exportador do ChatGPT (src-tauri/chatgpt_export.js) roda no navegador, mas o
 * .md que ele grava precisa seguir o padrão do Cofre. Aqui o script real é
 * carregado numa sandbox e a saída passa pelas funções do próprio Cofre.
 */
import { describe, expect, it } from "vitest";
import { detectOrigem, headerStatus } from "./frontmatter";
import { prepareCortesias, removeCortesias } from "./cortesias";
import { DEFAULT_CORTESIAS } from "./cortesias.rules";
import { carregarExportador } from "./gptexport.fixture";

const gpt = carregarExportador();
const ATUALIZADA = "2026-10-29T19:56:18.897Z";

function conversa(respostaDoChatgpt: string | null) {
  const msg = (role: string, texto: string, t: number) => ({
    author: { role },
    create_time: t,
    content: { content_type: "text", parts: [texto] },
    metadata: role === "assistant" ? { model_slug: "gpt-6-thinking" } : {},
  });
  const mapping: Record<string, unknown> = {
    n0: { id: "n0", parent: null, message: null },
    n1: { id: "n1", parent: "n0", message: msg("user", "Quais as taxas de rotativo?", 1761743684.9) },
  };
  if (respostaDoChatgpt !== null) {
    mapping.n2 = { id: "n2", parent: "n1", message: msg("assistant", respostaDoChatgpt, 1761743751.6) };
  }
  return {
    title: 'Taxas de "rotativo" PJ',
    create_time: 1761743681.3,
    update_time: 1761767778.8,
    current_node: respostaDoChatgpt !== null ? "n2" : "n1",
    mapping,
  };
}
const meta = { id: "6ae346c0-afa4-83e9-9d57-785fcb9a71b4", title: "Taxas", update_time: ATUALIZADA, projeto: "" };
const exportar = (resposta: string | null) => gpt.paraMd(conversa(resposta), meta, gpt.novoEst());

describe("exportador do ChatGPT no padrão do Cofre", () => {
  const md = exportar("## Régua prática\n\nA taxa média é 3,5% a.m.\n\nObrigado!");

  it("tem o cabeçalho completo que o envio ao Supabase exige", () => {
    expect(headerStatus(md)).toBe("ok");
    expect(md).toMatch(/^---\ntitle: "Taxas de rotativo PJ"\norigem: CHATGPT\nuuid: 6ae346c0-/);
    expect(md).toContain(`updated: ${ATUALIZADA}`);
  });

  it("é reconhecido pelo Cofre como origem CHATGPT", () => {
    expect(detectOrigem(md)).toBe("CHATGPT");
  });

  it("usa turnos no mesmo formato das notas do Claude", () => {
    expect(md).toMatch(/^## 👤 You \*\(2025-10-29 13:14\)\*$/m);
    expect(md).toMatch(/^## 🤖 ChatGPT \*\(2025-10-29 13:15\)\*$/m);
  });

  it("passa pela limpeza de cortesias do Cofre sem perder turnos", () => {
    const limpo = removeCortesias(md, prepareCortesias(DEFAULT_CORTESIAS));
    expect(limpo).toContain("## 👤 You *(");
    expect(limpo).toContain("A taxa média é 3,5% a.m.");
    expect(limpo).not.toMatch(/Obrigado!/);
  });

  it("conferência aprova o arquivo bom", () => {
    expect(gpt.conferir(md)).toEqual([]);
  });

  it("conferência reprova conversa sem resposta do ChatGPT", () => {
    expect(gpt.conferir(exportar(null)).join()).toMatch(/sem resposta do ChatGPT/);
  });
});

describe("duplicatas na pasta", () => {
  const md = exportar("Resposta.");
  const atual = gpt.lerCabecalho("2025-10-29-taxas-6ae346c0.md", md)!;
  const antigo = gpt.lerCabecalho(
    "2026-10-29_Taxas_6ae346c0.md",
    `---\nid: ${meta.id}\ntitulo: "Taxas"\nalterado: ${ATUALIZADA}\n---\n`
  )!;

  it("lê uuid/updated do padrão novo e id/alterado do formato antigo", () => {
    expect(atual).toMatchObject({ uuid: meta.id, updated: ATUALIZADA, padrao: true });
    expect(antigo).toMatchObject({ uuid: meta.id, updated: ATUALIZADA, padrao: false });
  });

  it("mesma conversa sem alteração e já no padrão = idêntica (ignorada)", () => {
    const [c] = gpt.classificar([{ id: meta.id, update_time: ATUALIZADA }], new Map([[meta.id, atual]]));
    expect(c.situacao).toBe("identica");
  });

  it("conversa que mudou = alterada, regravada no mesmo arquivo", () => {
    const [c] = gpt.classificar(
      [{ id: meta.id, update_time: "2026-11-01T10:00:00.000Z" }],
      new Map([[meta.id, atual]])
    );
    expect(c).toMatchObject({ situacao: "alterada", arquivo: "2025-10-29-taxas-6ae346c0.md" });
  });

  it("arquivo no formato antigo é regravado no padrão mesmo sem alteração", () => {
    const [c] = gpt.classificar([{ id: meta.id, update_time: ATUALIZADA }], new Map([[meta.id, antigo]]));
    expect(c).toMatchObject({ situacao: "alterada", arquivo: "2026-10-29_Taxas_6ae346c0.md" });
  });

  it("conversa que não está na pasta = nova", () => {
    const [c] = gpt.classificar([{ id: "outra", update_time: ATUALIZADA }], new Map());
    expect(c.situacao).toBe("nova");
  });
});
