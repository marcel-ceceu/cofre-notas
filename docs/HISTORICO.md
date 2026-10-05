# Histórico — Cofre de Notas (leitor Obsidian / vault Markdown)

## Identificação do projeto

| Item | Valor |
|------|--------|
| **Pasta canónica (workspace)** | `2606_COFRENOTAS-LeitorNotasObsidianAPP/` |
| **Nome do app (UI / instalador)** | Cofre de Notas |
| **Repositório GitHub** | [marcel-ceceu/cofre-notas](https://github.com/marcel-ceceu/cofre-notas) |
| **Stack** | Tauri 2 + Vite + React 18 + Tailwind 4 |
| **Versão atual** | **0.13.0** (tag `v0.13.0`) |
| **Auto-update** | GitHub Releases + `latest.json` + `UpdateBanner` |

> O **nome da pasta local** segue a convenção `2606_*` do workspace. O **repo remoto** e o **identificador Tauri** (`com.marcel.cofre-notas`) mantêm-se `cofre-notas` para não quebrar releases nem updates já instalados.

---

## Entradas de histórico

### 05/10/2026 — v0.13.0: Importar Claude no novo formato de export (`conversations-000.zip`) e leitura em fluxo

**Contexto:** no fim de ago/2026 o export do Claude.ai mudou. Antes vinha `data-<id>-…-batch-0000.zip` com `conversations.json` + `projects/` + `memories.json` + `users.json`; agora vem `conversations-000.zip` (partes `-001`…; o navegador salva repetidos como `conversations-000 (1).zip`) só com `conversations.json`. Três problemas: (1) a auto-detecção em Downloads só procurava `data-*.zip`; (2) o histórico completo chega a **711 MB** de `conversations.json` (1290 conversas) — acima do limite de string do V8, o pipeline antigo (`unzipSync` + `strFromU8` + `JSON.parse`) quebrava com *"Cannot create a string longer than 0x1fffffe8 characters"*; (3) surgiu o bloco `injected_prompt_block` (snapshot da memória do usuário nas mensagens humanas) — já era descartado (só blocos `text` viram nota), agora com teste.

**Mudança:** `lib/import/exportStream.ts` — leitura em fluxo: o .zip chega aos pedaços (desktop: `FileHandle` do plugin-fs; navegador: `Blob.slice`), é descompactado com `fflate.Unzip` e o array JSON é fatiado em bytes (`JsonObjectSplitter`); cada conversa vira nota na hora (`ConversationCollector`, dedupe por uuid igual ao antigo) e o JSON bruto é descartado. Validação do .zip lê só o diretório central (`listZipEntryNames`, com ZIP64) — instantânea, sem descompactar. `lib/import/exportFiles.ts` — escolha do export mais recente (formato novo e antigo; partes do mesmo export agrupadas numa janela de 1 h). `ImportResult.failed` lista .zip que não puderam ser lidos (aviso âmbar no modal, em vez de "sucesso com 0 conversas"). Textos do modal/painel citam `conversations-000.zip`. Capability ganhou `fs:allow-open`, `fs:allow-read`, `fs:allow-seek`. `zip.ts`, `parseConversations` e `dedupeByUuid` saíram (sem uso). Achados da revisão multi-agente, corrigidos: cortesias recompilava 119 regex por trecho — agora cache por lista + atalho exato (palavras fora das cortesias > 2 letras ⇒ não é cortesia): 1266 notas reais de ~15–20 s para 3,4 s, saída idêntica; o laço do navegador devolve a vez à tela a cada 20 notas; `putAll` (IndexedDB) rejeita no `abort` (cota estourada travava o modal); nome de cópia do Firefox (`conversations-000(1).zip`, sem espaço) reconhecido; parte auto-detectada inválida aparece como "Ignorado(s)".

**E2E (novo):** Playwright 1.62.1 headless (`npm run test:e2e`, Vite na porta 5180; `--grep @grande` / `--grep-invert @grande`). `e2e/import-claude.spec.ts` + fixtures no layout real do export (cabeçalho local ZIP64 do `conversations-000.zip`, ordem real das entradas do antigo, JSON no estilo `json.dumps`). No código antigo: 8 ok, 2 falhas esperadas — texto `data-*.zip` e o export de 647 MB, que no navegador **não dava erro**: o `TextDecoder` devolvia string vazia e o modal mostrava "concluída" com **0 conversas**.

**Validação:** `npm test` (92 casos), `tsc -b`, `tsc -p e2e/tsconfig.json`, `vite build`, `cargo check` (ACL gerada com as 3 permissões novas), `npm run test:e2e` (11/11, export de 647 MB em 8,2 s no Chromium). Testes temporários (apagados) sobre os exports reais de Downloads: agosto (98) e setembro (106) com notas **idênticas** às do pipeline antigo; export de 711 MB lido em 6,7 s (1290 conversas, ~500 MB de RSS), onde o antigo estoura; cortesias nova = antiga nas 1266 notas reais. O caminho desktop (FileHandle do Tauri) não tem E2E — validado por tipos, ACL e revisão.

---

### 04/10/2026 — v0.12.0: busca dentro da nota (lupa flutuante / Ctrl+F)

**Contexto:** a busca global filtra a lista e realça termos, mas não havia como procurar um trecho **dentro** da nota aberta nem navegar entre as ocorrências. Ctrl+F caía no find nativo do WebView2.

**Mudança:** lupa flutuante no canto superior direito da nota (`NoteFind` + `NoteFindBar`); ao clicar ou com Ctrl+F vira a barra: input, contador "N de M", anterior/próxima (Shift+Enter / Enter), fechar (Esc). Comparação sem distinguir maiúsculas nem acentos ("acao" acha "ação"), substring literal — lógica pura em `lib/noteFind.ts` (`foldText` com mapa de posições para o texto original, `findMatches`, `stepIndex`). O termo vai para a store (`findTerm`); enquanto ativo, o viewer mostra só os `<mark class="hl-find">` da busca na nota (suprime o realce global) e a régua de ticks passa a acompanhá-lo. Navegação é imperativa sobre o DOM (classe `hl-find--current`, âmbar, + `scrollIntoView`), sem re-parsear o markdown a cada Enter; termo com debounce de 150 ms. De quebra: `highlight.tsx` deixou de aninhar `<mark>` dentro de `<mark>` (`li > p`, `p > code` duplicavam ocorrências) e o `wrap` do viewer passou a repassar as props originais (`className` de `code`, `align` de `td`) sem vazar o `node` do react-markdown. `SearchIcon` extraído para `icons.tsx`.

**Validação:** `npm test` (50 casos: 23 em `noteFind.test.ts`, 12 em `highlight.test.ts`, 15 do Cursor), `tsc -b`, `vite build`, `npx tauri build --no-bundle` (release local).

---

### 19/09/2026 — v0.11.1: hotfix — app abria com a janela invisível

**Contexto:** após atualizar para a 0.11.0 o app "não abria": o processo `app.exe` ficava vivo com a janela `Cofre de Notas` oculta. A janela nasce com `visible: false` (commit de julho "janela sem flash branco", que nunca tinha virado release) e o `main.tsx` chama `getCurrentWindow().show()` — mas `core:window:default` **não inclui `allow-show`**, o ACL nega e o `.catch` engole o erro. Reproduzido com o exe release local (`EnumWindows` → `Tauri Window vis=False`) e confirmado no `acl-manifests.json` gerado pelo build.

**Mudança:** `core:window:allow-show` na capability + fallback no Rust (`lib.rs` setup: 2,5 s depois, se a janela ainda estiver oculta, `show()`), para nunca mais depender só do JS.

**Validação:** `cargo check`, `npm run build`; exe release local aberto e enumerado → janela visível.

---

### 19/09/2026 — v0.11.0: badge de versão + "Buscar atualizações"

**Contexto:** o app só avisava de versão nova ao abrir; não dava para ver qual versão estava instalada nem forçar a checagem (padrão já existente no VENDASMODULO).

**Mudança:** badge `vX.Y.Z` na toolbar (`VersionBadge`, versão vem do `package.json` via `define` do Vite → `APP_VERSION`). Clique = checagem manual pelo updater: mostra "nova versão disponível" (com instalar/reiniciar), "já está na versão mais recente", ou erro de rede; no navegador avisa que é só no desktop. O `UpdateBanner` também recheca sozinho a cada 4h com o app aberto.

**Validação:** `npm test`, `tsc -b`, `vite build`, `cargo check`.

---

### 19/09/2026 — v0.10.0: Importar do Cursor

**Contexto:** as conversas do Cursor IDE ficam só em `~\.cursor\projects\...\agent-transcripts\<uuid>\<uuid>.jsonl` (919 principais na máquina do Marcel) e não entravam no cofre.

**Mudança:** botão **Importar do Cursor** no painel Importar (só desktop). Comando Rust `scan_cursor_transcripts` inventaria os transcripts em 1 IPC; o app compara com `<cofre>\Cursor\` por `uuid` + `updated` (nova / alterada / já no cofre), o utilizador marca o que quer e o app grava `.md` só com o diálogo (sem `tool_use` nem contexto injetado), `origem: CURSOR`, título derivado da 1ª pergunta. `state.vscdb` (SQLite) não é lido. Subagentes ficam de fora. Testes unitários do parser com vitest (`npm test`).

**Validação:** `npm test` (15 casos), `tsc -b`, `cargo check`/`clippy`; conversão de 4 transcripts reais (pequeno/médio/grande) sem tags residuais. Além disso, o script `2605-202606-AbrirServerPowerShell.ps1` passou a apontar para a pasta canónica.

---

### 20/07/2026 — v0.9.2: marcadores amarelos na barra de rolagem

**Contexto:** com busca ativa, os `<mark>` no viewer não tinham overview na scrollbar.

**Mudança:** faixa de ticks amarelos (overview ruler) na borda direita do viewer — um traço por ocorrência; clique salta ao trecho. Demo em `docs/demo-scrollbar-markers.html`.

**Validação:** abrir nota com matches → ticks na direita; clicar → scroll ao highlight.

---

### 29/06/2026 10:23 Segunda — reorganização de pastas no workspace

**Contexto:** existiam três cópias locais do mesmo app apontando para o mesmo GitHub.

| Pasta (antes) | Estado | Ação |
|---------------|--------|------|
| `cofre-notas/` | v0.8.0, clone canónico | Substituída pela pasta com nome oficial |
| `2605_APPLEITOR_LeitorNotasPC/` | v0.7.0, clone duplicado e desatualizado | **Removida** |
| `2606_COFRENOTAS-LeitorNotasObsidianAPP/` | — | **Pasta canónica** a partir desta data |

**Decisões:**

- Manter **uma só** cópia de desenvolvimento: `2606_COFRENOTAS-LeitorNotasObsidianAPP/`.
- **Não** renomear o repositório GitHub nem o `productName` / `identifier` do Tauri.
- Publicação de releases continua via `publicar.ps1` e tag `v*` no repo `marcel-ceceu/cofre-notas`.

**Validação:** após limpeza, só deve existir `2606_COFRENOTAS-LeitorNotasObsidianAPP/`; `git log -1` → `de68091` (v0.8.0).

---

## Releases (resumo funcional)

| Versão | Data (release) | Destaques |
|--------|----------------|-----------|
| **0.13.0** | 05/10/2026 | Importar Claude no export novo (`conversations-000.zip`, partes -001…): leitura em fluxo (export de 711 MB), validação pelo diretório central, aviso de .zip corrompido, cortesias ~5× mais rápida; E2E Playwright |
| **0.12.0** | 04/10/2026 | Busca dentro da nota: lupa flutuante / Ctrl+F, sem maiúsculas/acentos, contador N de M, Enter/Shift+Enter, ocorrência atual em âmbar |
| **0.11.1** | 19/09/2026 | Hotfix: janela invisível ao abrir (ACL sem `window:allow-show` + fallback de `show()` no Rust) |
| **0.11.0** | 19/09/2026 | Badge de versão na toolbar + "Buscar atualizações" manual; rechecagem automática a cada 4h |
| **0.10.0** | 19/09/2026 | Importar do Cursor: scan Rust dos transcripts, seleção com anti-duplicata, notas em `Cursor\` com `origem: CURSOR` |
| **0.9.2** | 20/07/2026 | Overview ruler: ticks amarelos na rolagem do viewer (matches da busca) |
| 0.9.1 | — | (patch) |
| 0.9.0 | — | Import web / PWA |
| **0.8.0** | 29/06/2026 | Destino padrão `Desktop\CAIXA DE ENTRADA\notas`; exportar rápido (selecionadas / todos pesquisados) |
| 0.7.0 | 19/06/2026 | Exportar a partir de lista colada de caminhos |
| 0.6.0 | 19/06/2026 | Seleção múltipla nos resultados; menu «Copiar caminhos» |
| 0.5.0 | — | Operadores de busca (E, OU, excluir, frase, `title:` / `body:`) |
| 0.4.0 | — | Busca por conteúdo com snippet; sidebar ajustável |
| 0.3.0 | — | Importar / exportar conversas Claude |
| 0.2.0 | — | Novo logo (cristal) + favicon |
| 0.1.0 | — | Leitor Markdown, busca configurável, auto-updater |

---

## Documentos relacionados

- `docs/PLANO-IMPORTAR-CONSOLIDAR.md` — plano de absorver VaultHub no app desktop
- `publicar.ps1` — criar tag e disparar release no GitHub Actions
