import { describe, expect, it } from "vitest";
import React from "react";
import { highlight, highlightFind } from "./highlight";

type El = React.ReactElement<{ className?: string; children?: React.ReactNode }>;

/** Achata o resultado em uma lista de nós (desembrulha Fragments). */
function flatten(node: React.ReactNode): React.ReactNode[] {
  if (Array.isArray(node)) return node.flatMap(flatten);
  if (React.isValidElement(node) && node.type === React.Fragment) {
    return flatten((node as El).props.children);
  }
  return [node];
}

function marks(node: React.ReactNode): El[] {
  return flatten(node).filter(
    (n): n is El => React.isValidElement(n) && n.type === "mark"
  );
}

describe("highlight (busca global)", () => {
  it("query vazia devolve a mesma string", () => {
    expect(highlight("abc", "")).toBe("abc");
  });

  it("sem ocorrência devolve a mesma string (não um array)", () => {
    expect(highlight("foo bar", "zzz")).toBe("foo bar");
  });

  it("marca cada ocorrência com <mark class=hl> e preserva o texto entre elas", () => {
    const out = highlight("foo bar foo", "foo");
    const parts = flatten(out);
    const ms = marks(out);
    expect(ms).toHaveLength(2);
    expect(ms[0].props.className).toBe("hl");
    expect(ms[0].props.children).toBe("foo");
    expect(parts).toContain(" bar ");
  });

  it("modo substring trata a consulta como um termo único", () => {
    expect(marks(highlight("a b", "a b", "substring"))).toHaveLength(1);
    expect(marks(highlight("a b", "a b", "tokens"))).toHaveLength(2);
  });

  it("mescla ocorrências sobrepostas em um único mark", () => {
    const ms = marks(highlight("abcd", "abc bcd"));
    expect(ms).toHaveLength(1);
    expect(ms[0].props.children).toBe("abcd");
  });

  it("desce em elementos com filhos", () => {
    const out = highlight(React.createElement("strong", null, "Foo"), "foo") as El;
    expect(out.type).toBe("strong");
    expect(marks(out.props.children)).toHaveLength(1);
  });

  it("elemento sem filhos é devolvido intacto", () => {
    const br = React.createElement("br");
    expect(highlight(br, "x")).toBe(br);
  });

  it("não aninha marks dentro de um mark já existente", () => {
    const existing = React.createElement("mark", { className: "hl" }, "foo");
    expect(highlight(existing, "foo")).toBe(existing);
  });
});

describe("highlightFind (busca na nota)", () => {
  it("ignora maiúsculas e acentos e preserva o texto original dentro do mark", () => {
    const ms = marks(highlightFind("Ação e acao", "acao"));
    expect(ms).toHaveLength(2);
    expect(ms[0].props.className).toBe("hl-find");
    expect(ms[0].props.children).toBe("Ação");
    expect(ms[1].props.children).toBe("acao");
  });

  it("termo vazio ou só espaços devolve a mesma string", () => {
    expect(highlightFind("x", "")).toBe("x");
    expect(highlightFind("x", "   ")).toBe("x");
  });

  it("não interpreta operadores", () => {
    expect(marks(highlightFind("a OR b", "OR"))).toHaveLength(1);
  });

  it("não aninha marks dentro de um mark já existente", () => {
    const existing = React.createElement("mark", { className: "hl-find" }, "foo");
    expect(highlightFind(existing, "foo")).toBe(existing);
  });
});
