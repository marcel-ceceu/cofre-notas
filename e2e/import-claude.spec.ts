/**
 * E2E do fluxo WEB (navegador, notas no IndexedDB) de "Importar conversas do
 * Claude", cobrindo o export novo (conversations-000.zip, partes -001…,
 * bloco injected_prompt_block de memória) e o antigo (data-*-batch-0000.zip).
 *
 * Rodar: `npm run test:e2e` (sobe o Vite na porta E2E_PORT, padrão 5180).
 * Só o grande: `npx playwright test --grep @grande`; sem ele: `--grep-invert @grande`.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  BIG_CONVERSATIONS,
  BIG_MIN_UNCOMPRESSED_BYTES,
  bigAssistantMarker,
  bigHumanMarker,
  bigUuid,
  dataDescriptorZip,
  ensureBigExport,
  legacyZip,
  newFormatZip,
  nonClaudeZip,
  truncatedNewFormatZip,
  zipPayload,
  zipUsesDataDescriptor,
  zipUsesZip64LocalHeader,
  type ConversationSpec,
} from "./fixtures/claudeExport";
import {
  FORBIDDEN_IN_NOTES,
  FRETES,
  INADIMPLENCIA,
  LEGADO_ELETRICA,
  LEGADO_REUNIAO,
  MIGRACAO,
  ORCAMENTO,
  TRICKY_TEXT,
  VENDAS_ANTIGA,
  VENDAS_NOVA,
  type Sample,
} from "./fixtures/samples";

// ───────────────────────── textos/seletores da UI ─────────────────────────

const TOOLBAR_IMPORT_TITLE = "Abrir o fluxo de importação de conversas do Claude.ai";
const RUN_PIPELINE = "Executar pipeline de importação";
const DIALOG_TITLE = "Importar conversas do Claude";
const CONTINUE = "Já tenho o .zip → continuar";
const REJECTED_PREFIX = "Ignorado(s) por não parecer(em) um export do Claude:";
const DONE = "Importação concluída (sem duplicatas).";
const FINISH = "Concluir e recarregar";
/** Banco/store do cofre web (src/lib/import/webVault.ts). */
const WEB_DB = "cofre-notas-webvault";
const WEB_STORE = "notes";

/** Tempo máximo de cada etapa pesada do export grande (validar / importar). */
const BIG_STEP_TIMEOUT = 10 * 60_000;

// ───────────────────────── helpers do fluxo ─────────────────────────

async function openImportDialog(page: Page): Promise<Locator> {
  await page.getByTitle(TOOLBAR_IMPORT_TITLE).click();
  await page.getByRole("button", { name: RUN_PIPELINE }).click();
  const dialog = page.getByRole("dialog", { name: DIALOG_TITLE });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function goToZipStep(page: Page): Promise<Locator> {
  const dialog = await openImportDialog(page);
  await dialog.getByRole("button", { name: CONTINUE }).click();
  await expect(dialog.locator('input[type="file"]')).toBeAttached();
  return dialog;
}

type ZipPayload = ReturnType<typeof zipPayload>;

/** Buffers (zips pequenos) ou caminho em disco (export grande). */
async function chooseZips(dialog: Locator, files: string | readonly ZipPayload[]): Promise<void> {
  await dialog.locator('input[type="file"]').setInputFiles(files);
}

function acceptedItem(dialog: Locator, fileName: string): Locator {
  return dialog.getByRole("listitem").filter({ hasText: fileName });
}

async function expectAccepted(dialog: Locator, fileName: string, timeout?: number): Promise<void> {
  await expect(acceptedItem(dialog, fileName)).toBeVisible({ timeout });
  await expect(acceptedItem(dialog, fileName)).toContainText("✓");
}

async function runImport(dialog: Locator, timeout?: number): Promise<void> {
  await dialog.getByRole("button", { name: "Importar", exact: true }).click();
  await expect(dialog.getByText(DONE)).toBeVisible({ timeout });
}

interface Summary {
  readonly unicas: number;
  readonly novas: number;
  readonly atualizadas?: number;
  readonly emDia?: number;
  readonly vazias?: number;
}

function summaryLine(s: Summary): string {
  let line = `${s.unicas} conversa(s) única(s) · ${s.novas} nova(s)`;
  if (s.atualizadas) line += ` · ${s.atualizadas} atualizada(s)`;
  if (s.emDia) line += ` · ${s.emDia} já estavam em dia`;
  if (s.vazias) line += ` · ${s.vazias} vazia(s)`;
  return line;
}

async function expectSummary(dialog: Locator, s: Summary, message?: string): Promise<void> {
  await expect(dialog.getByText(/conversa\(s\) única\(s\)/), message).toHaveText(summaryLine(s));
}

async function finishAndReload(page: Page, dialog: Locator, noteCount: number): Promise<void> {
  await dialog.getByRole("button", { name: FINISH }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("footer").getByText(/^\d+ nota\(s\)$/)).toHaveText(`${noteCount} nota(s)`);
}

/** Fluxo completo: abrir → escolher zips → importar → conferir resumo → concluir. */
async function importZips(
  page: Page,
  files: readonly ZipPayload[],
  summary: Summary,
  noteCount: number
): Promise<void> {
  const dialog = await goToZipStep(page);
  await chooseZips(dialog, files);
  for (const f of files) await expectAccepted(dialog, f.name);
  await runImport(dialog);
  await expectSummary(dialog, summary);
  await finishAndReload(page, dialog, noteCount);
}

/** Abre a nota pela lista lateral e devolve o viewer (`main`). */
async function openNote(page: Page, noteName: string): Promise<Locator> {
  await page.getByRole("button", { name: "Notas", exact: true }).click();
  await page.locator("aside").getByRole("button", { name: noteName }).click();
  const viewer = page.locator("main");
  await expect(viewer.getByRole("heading", { level: 1 })).toHaveText(noteName);
  return viewer;
}

async function expectNoteShows(viewer: Locator, sample: Sample): Promise<void> {
  for (const text of sample.visible) await expect(viewer).toContainText(text);
  for (const text of FORBIDDEN_IN_NOTES) await expect(viewer).not.toContainText(text);
}

interface StoredNote {
  readonly uuid: string;
  readonly baseName: string;
  readonly updated: string;
  readonly content: string;
}

/** Lê o markdown gerado direto do IndexedDB do cofre web. */
async function storedNotes(page: Page): Promise<StoredNote[]> {
  return page.evaluate(
    ({ dbName, storeName }) =>
      new Promise<StoredNote[]>((resolve, reject) => {
        const open = indexedDB.open(dbName);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            const rows = req.result as StoredNote[];
            resolve(
              rows.map((r) => ({
                uuid: r.uuid,
                baseName: r.baseName,
                updated: r.updated,
                content: r.content,
              }))
            );
            db.close();
          };
        };
      }),
    { dbName: WEB_DB, storeName: WEB_STORE }
  );
}

function noteOf(notes: readonly StoredNote[], conv: ConversationSpec): StoredNote {
  const found = notes.find((n) => n.uuid === conv.uuid);
  if (!found) throw new Error(`nota da conversa ${conv.uuid} não foi gravada`);
  return found;
}

function expectClean(content: string, label: string): void {
  for (const text of FORBIDDEN_IN_NOTES) {
    expect(content, `${label} não pode conter "${text}"`).not.toContain(text);
  }
}

// ───────────────────────────── specs ─────────────────────────────

/** Erros do navegador (console.error + exceções) por página — anexados quando o teste falha. */
const browserErrors = new WeakMap<Page, string[]>();

function errorsOf(page: Page): string {
  const errors = browserErrors.get(page) ?? [];
  return errors.length ? errors.join(" | ") : "(nenhum)";
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  await page.goto("/");
});

test.afterEach(async ({ page }, testInfo) => {
  const errors = browserErrors.get(page) ?? [];
  if (errors.length > 0 && testInfo.status !== testInfo.expectedStatus) {
    await testInfo.attach("erros-do-navegador", {
      body: errors.join("\n"),
      contentType: "text/plain",
    });
  }
});

test("(g) a introdução orienta a baixar o conversations-000.zip", async ({ page }) => {
  const dialog = await openImportDialog(page);
  await expect(dialog).toContainText("conversations-000.zip");
});

test("(a) export novo: conversations-000.zip importa só o texto, sem memória/thinking/ferramentas", async ({
  page,
}) => {
  const zip = newFormatZip([ORCAMENTO.conv, MIGRACAO.conv]);
  expect(zipUsesZip64LocalHeader(zip), "fixture no layout do export real").toBe(true);

  await importZips(page, [zipPayload("conversations-000.zip", zip)], { unicas: 2, novas: 2 }, 2);

  const viewer = await openNote(page, ORCAMENTO.noteName);
  await expectNoteShows(viewer, ORCAMENTO);
  const viewerB = await openNote(page, MIGRACAO.noteName);
  await expectNoteShows(viewerB, MIGRACAO);

  const notes = await storedNotes(page);
  expect(notes).toHaveLength(2);
  const a = noteOf(notes, ORCAMENTO.conv);
  expectClean(a.content, "nota A");
  expect(a.baseName).toBe(`${ORCAMENTO.noteName}.md`);
  expect(a.content).toContain('title: "Revisão do orçamento de produção"');
  expect(a.content).toContain(`uuid: ${ORCAMENTO.conv.uuid}`);
  expect(a.content).toContain("## 👤 You *(2026-08-10 14:03)*");
  expect(a.content).toContain("## 🤖 Claude *(2026-08-10 14:04)*");
  expect(a.content, "chaves/aspas/barras do texto preservadas").toContain(TRICKY_TEXT);
  const b = noteOf(notes, MIGRACAO.conv);
  expectClean(b.content, "nota B");
  expect(b.content, "fallback para o campo text quando content é vazio").toContain(
    "MARCADOR-CLAUDE-B"
  );
});

// O diálogo de arquivos do Windows nem sempre entrega a seleção na ordem do
// nome: a versão mais nova tem de vencer por updated_at, não por ordem de leitura.
for (const order of ["000 depois 001", "001 depois 000"] as const) {
  test(`(b) multi-partes: conversations-000 + -001 juntos (${order}), uuid repetido fica com a versão mais nova`, async ({
    page,
  }) => {
    const part0 = zipPayload("conversations-000.zip", newFormatZip([VENDAS_ANTIGA.conv, INADIMPLENCIA.conv]));
    const part1 = zipPayload("conversations-001.zip", newFormatZip([FRETES.conv, VENDAS_NOVA.conv]));
    const files = order === "000 depois 001" ? [part0, part1] : [part1, part0];

    await importZips(page, files, { unicas: 3, novas: 3 }, 3);

    const viewer = await openNote(page, VENDAS_NOVA.noteName);
    await expectNoteShows(viewer, VENDAS_NOVA);
    await expect(viewer).not.toContainText("MARCADOR-VERSAO-ANTIGA");

    const notes = await storedNotes(page);
    expect(notes.map((n) => n.uuid).sort()).toEqual(
      [VENDAS_NOVA.conv.uuid, INADIMPLENCIA.conv.uuid, FRETES.conv.uuid].sort()
    );
    expect(noteOf(notes, VENDAS_NOVA.conv).updated).toBe(VENDAS_NOVA.conv.updatedAt);
    for (const n of notes) expectClean(n.content, n.baseName);
  });
}

test("(b2) download duplicado 'conversations-000 (1).zip' é aceito e não duplica conversas", async ({
  page,
}) => {
  const zip = newFormatZip([VENDAS_NOVA.conv, FRETES.conv]);

  await importZips(
    page,
    [zipPayload("conversations-000.zip", zip), zipPayload("conversations-000 (1).zip", zip)],
    { unicas: 2, novas: 2 },
    2
  );

  expect(await storedNotes(page)).toHaveLength(2);
});

test("(c) export antigo data-*-batch-0000.zip continua importando", async ({ page }) => {
  const zip = legacyZip([LEGADO_REUNIAO.conv, LEGADO_ELETRICA.conv]);
  const name = "data-c0ffee00-1111-4222-8333-444455556666-1776375331-2df93b7b-batch-0000.zip";

  await importZips(page, [zipPayload(name, zip)], { unicas: 2, novas: 2 }, 2);

  const viewer = await openNote(page, LEGADO_REUNIAO.noteName);
  await expectNoteShows(viewer, LEGADO_REUNIAO);
  const notes = await storedNotes(page);
  expect(notes).toHaveLength(2);
  for (const n of notes) expectClean(n.content, n.baseName);
});

test("(d) zip que não é do Claude é recusado e o válido é aceito", async ({ page }) => {
  const dialog = await goToZipStep(page);
  await chooseZips(dialog, [
    zipPayload("fotos-viagem.zip", nonClaudeZip()),
    zipPayload("conversations-000.zip", newFormatZip([MIGRACAO.conv])),
  ]);

  await expectAccepted(dialog, "conversations-000.zip");
  const rejected = dialog.getByText(REJECTED_PREFIX);
  await expect(rejected).toBeVisible();
  await expect(rejected).toContainText("fotos-viagem.zip");
  await expect(acceptedItem(dialog, "fotos-viagem.zip")).toHaveCount(0);

  await runImport(dialog);
  await expectSummary(dialog, { unicas: 1, novas: 1 });
  await finishAndReload(page, dialog, 1);
});

test("(e) reimportar o mesmo zip no mesmo navegador informa 'já estavam em dia'", async ({
  page,
}) => {
  const zip = newFormatZip([ORCAMENTO.conv, MIGRACAO.conv]);
  const files = [zipPayload("conversations-000.zip", zip)];

  await importZips(page, files, { unicas: 2, novas: 2 }, 2);
  await importZips(page, files, { unicas: 2, novas: 0, emDia: 2 }, 2);

  expect(await storedNotes(page)).toHaveLength(2);
});

test("(f) zip gravado em streaming (data descriptor) importa", async ({ page }) => {
  const zip = dataDescriptorZip([ORCAMENTO.conv, MIGRACAO.conv]);
  expect(zipUsesDataDescriptor(zip), "fixture precisa usar data descriptor").toBe(true);

  await importZips(page, [zipPayload("conversations-000.zip", zip)], { unicas: 2, novas: 2 }, 2);

  const viewer = await openNote(page, ORCAMENTO.noteName);
  await expectNoteShows(viewer, ORCAMENTO);
});

test("(i) parte com conversations.json cortado: as conversas inteiras entram e o aviso nomeia o arquivo", async ({
  page,
}) => {
  const dialog = await goToZipStep(page);
  await chooseZips(dialog, [
    zipPayload("conversations-000.zip", newFormatZip([ORCAMENTO.conv])),
    zipPayload("conversations-001.zip", truncatedNewFormatZip([MIGRACAO.conv, FRETES.conv], 40)),
  ]);
  await expectAccepted(dialog, "conversations-000.zip");
  await expectAccepted(dialog, "conversations-001.zip");

  await runImport(dialog);
  // ORCAMENTO (parte 000) + MIGRACAO (inteira na 001); FRETES ficou pela metade.
  await expectSummary(dialog, { unicas: 2, novas: 2 });
  const warning = dialog.getByText(/Não deu para ler por completo/);
  await expect(warning).toBeVisible();
  await expect(warning).toContainText("conversations-001.zip");
  await expect(warning).not.toContainText("conversations-000.zip");
  await finishAndReload(page, dialog, 2);

  const notes = await storedNotes(page);
  expect(notes.map((n) => n.uuid).sort()).toEqual([MIGRACAO.conv.uuid, ORCAMENTO.conv.uuid].sort());
});

test.describe("export grande", () => {
  test("(h) export ≥600 MB descompactado importa todas as conversas @grande", async ({
    page,
  }, testInfo) => {
    test.slow();
    const big = await ensureBigExport();
    testInfo.annotations.push({
      type: "export-grande",
      description:
        `${big.conversations} conversas, conversations.json=${big.uncompressedBytes} bytes, ` +
        `zip=${big.zipBytes} bytes, ${big.generatedNow ? "gerado" : "cache"} em ${big.elapsedMs} ms`,
    });
    expect(big.uncompressedBytes).toBeGreaterThanOrEqual(BIG_MIN_UNCOMPRESSED_BYTES);

    const dialog = await goToZipStep(page);
    // Caminho em disco (não buffer): o Playwright limita payloads em memória a ~50 MB.
    await chooseZips(dialog, big.path);

    // Espera a validação terminar: aceito OU recusado — e exige "aceito".
    const accepted = acceptedItem(dialog, big.fileName);
    const rejected = dialog.getByText(REJECTED_PREFIX);
    await expect(accepted.or(rejected)).toBeVisible({ timeout: BIG_STEP_TIMEOUT });
    await expect(rejected, "o export grande foi recusado na validação do zip").toBeHidden();

    const startedImport = Date.now();
    await runImport(dialog, BIG_STEP_TIMEOUT);
    testInfo.annotations.push({
      type: "tempo-importacao",
      description: `${Date.now() - startedImport} ms`,
    });
    await expectSummary(
      dialog,
      { unicas: BIG_CONVERSATIONS, novas: BIG_CONVERSATIONS },
      `resumo do export grande — erros do navegador: ${errorsOf(page)}`
    );
    await finishAndReload(page, dialog, BIG_CONVERSATIONS);

    const notes = await storedNotes(page);
    expect(notes).toHaveLength(BIG_CONVERSATIONS);
    for (const n of notes) expectClean(n.content, n.baseName);
    for (const i of [0, Math.floor(BIG_CONVERSATIONS / 2), BIG_CONVERSATIONS - 1]) {
      const note = notes.find((n) => n.uuid === bigUuid(i));
      expect(note, `conversa ${i} gravada`).toBeDefined();
      expect(note?.content).toContain(bigHumanMarker(i));
      expect(note?.content).toContain(bigAssistantMarker(i));
    }
    await expect(page.locator("main")).toContainText(/MARCADOR-A-\d+/);
  });
});
