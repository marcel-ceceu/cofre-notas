import { describe, it, expect } from "vitest";
import { pickLatestExport, isExportZipName, PART_WINDOW_MS } from "./exportFiles";

const MIN = 60 * 1000;
const T = Date.UTC(2026, 8, 26, 13, 0, 0);

function f(name: string, mtime: number) {
  return { name, path: `C:\\Users\\x\\Downloads\\${name}`, mtime };
}

describe("isExportZipName", () => {
  it("reconhece o nome novo, as partes, as cópias do navegador e o nome antigo", () => {
    expect(isExportZipName("conversations-000.zip")).toBe(true);
    expect(isExportZipName("conversations-001.zip")).toBe(true);
    expect(isExportZipName("conversations-000 (1).zip")).toBe(true); // Chrome/Edge
    expect(isExportZipName("conversations-000(1).zip")).toBe(true); // Firefox
    expect(isExportZipName("conversations-001(12).zip")).toBe(true);
    expect(isExportZipName("CONVERSATIONS-000.ZIP")).toBe(true);
    expect(isExportZipName("data-c49d-1787185248-bcdf-batch-0000.zip")).toBe(true);
  });

  it("recusa outros zips", () => {
    expect(isExportZipName("sankhyageral-main (2).zip")).toBe(false);
    expect(isExportZipName("conversations.zip")).toBe(false);
    expect(isExportZipName("conversations-000.json")).toBe(false);
    expect(isExportZipName("my-conversations-000.zip")).toBe(false);
  });
});

describe("pickLatestExport", () => {
  it("lista vazia ou sem export → []", () => {
    expect(pickLatestExport([])).toEqual([]);
    expect(pickLatestExport([f("APESP Design System.zip", T)])).toEqual([]);
  });

  it("formato novo: pega o conversations-000.zip mais recente", () => {
    const r = pickLatestExport([
      f("conversations-000.zip", T - 30 * 24 * 60 * MIN), // export de agosto
      f("conversations-000 (1).zip", T), // export de setembro (cópia do navegador)
      f("data-c49d-1-a-batch-0000.zip", T - 40 * 24 * 60 * MIN),
    ]);
    expect(r).toEqual([f("conversations-000 (1).zip", T).path]);
  });

  it("formato novo: junta as partes baixadas juntas, em ordem de parte", () => {
    const r = pickLatestExport([
      f("conversations-001.zip", T),
      f("conversations-000.zip", T - 2 * MIN),
      f("conversations-002.zip", T - 5 * MIN),
    ]);
    expect(r).toEqual([
      f("conversations-000.zip", 0).path,
      f("conversations-001.zip", 0).path,
      f("conversations-002.zip", 0).path,
    ]);
  });

  it("formato novo: parte de export antigo (fora da janela) fica de fora", () => {
    const r = pickLatestExport([
      f("conversations-000 (1).zip", T),
      f("conversations-001.zip", T - PART_WINDOW_MS - MIN), // sobra de outro export
    ]);
    expect(r).toEqual([f("conversations-000 (1).zip", 0).path]);
  });

  it("formato novo: cópia do Firefox (sem espaço) mais recente vence o original antigo", () => {
    const r = pickLatestExport([
      f("conversations-000.zip", T - 30 * 24 * 60 * MIN),
      f("conversations-000(1).zip", T),
    ]);
    expect(r).toEqual([f("conversations-000(1).zip", 0).path]);
  });

  it("formato novo: duas cópias da mesma parte → fica a mais recente", () => {
    const r = pickLatestExport([
      f("conversations-000 (1).zip", T),
      f("conversations-000.zip", T - 10 * MIN),
    ]);
    expect(r).toEqual([f("conversations-000 (1).zip", 0).path]);
  });

  it("formato antigo: mantém o agrupamento por batch do mesmo export", () => {
    const r = pickLatestExport([
      f("data-aaa-1-x-batch-0000.zip", T),
      f("data-aaa-1-x-batch-0001.zip", T - MIN),
      f("data-bbb-2-y-batch-0000.zip", T - 60 * MIN),
    ]);
    expect(r).toEqual([
      f("data-aaa-1-x-batch-0000.zip", 0).path,
      f("data-aaa-1-x-batch-0001.zip", 0).path,
    ]);
  });

  it("vale o mais recente entre os dois formatos", () => {
    const novo = f("conversations-000.zip", T);
    const antigo = f("data-aaa-1-x-batch-0000.zip", T - MIN);
    expect(pickLatestExport([antigo, novo])).toEqual([novo.path]);
    const antigoMaisNovo = f("data-aaa-1-x-batch-0000.zip", T + MIN);
    expect(pickLatestExport([antigoMaisNovo, novo])).toEqual([antigoMaisNovo.path]);
  });
});
