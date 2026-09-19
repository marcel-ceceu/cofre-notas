import { describe, it, expect } from "vitest";
import {
  parseCursorTimestamp,
  parseCursorTranscript,
  deriveTitle,
  cursorToMarkdown,
} from "./cursorImport";

/** Monta uma linha `user` no formato real do transcript do Cursor. */
function userLine(query: string, ts = "Saturday, Sep 19, 2026, 10:42 AM (UTC-3)") {
  const text = `<timestamp>${ts}</timestamp>\n<user_query>\n${query}\n</user_query>`;
  return JSON.stringify({
    role: "user",
    message: { content: [{ type: "text", text }] },
  });
}

/** Linha `assistant` com blocos opcionais de texto e tool_use. */
function assistantLine(text: string | null, withTool = false) {
  const content: Array<Record<string, unknown>> = [];
  if (text !== null) content.push({ type: "text", text });
  if (withTool) content.push({ type: "tool_use", name: "Read", input: { path: "x" } });
  return JSON.stringify({ role: "assistant", message: { content } });
}

const TURN_ENDED = JSON.stringify({ type: "turn_ended", status: "success" });

const META = {
  uuid: "aaf0302a-18c7-4ff2-ab1c-ab9544c68175",
  project: "c-3-0-Projetos1-2607-VENDASMODULO-ModuloVendasApesp",
  mtimeMs: Date.UTC(2026, 8, 19, 13, 50, 37),
  ctimeMs: Date.UTC(2026, 8, 19, 13, 40, 0),
};

describe("parseCursorTimestamp", () => {
  it("converte o formato do Cursor para ISO mantendo o offset local", () => {
    expect(parseCursorTimestamp("Saturday, Sep 19, 2026, 10:42 AM (UTC-3)")).toBe(
      "2026-09-19T10:42:00-03:00"
    );
  });

  it("trata PM, meia-noite e meio-dia", () => {
    expect(parseCursorTimestamp("Friday, Sep 18, 2026, 9:05 PM (UTC-3)")).toBe(
      "2026-09-18T21:05:00-03:00"
    );
    expect(parseCursorTimestamp("Friday, Sep 18, 2026, 12:10 AM (UTC-3)")).toBe(
      "2026-09-18T00:10:00-03:00"
    );
    expect(parseCursorTimestamp("Friday, Sep 18, 2026, 12:10 PM (UTC-3)")).toBe(
      "2026-09-18T12:10:00-03:00"
    );
  });

  it("aceita offset positivo e retorna null no que não reconhece", () => {
    expect(parseCursorTimestamp("Monday, Jan 5, 2026, 8:00 AM (UTC+5:30)")).toBe(
      "2026-01-05T08:00:00+05:30"
    );
    expect(parseCursorTimestamp("ontem à tarde")).toBeNull();
    expect(parseCursorTimestamp("")).toBeNull();
  });
});

describe("parseCursorTranscript", () => {
  it("extrai user_query, funde linhas assistant consecutivas e ignora tool_use", () => {
    const jsonl = [
      userLine("Gere um script PowerShell"),
      assistantLine("Vou ler as regras primeiro.", true),
      assistantLine(null, true),
      assistantLine("Pronto, script gravado."),
      TURN_ENDED,
      userLine("Agora rode ele", "Saturday, Sep 19, 2026, 10:50 AM (UTC-3)"),
      assistantLine("Executado com sucesso."),
      TURN_ENDED,
    ].join("\n");

    const r = parseCursorTranscript(jsonl);

    expect(r.badLines).toBe(0);
    expect(r.firstTs).toBe("2026-09-19T10:42:00-03:00");
    expect(r.turns).toEqual([
      { role: "user", text: "Gere um script PowerShell", ts: "2026-09-19T10:42:00-03:00" },
      {
        role: "assistant",
        text: "Vou ler as regras primeiro.\n\nPronto, script gravado.",
        ts: "2026-09-19T10:42:00-03:00",
      },
      { role: "user", text: "Agora rode ele", ts: "2026-09-19T10:50:00-03:00" },
      { role: "assistant", text: "Executado com sucesso.", ts: "2026-09-19T10:50:00-03:00" },
    ]);
  });

  it("pula linhas user injetadas pelo Cursor (sem user_query) e linhas corrompidas", () => {
    const injected = JSON.stringify({
      role: "user",
      message: {
        content: [
          { type: "text", text: "<available_subagent_types>\n- explore: ...\n</available_subagent_types>" },
        ],
      },
    });
    const jsonl = [
      injected,
      userLine("Pergunta real"),
      "{isso nao e json",
      assistantLine("Resposta"),
      "",
    ].join("\n");

    const r = parseCursorTranscript(jsonl);

    expect(r.badLines).toBe(1);
    expect(r.turns.map((t) => t.role)).toEqual(["user", "assistant"]);
    expect(r.turns[0].text).toBe("Pergunta real");
  });

  it("devolve vazio para transcript sem diálogo", () => {
    expect(parseCursorTranscript("")).toEqual({ turns: [], badLines: 0, firstTs: null });
    const onlyTools = [assistantLine(null, true), TURN_ENDED].join("\n");
    expect(parseCursorTranscript(onlyTools).turns).toEqual([]);
  });

  it("assistant sem user anterior fica sem timestamp", () => {
    const r = parseCursorTranscript(assistantLine("Olá"));
    expect(r.turns).toEqual([{ role: "assistant", text: "Olá", ts: null }]);
  });

  it("substitui bloco de imagens anexadas por um marcador", () => {
    const q = "Veja a tela\n<image_files>\n[{\"path\":\"a.png\"}]\n</image_files>";
    const r = parseCursorTranscript(userLine(q));
    expect(r.turns[0].text).toBe("Veja a tela\n[imagem anexada]");
  });
});

describe("deriveTitle", () => {
  it("usa a primeira linha, limpa menções @caminho e marcação", () => {
    expect(
      deriveTitle("@c:\\3.0-Projetos1\\App\\ # CRIAR PJT VERCEL COM ENV, GIT, DEPLOY#\nGere um script")
    ).toBe("CRIAR PJT VERCEL COM ENV, GIT, DEPLOY");
    expect(deriveTitle("## **Ajustar** `grid` de vendas")).toBe("Ajustar grid de vendas");
  });

  it("corta em ~80 caracteres na fronteira de palavra", () => {
    const long = "palavra ".repeat(30).trim();
    const t = deriveTitle(long);
    expect(t.length).toBeLessThanOrEqual(80);
    expect(t.endsWith("palavra")).toBe(true);
  });

  it("cai para sem-titulo quando não sobra nada", () => {
    expect(deriveTitle("")).toBe("sem-titulo");
    expect(deriveTitle("@arquivo.ts ###")).toBe("sem-titulo");
  });
});

describe("cursorToMarkdown", () => {
  it("gera frontmatter completo com origem CURSOR e turnos You/Cursor", () => {
    const parsed = parseCursorTranscript(
      [userLine("Gere um script PowerShell"), assistantLine("Feito.")].join("\n")
    );
    const note = cursorToMarkdown(META, parsed);

    expect(note).not.toBeNull();
    expect(note!.baseName).toBe("2026-09-19-Gere-um-script-PowerShell.md");
    expect(note!.uuidName).toBe("2026-09-19-Gere-um-script-PowerShell-aaf0302a.md");
    expect(note!.content).toBe(
      [
        "---",
        'title: "Gere um script PowerShell"',
        "origem: CURSOR",
        "uuid: aaf0302a-18c7-4ff2-ab1c-ab9544c68175",
        "created: 2026-09-19T10:42:00-03:00",
        "updated: 2026-09-19T13:50:37.000Z",
        "projeto: c-3-0-Projetos1-2607-VENDASMODULO-ModuloVendasApesp",
        "---",
        "",
        "## 👤 You *(2026-09-19 10:42)*",
        "",
        "Gere um script PowerShell",
        "",
        "## 🤖 Cursor *(2026-09-19 10:42)*",
        "",
        "Feito.",
        "",
      ].join("\n")
    );
  });

  it("sem timestamp usa ctime como created; sem ctime usa mtime", () => {
    const parsed = parseCursorTranscript(assistantLine("Só resposta"));
    expect(cursorToMarkdown(META, parsed)!.content).toContain(
      "created: 2026-09-19T13:40:00.000Z"
    );
    expect(cursorToMarkdown({ ...META, ctimeMs: null }, parsed)!.content).toContain(
      "created: 2026-09-19T13:50:37.000Z"
    );
  });

  it("retorna null quando não há turnos", () => {
    expect(cursorToMarkdown(META, parseCursorTranscript(""))).toBeNull();
  });

  it("trunca projeto longo e remove aspas do título", () => {
    const parsed = parseCursorTranscript(userLine('Título com "aspas"'));
    const note = cursorToMarkdown({ ...META, project: "p".repeat(200) }, parsed)!;
    expect(note.content).toContain('title: "Título com aspas"');
    expect(note.content).toContain(`projeto: ${"p".repeat(120)}\n---`);
  });
});
