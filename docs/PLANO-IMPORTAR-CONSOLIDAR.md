# Plano — Trazer "Importar Claude" + "Vault Copy" para dentro do Cofre de Notas

> Objetivo: absorver as funcionalidades do projeto **606-14 VAULTCLAUDE — Importar/Exportar Conversas**
> (doravante **VaultHub**) para dentro do **Cofre de Notas** (app Tauri), de forma **nativa**, eliminando
> a dependência de PowerShell externo, do drive `D:` fixo e da limitação "só Chrome/Edge" da versão web.

---

## 1. Contexto

| | VaultHub (origem) | Cofre de Notas (destino) |
|---|---|---|
| Stack | TanStack Start + Vite + React 19 + shadcn/ui (Lovable) | Tauri 2 + Vite + React 18 + Tailwind 4 + zustand |
| Tipo | App **web** (roda no browser) | App **desktop** nativo (Windows) |
| Acesso a disco | File System Access API (Chrome/Edge, com prompts) | `@tauri-apps/plugin-fs` nativo (qualquer caminho) |
| Importar Claude | Motor em **PowerShell** (`scripts/pipeline/`); a UI só **copia o comando** pra colar no terminal | — (a criar) |
| Persistência | IndexedDB (handles, prefs, API key) | localStorage + (a adicionar) `plugin-store` |
| Saída fixa | `D:\2606VAULT-ClaudeConversasOF[-FINAL]` | pasta escolhida pelo usuário (sem hardcode) |

**Tese:** o Cofre já abre o vault, lê, busca e exporta caminhos de `.md`. Falta exatamente o que o
VaultHub faz: **trazer conversas pra dentro** (importar) e **levar conversas pra fora consolidadas**
(copiar/merge/IA). Fazer isso dentro do Cofre unifica o ciclo num único app desktop offline.

---

## 2. O que o VaultHub faz hoje (resumo técnico das fontes)

### 2.1 Importar Claude — pipeline em 2 etapas
Fonte: `scripts/pipeline/_Core.ps1`, `Run-Pipeline-Auto.ps1`, `2606-RegexRegrasConversas.txt`.

**Etapa 1 — Conversor (`Invoke-Conversor`): ZIP → `.md` limpo**
1. Acha o `data-*.zip` mais recente em `Downloads` (suporta multi-batch `...batch-0000.zip`, `batch-0001`…).
2. Descompacta cada batch num diretório temporário.
3. Lê todos os `conversations.json`; **deduplica por `uuid`** mantendo o de `updated_at` mais novo.
4. Filtro opcional por data (últimos N dias).
5. Por conversa: para cada `chat_message`, junta **apenas blocos `content[].type === 'text'`**
   (é isso que descarta o *thinking*/tool-calls). Monta turnos `## 👤 You *(ts)*` / `## 🤖 Claude *(ts)*`.
6. Escreve `.md` com frontmatter YAML (`title`, `uuid`, `created`, `updated`) + turnos.
7. Nome do arquivo: `{yyyy-MM-dd}-{slug}.md` (slug sanitizado, ≤55 chars, sufixo de uuid em colisão).

**Etapa 2 — Cortesias (`Invoke-Cortesias`): remove "oi/obrigado/ok…" → pasta `-FINAL`**
1. Carrega lista de cortesias (normaliza: minúsculas, sem acento, sem pontuação).
2. Por `.md`: separa YAML; **protege code fences** (` ``` `) com placeholders; quebra em turnos pelo header.
3. Em cada turno remove parágrafos/frases de cortesia do **início e fim**; turno 100% cortesia é descartado.
4. Reassembla, restaura code fences. **Incremental**: pula arquivos já processados (compara mtime) salvo `-Force`.

> Hoje a UI web **não roda** isso — ela exibe o comando `pwsh -File Run-Pipeline-Auto.ps1` para o usuário
> colar num terminal (`src/lib/pipeline.config.ts`, rota `src/routes/importar-claude.tsx`).

### 2.2 Vault Copy — extração / consolidação
Fonte: `src/routes/vault-copy.tsx`, `src/lib/vaultCopy.ts`, `vaultCopyAi.ts`, `vaultCopyExport.ts`, `vaultFs.ts`.

- Seleciona pasta **vault** (origem) + **destino**; detecta "layout" do vault (subpasta de conteúdo).
- O usuário **cola uma lista de caminhos** (absoluto, `[[wikilink]]`, basename, relativo) →
  `parsePasteLines` normaliza para caminhos relativos ao vault e valida.
- 4 ações de export:
  1. **Copiar arquivos** → copia os `.md` selecionados para subpasta datada no destino.
  2. **Consolidado sem IA** → junta tudo num único `.md` (índice + transcrições — `buildImportConsolidado`).
  3. **Consolidado com IA** → idem, mas cada nota ganha `titulo`/`resumo`/`tags` gerados por IA no índice.
  4. **Copiar + llms.txt** → copia + gera `llms.txt` (índice com resumos — `buildLlmsTxtBody`).
- **IA**: chama `https://api.anthropic.com/v1/messages` **direto do browser**
  (`anthropic-dangerous-direct-browser-access: true`), structured output (schema `titulo/resumo/tags`),
  modelos Sonnet 4.6 / Haiku 4.5, prompt configurável com presets. API key guardada em IndexedDB.
- Limpeza `cleanExportMarkdown` remove lixo "This block is not supported…" (o Cofre já faz algo parecido
  em [NoteViewer.tsx](../src/components/NoteViewer.tsx) via `SKIP_BLOCK_PATTERNS`).

### 2.3 Limitações da versão atual (que o Cofre resolve)
- Exige Chrome/Edge (File System Access API) e prompts de permissão repetidos.
- Caminhos `D:` chumbados no script; precisa de drive `D:`.
- Importar exige sair do app e colar comando no PowerShell.
- Dois apps separados (web + scripts) para um fluxo só.

---

## 3. Por que portar para o Cofre (Tauri) é vantajoso
- **FS nativo** (`plugin-fs`): lê/escreve qualquer caminho, sem prompt da File System Access API.
- **Sem hardcode de `D:`**: o usuário escolhe a pasta de saída (ou usa o próprio vault aberto).
- **Unzip nativo**: via lib JS (`fflate`) ou comando Rust (`zip`) — sem depender de `Expand-Archive`.
- **IA sem CORS**: `@tauri-apps/plugin-http` chama a API Anthropic sem o bloqueio de CORS do webview.
- **Ciclo único**: importar → ler → buscar → consolidar no mesmo app offline já com auto-update.
- **Reuso direto**: a busca/seleção do Cofre ([search.ts](../src/lib/search.ts),
  [CopyResultsModal.tsx](../src/components/CopyResultsModal.tsx)) vira o "selecionar notas" do Vault Copy —
  sem precisar colar caminhos manualmente.

---

## 4. Mapa de migração (VaultHub → Cofre)

| Funcionalidade VaultHub | Como entra no Cofre | Reuso/observação |
|---|---|---|
| Etapa 1 — ZIP → `.md` (`Invoke-Conversor`) | `src/lib/import/claudeImport.ts` (port TS) + unzip | núcleo; substitui o `.ps1` |
| Etapa 2 — cortesias (`Invoke-Cortesias`) | `src/lib/import/cortesias.ts` (port TS) + regras embutidas/editáveis | incremental por mtime |
| Achar `data-*.zip` em Downloads | `plugin-dialog` (escolher) + `plugin-fs` (auto-detectar) | sem caminho fixo |
| Log no Notepad | Modal de progresso/log in-app | melhor UX |
| Vault Copy — colar caminhos | **Usar a seleção da busca** do Cofre | dispensa colagem manual |
| Copiar arquivos | `src/lib/export/copyFiles.ts` (`plugin-fs` copy) | subpasta datada |
| Consolidado sem IA | `src/lib/export/consolidate.ts` (`buildImportConsolidado`) | porta direta de `vaultCopy.ts` |
| Consolidado com IA / llms.txt | `src/lib/export/ai.ts` via `plugin-http` | porta de `vaultCopyAi.ts` |
| API key + presets de prompt | `plugin-store` (arquivo local) | era IndexedDB |
| `cleanExportMarkdown` | reaproveitar `SKIP_BLOCK_PATTERNS` do Cofre | já existe parcial |

---

## 5. Decisões de arquitetura

**Onde mora a lógica:** TypeScript no webview (rápido de portar do `_Core.ps1`, fácil de testar).
Só migrar para comando **Rust** se o unzip/parse de exports muito grandes (centenas de MB) ficar lento.

**Dependências novas (JS):**
- `fflate` — unzip puro JS, leve e rápido (Etapa 1).
- `@tauri-apps/plugin-http` — chamadas à API Anthropic sem CORS (IA).
- `@tauri-apps/plugin-store` — guardar API key + presets de prompt em arquivo local.

**Plugins Rust correspondentes** (em `src-tauri/Cargo.toml` + registro em `lib.rs` + permissões em
`capabilities/default.json`): `tauri-plugin-http`, `tauri-plugin-store`. (FS e dialog já existem.)

**Estrutura de módulos proposta:**
```
src/lib/import/
  zip.ts            # descompacta data-*.zip (fflate)
  claudeImport.ts   # Etapa 1: conversations.json -> Note[]/.md  (port _Core Get-MsgText/slug/frontmatter)
  cortesias.ts      # Etapa 2: normaliza + remove cortesias       (port ConvertTo-Norm/Get-CleanTurn)
  cortesias.rules.ts# lista default (de 2606-RegexRegrasConversas.txt), editável nas prefs
src/lib/export/
  copyFiles.ts      # copiar .md selecionados p/ subpasta datada
  consolidate.ts    # 1 .md (índice + transcrições)               (port buildImportConsolidado/llms)
  ai.ts             # summarizeConversation via plugin-http        (port vaultCopyAi)
src/components/
  ImportClaudeModal.tsx   # UI da importação (escolher zip/saída, progresso, log)
  ConsolidateModal.tsx    # UI de consolidar/copiar (usa resultados da busca + destino + IA)
src/store/
  importStore.ts / exportPrefs (ou estender vaultStore)
```

**Segurança da API key:** arquivo local via `plugin-store` (não vai pro Git, fica no perfil do usuário).
Mesma postura do VaultHub (nunca sai do dispositivo, exceto a chamada autenticada à própria Anthropic).

---

## 6. Roadmap em fases

> Cada fase é entregável e testável sozinha. Recomendo seguir na ordem (valor decrescente, risco crescente).

### Fase 0 — Scaffolding (preparação)
- Adicionar deps: `fflate`, `@tauri-apps/plugin-http`, `@tauri-apps/plugin-store` (JS + Cargo + registro + permissões).
- Criar as pastas `src/lib/import`, `src/lib/export`.
- **Pronto quando:** `npm run build` + `cargo check` passam com os plugins registrados.

### Fase 1 — Importar Claude, Etapa 1 (MVP, maior valor) ⭐
- `zip.ts` (descompacta), `claudeImport.ts` (parse + dedup por uuid + monta `.md`).
- `ImportClaudeModal`: botão "Importar conversas do Claude" → escolher `data-*.zip` (ou auto-achar em
  Downloads) → escolher pasta de saída (default: o próprio vault aberto) → barra de progresso + resumo.
- Após importar, **recarregar o vault** → as conversas aparecem na lista do Cofre.
- **Pronto quando:** um `data-*.zip` real vira `.md` (frontmatter + turnos You/Claude, sem thinking),
  idêntico ao que o `_Core.ps1` produz, e as notas abrem no Cofre.

### Fase 2 — Importar Claude, Etapa 2 (cortesias)
- `cortesias.ts` + `cortesias.rules.ts` (lista default editável).
- Toggle no `ImportClaudeModal`: "Gerar também versão sem cortesias" (saída separada ou sobrescrita opcional).
- Incremental: pular o que já foi processado.
- **Pronto quando:** turnos de só-cortesia somem, code fences ficam intactos, e reprocessar não duplica.

### Fase 3 — Copiar / Consolidar sem IA (reusa a busca)
- `copyFiles.ts` + `consolidate.ts`.
- `ConsolidateModal`: parte da **seleção da busca atual** (estende o
  [CopyResultsModal](../src/components/CopyResultsModal.tsx)) → escolher destino → ações
  "Copiar arquivos" e "Consolidar (1 .md)".
- **Pronto quando:** N notas filtradas viram arquivos copiados numa subpasta datada, e um consolidado
  com índice + transcrições é gravado.

### Fase 4 — Consolidação com IA + llms.txt
- `ai.ts` (`summarizeConversation` via `plugin-http`), `plugin-store` p/ API key + presets de prompt.
- Ações "Consolidado com IA" e "Copiar + llms.txt"; modal de configurações (chave, modelo, prompt presets).
- **Pronto quando:** cada nota recebe `titulo/resumo/tags` da IA no índice/llms, com fallback se a chamada falhar.

### Fase 5 — Polish
- Persistir pasta de destino e preferências; estados de progresso por item (LER/IA/CPY/OK/FAIL/SKIP);
  tratamento de erros e cancelamento; entradas no menu/título do app.

---

## 7. Integração com o que o Cofre já tem
- **Busca → seleção:** `filterNotes/queryNotes` já produzem a lista; o `CopyResultsModal` já copia caminhos.
  Basta estender para "copiar/consolidar os arquivos", não só os caminhos.
- **Limpeza de lixo:** `SKIP_BLOCK_PATTERNS` do `NoteViewer` cobre o "This block is not supported"; centralizar
  num `src/lib/clean.ts` compartilhado por viewer + import + export.
- **Auto-update:** as features novas entram nas próximas versões e chegam sozinhas via updater já configurado.
- **Persistência:** seguir o padrão de `vaultStore` (localStorage) + `plugin-store` para segredos.

---

## 8. Riscos e mitigações
| Risco | Mitigação |
|---|---|
| Export gigante (centenas de MB) lento no unzip/parse em JS | medir; se preciso, mover Etapa 1 p/ comando Rust (`zip` + `serde_json`) |
| Paridade exata da limpeza de cortesias (normalização/acentos) | portar `ConvertTo-Norm`/`Get-CleanTurn` com testes lado a lado vs saída do `.ps1` |
| CORS na API Anthropic | usar `plugin-http` (bypassa CORS) em vez de `fetch` do webview |
| Vazamento de API key | `plugin-store` em arquivo do perfil; nunca versionar; nunca logar |
| Estrutura do export do Claude mudar | isolar o parsing em `claudeImport.ts` com guarda de formato + log claro |
| Escrita acidental sobre o vault | saída default em subpasta; confirmar antes de sobrescrever |

---

## 9. O que **não** portar
- Scaffolding TanStack/shadcn e os ~50 componentes `ui/*` (o Cofre usa Tailwind puro + componentes próprios).
- Persistência por **handles** da File System Access API (no Tauri usamos **caminhos**).
- A abordagem "copiar comando pro PowerShell" (substituída por execução nativa in-app).
- Caminhos fixos `D:\2606VAULT-…` (passam a ser escolha do usuário).

---

## 10. Próximo passo recomendado
Implementar **Fase 0 + Fase 1** (Importar Etapa 1) como primeira entrega — é o maior ganho (mata o
pipeline PowerShell) e valida unzip + parse + escrita nativos. As notas importadas já aparecem na lista do
Cofre, fechando o ciclo "importar → ler → buscar" num app só. Cortesias (Fase 2) e Consolidar/IA
(Fases 3–4) entram em seguida, cada uma como release incremental via o auto-updater.

---

*Plano gerado em 14/06/2026 · fonte analisada: `C:\projetos\606-14_VAULTCLAUDE-ImportarExportarConversas`*
