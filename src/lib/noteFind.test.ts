import { describe, expect, it } from "vitest";
import { findMatches, foldText, stepIndex } from "./noteFind";

describe("foldText", () => {
  it("ASCII puro: só minúsculas, mapa identidade", () => {
    expect(foldText("Hello")).toEqual({
      folded: "hello",
      map: [0, 1, 2, 3, 4, 5],
    });
  });

  it("remove acentos precompostos mantendo o mapa 1:1", () => {
    expect(foldText("Ação")).toEqual({ folded: "acao", map: [0, 1, 2, 3, 4] });
  });

  it("pula marcas combinantes já decompostas (fim do char inclui a marca)", () => {
    expect(foldText("ão")).toEqual({ folded: "ao", map: [0, 2, 3] });
  });

  it("İ (U+0130) vira i sem o ponto combinante", () => {
    expect(foldText("İ")).toEqual({ folded: "i", map: [0, 1] });
  });

  it("ß não expande para ss", () => {
    expect(foldText("ß").folded).toBe("ß");
  });

  it("emoji (par substituto) mapeia os dois code units para o início", () => {
    const r = foldText("a😀b");
    expect(r.folded.length).toBe(4);
    expect(r.map).toEqual([0, 1, 1, 3, 4]);
  });

  it("ligadura ﬁ fica literal (NFD não decompõe)", () => {
    expect(foldText("ﬁ").folded).toBe("ﬁ");
  });

  it("string vazia", () => {
    expect(foldText("")).toEqual({ folded: "", map: [0] });
  });

  it("invariante: map.length === folded.length + 1", () => {
    for (const s of ["", "abc", "Ação", "ão", "😀x", "ÀÉÎÕÜ ç", "İstanbul"]) {
      const r = foldText(s);
      expect(r.map.length).toBe(r.folded.length + 1);
      expect(r.map[r.map.length - 1]).toBe(s.length);
    }
  });
});

describe("findMatches", () => {
  it("ignora maiúsculas e acentos no texto", () => {
    expect(findMatches("Ação e ACAO", "acao")).toEqual([
      { start: 0, end: 4 },
      { start: 7, end: 11 },
    ]);
  });

  it("ignora maiúsculas e acentos no termo", () => {
    expect(findMatches("acao", "AÇÃO")).toEqual([{ start: 0, end: 4 }]);
  });

  it("devolve posições do texto original mesmo com acento", () => {
    const text = "xx ação yy";
    const spans = findMatches(text, "cao");
    expect(spans).toEqual([{ start: 4, end: 7 }]);
    expect(text.slice(4, 7)).toBe("ção");
  });

  it("match em texto decomposto inclui a marca combinante", () => {
    expect(findMatches("ão", "ao")).toEqual([{ start: 0, end: 3 }]);
  });

  it("ocorrências não se sobrepõem", () => {
    expect(findMatches("aaaa", "aa")).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
  });

  it("termo vazio, só espaços ou só acento combinante → nada", () => {
    expect(findMatches("abc", "")).toEqual([]);
    expect(findMatches("a b c", "   ")).toEqual([]);
    expect(findMatches("abc", "́")).toEqual([]);
  });

  it("espaços no termo são literais", () => {
    expect(findMatches("a b", " b")).toEqual([{ start: 1, end: 3 }]);
    expect(findMatches("ab", " b")).toEqual([]);
  });

  it("sem ocorrência ou texto vazio → []", () => {
    expect(findMatches("foo bar", "zzz")).toEqual([]);
    expect(findMatches("", "a")).toEqual([]);
  });

  it("não interpreta operadores da busca global", () => {
    expect(findMatches("x OR y", "OR")).toEqual([{ start: 2, end: 4 }]);
    expect(findMatches('diga "oi"', '"oi"')).toEqual([{ start: 5, end: 9 }]);
  });

  it("match no fim do texto", () => {
    expect(findMatches("ação", "ão")).toEqual([{ start: 2, end: 4 }]);
  });

  it("emoji antes do termo não desloca as posições", () => {
    expect(findMatches("😀 ação", "ação")).toEqual([{ start: 3, end: 7 }]);
  });
});

describe("stepIndex", () => {
  it("sem ocorrências → -1", () => {
    expect(stepIndex(0, 0, 1)).toBe(-1);
    expect(stepIndex(-1, 0, -1)).toBe(-1);
  });

  it("sem atual: próxima vai à primeira, anterior vai à última", () => {
    expect(stepIndex(-1, 3, 1)).toBe(0);
    expect(stepIndex(-1, 3, -1)).toBe(2);
  });

  it("avança e volta com wrap-around", () => {
    expect(stepIndex(1, 3, 1)).toBe(2);
    expect(stepIndex(2, 3, 1)).toBe(0);
    expect(stepIndex(0, 3, -1)).toBe(2);
  });
});
