import { describe, it, expect } from "vitest";
import { removeCortesias, prepareCortesias, norm } from "./cortesias";
import { DEFAULT_CORTESIAS } from "./cortesias.rules";

const CORT = prepareCortesias(DEFAULT_CORTESIAS);

/** Implementação de referência (versão anterior, sem atalho nem cache) — o resultado tem de ser idêntico. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function refIsCourtesy(piece: string, cort: string[]): boolean {
  let n = norm(piece);
  n = n.replace(/\bmarcel\b/g, " ");
  for (const ph of cort) if (ph) n = n.replace(new RegExp("\\b" + escapeRegex(ph) + "\\b", "g"), " ");
  return n.replace(/\s/g, "").length <= 2;
}
function refTrimLeading(par: string, cort: string[]): string {
  let cut = 0;
  const re = /[^.!?,;\r\n]+[.!?,;]*/g;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(par)) !== null) {
    const seg = mm[0];
    if (mm.index === re.lastIndex) re.lastIndex++;
    if (seg.trim() === "") continue;
    if (refIsCourtesy(seg, cort)) cut = mm.index + seg.length;
    else break;
  }
  return par.slice(cut).replace(/^[ ,;:\-\t]+/, "");
}
function refCleanTurn(body: string, cort: string[]): string | null {
  if (refIsCourtesy(body, cort)) return null;
  const paras = body.split(/\r?\n\r?\n/);
  while (paras.length > 0 && refIsCourtesy(paras[0], cort)) paras.shift();
  while (paras.length > 0 && refIsCourtesy(paras[paras.length - 1], cort)) paras.pop();
  if (paras.length === 0) return null;
  paras[0] = refTrimLeading(paras[0], cort);
  return paras.join("\n\n").trim();
}
function refRemove(raw: string, cort: string[]): string {
  let yaml = "";
  let body = raw;
  const mY = raw.match(/^(---\r?\n[\s\S]*?\r?\n---\r?\n)/);
  if (mY) {
    yaml = mY[1];
    body = raw.slice(mY[1].length);
  }
  const codes: string[] = [];
  body = body.replace(/```[\s\S]*?```/g, (m) => `@@CODE_${codes.push(m) - 1}@@`);
  const heads = [...body.matchAll(/^##\s+\S+\s+(You|Claude|Cursor)\s+\*\([^)]*\)\*[^\r\n]*\r?\n/gm)];
  let out: string;
  if (heads.length === 0) out = yaml + body;
  else {
    out = yaml + body.slice(0, heads[0].index ?? 0);
    for (let i = 0; i < heads.length; i++) {
      const h = heads[i];
      const start = (h.index ?? 0) + h[0].length;
      const end = i + 1 < heads.length ? heads[i + 1].index ?? body.length : body.length;
      const clean = refCleanTurn(body.slice(start, end), cort);
      if (clean === null) continue;
      out += h[0] + "\n" + clean + "\n\n";
    }
  }
  for (let i = 0; i < codes.length; i++) out = out.replace(`@@CODE_${i}@@`, () => codes[i]);
  return out;
}

const FM = '---\ntitle: "t"\nuuid: u\ncreated: x\nupdated: y\n---\n\n';
const turn = (who: "You" | "Claude", body: string) =>
  `## ${who === "You" ? "👤" : "🤖"} ${who} *(2026-09-01 10:00)*\n\n${body}\n\n`;

describe("removeCortesias", () => {
  const CASES = [
    turn("You", "Obrigado!") + turn("Claude", "De nada, Marcel! Qualquer coisa estou à disposição."),
    turn("You", "Oi Claude, tudo bem? Preciso de ajuda com o SQL abaixo.\n\n```sql\nselect 1\n```\n\nValeu!"),
    turn("Claude", "Claro! Aqui está.\n\nO índice resolve.\n\nEspero ter ajudado! Abraço."),
    turn("You", "ok"),
    turn("You", "ok ok obrigado muito obrigado"),
    turn("Claude", "Perfeito, Marcel. Vamos lá: o campo CODPROD está errado."),
    turn("You", "a"),
    turn("You", "xy"),
    turn("You", "valeu xyz"),
    "Texto sem cabeçalho de turno, obrigado.",
  ];

  it("dá exatamente o mesmo resultado da implementação anterior", () => {
    for (const body of CASES) {
      const raw = FM + body;
      expect(removeCortesias(raw, CORT)).toBe(refRemove(raw, CORT));
    }
  });

  it("todas as frases-regra isoladas continuam sendo removidas como antes", () => {
    for (const ph of DEFAULT_CORTESIAS) {
      const raw = FM + turn("You", ph) + turn("Claude", `${ph}, segue a resposta técnica.`);
      expect(removeCortesias(raw, CORT)).toBe(refRemove(raw, CORT));
    }
  });

  it("turno longo de conteúdo não paga as 119 substituições (atalho) e fica intacto", () => {
    const longo = "Implementar o relatório de vendas por vendedor com filtro de período. ".repeat(2000);
    const raw = FM + turn("Claude", longo.trim());
    const t0 = performance.now();
    const got = removeCortesias(raw, CORT);
    expect(performance.now() - t0).toBeLessThan(200);
    expect(got).toBe(refRemove(raw, CORT));
  });
});
