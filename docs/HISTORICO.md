# Histórico — Cofre de Notas (leitor Obsidian / vault Markdown)

## Identificação do projeto

| Item | Valor |
|------|--------|
| **Pasta canónica (workspace)** | `2606_COFRENOTAS-LeitorNotasObsidianAPP/` |
| **Nome do app (UI / instalador)** | Cofre de Notas |
| **Repositório GitHub** | [marcel-ceceu/cofre-notas](https://github.com/marcel-ceceu/cofre-notas) |
| **Stack** | Tauri 2 + Vite + React 18 + Tailwind 4 |
| **Versão atual** | **0.9.2** (tag `v0.9.2`) |
| **Auto-update** | GitHub Releases + `latest.json` + `UpdateBanner` |

> O **nome da pasta local** segue a convenção `2606_*` do workspace. O **repo remoto** e o **identificador Tauri** (`com.marcel.cofre-notas`) mantêm-se `cofre-notas` para não quebrar releases nem updates já instalados.

---

## Entradas de histórico

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
