# Pastas das conversas originais — padrão e fluxo

> Local fixo onde ficam as transcrições **originais** de cada fonte (ChatGPT, Claude Web, Cursor),
> antes de qualquer conferência de duplicatas ou limpeza. O cofre de notas lê o resultado limpo;
> esta pasta guarda o que veio da fonte, para poder reprocessar quando quiser.

## Estrutura

```
D:\915_CofreNotas-Conversas\
  1_Chatgpt\     conversas do ChatGPT, uma por arquivo .md (exportador do Cofre)
  2_ClaudeWeb\   exports do Claude.ai (conversations-000.zip, -001… ou data-…-batch-NNNN.zip)
  3_Cursor\      reservado para os transcripts originais do Cursor (ainda não usado pelo app)
```

Regras:

- **Uma subpasta por fonte**, com número na frente para manter a ordem (`1_`, `2_`, `3_`…).
  Fonte nova = próxima numeração (ex.: `4_ClaudeCode`).
- **Original não se edita.** O app só grava arquivo novo ou sobrescreve o mesmo arquivo com a
  mesma conversa. Limpeza e dedupe gravam em outro lugar (o cofre), nunca aqui.
- O caminho está no código em dois pontos, que precisam ficar iguais:
  - [`src/lib/import/dest.ts`](../src/lib/import/dest.ts) — `CONVERSAS_ROOT`, `CONVERSAS_SUBDIR`, `conversasDir()`
  - [`src-tauri/src/chatgpt.rs`](../src-tauri/src/chatgpt.rs) — `CONVERSAS_ROOT`, `CHATGPT_SUBDIR`

## Fluxo

| Passo | O que acontece | Onde grava | Situação |
|---|---|---|---|
| 1. Baixar | Cada fonte entrega as conversas originais | `D:\915_CofreNotas-Conversas\<n>_<Fonte>\` | ChatGPT e Claude Web prontos |
| 2. Conferir duplicatas | Mesma conversa baixada mais de uma vez fica uma só (pelo id da conversa) | pasta de originais (no download) e cofre (no import) | ChatGPT e Claude Web prontos |
| 3. Limpeza | Tira cortesias ("oi", "obrigado"…) e lixo de exportação | cofre | ChatGPT e Claude Web prontos |

### ChatGPT (`1_Chatgpt`)

O exportador é um script só ([`chatgpt_export.js`](../src-tauri/chatgpt_export.js)) que roda em dois lugares:
injetado na janela interna do Cofre, ou colado no Console do Chrome. Ao rodar, abre um **popup
centralizado**; **✕** fecha e o botão **⬇ GPT** (canto inferior direito) reabre.

**No Chrome:**

1. Copiar o script para a área de transferência (no PowerShell, na pasta do projeto):
   `Get-Content -Raw -Encoding UTF8 "src-tauri\chatgpt_export.js" | Set-Clipboard`
2. Abrir o chatgpt.com logado, **F12** → aba **Console**, Ctrl+V e Enter
   (na 1ª vez o Chrome pede para digitar `allow pasting`).
3. Vale até recarregar a página; depois de F5, colar de novo.

**Destino:** o popup mostra `Destino: D:\915_CofreNotas-Conversas\1_Chatgpt`. No Chrome, por segurança,
o navegador só grava numa pasta escolhida por você: **na 1ª vez** que clicar em Diagnosticar ou Exportar
ele abre o seletor — escolha `D:\915_CofreNotas-Conversas\1_Chatgpt`. A escolha fica guardada e é
reusada nas próximas (o Chrome pode pedir só para confirmar a permissão). **Alterar pasta** troca o
destino; o popup mostra `pasta "<nome>" (escolhida por você)` quando não é a padrão. No Cofre o destino
é sempre a pasta padrão.

**Período:** campos **De** e **Até**. O atalho ao lado só preenche as datas: últimos 7, 30, 90 dias,
último ano ou **Tudo** (De vazio = desde o início). Até vale o dia inteiro. Entra a conversa cuja
**última alteração** cai no período.

**Duplicatas (antes de exportar):** o script lê o cabeçalho dos `.md` que já estão na pasta e separa
cada conversa do período em:

| Situação | Regra | O que acontece |
|---|---|---|
| idêntica | mesmo `uuid`, mesmo `updated`, já no padrão | **ignorada**, com aviso e o nome no popup |
| alterada | mesmo `uuid`, mas mudou (ou o arquivo ainda está no formato antigo) | regravada **no mesmo arquivo** — fica 1 arquivo por conversa |
| nova | `uuid` não está na pasta | arquivo novo |

**Diagnosticar** mostra o aviso de duplicatas e a lista do que será exportado (data, nome, projeto,
marca de "alterada"), com o tempo estimado (~3 s por conversa). Não abre nem grava nenhuma conversa.
**Exportar** faz o mesmo e grava; reexportar um período sem mudanças não grava nada.

**Conferência (depois de exportar):** cada `.md` gravado é conferido contra o padrão do Cofre. O popup
mostra `Resultado: N nova(s), N substituída(s), N ignorada(s) por duplicata, N falha(s)` e
`Conferência (padrão do Cofre): X aprovada(s), Y com problema`, com o nome e o motivo de cada problema:
cabeçalho incompleto, origem errada, sem pergunta, **sem resposta do ChatGPT** (imagem gerada e
pesquisa aprofundada não são exportadas), marcador de citação sobrando ou conteúdo não suportado.
O relatório técnico completo fica no console (F12).

**Formato do arquivo — padrão do Cofre** (o mesmo das notas do Claude, conferido em
[`chatgptExport.test.ts`](../src/lib/import/chatgptExport.test.ts) com as funções do próprio Cofre):

```
---
title: "Taxas de rotativo PJ"
origem: CHATGPT
uuid: 6ae346c0-afa4-83e9-9d57-785fcb9a71b4
created: 2026-10-29T13:14:41.365Z
updated: 2026-10-29T19:56:18.897Z
projeto: ""
modelo: gpt-6-thinking
url: https://chatgpt.com/c/6ae346c0-afa4-83e9-9d57-785fcb9a71b4
exportador: gptexport 1.3.0
---

## 👤 You *(2026-10-29 13:14)*

pergunta…

## 🤖 ChatGPT *(2026-10-29 13:15)*

resposta…
```

Horários em UTC, como no Claude. Nome de arquivo novo: `AAAA-MM-DD-<titulo>-<8 do id>.md`, com a data
de **criação** (não muda quando a conversa é editada). Arquivos exportados antes da 1.3.0 (`id:`,
`alterado:`, `### Você —`) são reconhecidos e, na próxima exportação do período, regravados no padrão
com o mesmo nome.

**Depois do download — levar para o cofre (passos 2 e 3, no app):** painel **Importar** →
**Levar conversas do ChatGPT para o cofre**. O app lê os `.md` de `1_Chatgpt` (sem alterar nenhum) e
mostra cada um como:

| Situação | Regra | O que acontece |
|---|---|---|
| nova | `uuid` ainda não está no cofre | grava |
| alterada | `uuid` no cofre com outro `updated` | regrava o **mesmo arquivo** do cofre |
| já no cofre | mesmo `uuid` e mesmo `updated` | nada (escondida; "mostrar as que já estão no cofre") |
| duplicada | mesma conversa em dois arquivos da pasta | fica a de `updated` mais novo |
| fora do padrão | sem cabeçalho, origem errada ou cabeçalho incompleto | não grava; mostra o motivo |
| vazia | nenhum turno | não grava |

**Levar N para o cofre** tira as cortesias ([`cortesias.ts`](../src/lib/import/cortesias.ts)) e grava em
`ChatGPT\` dentro do cofre aberto (dá para trocar a pasta), um arquivo por conversa, com o nome
`{data de criação}-{título}.md` igual às notas do Claude. Arquivos do formato antigo do exportador (1.0–1.2)
são convertidos para o padrão na hora (o resultado é idêntico ao que o 1.3.0 grava), então não é preciso
exportar de novo. Conversa sem resposta do ChatGPT (imagem gerada, pesquisa aprofundada) entra com aviso.
Depois disso as notas aparecem na lista do cofre e seguem o resto do app como as do Claude (envio ao
Supabase com `origem: CHATGPT`). Código: [`chatgptImport.ts`](../src/lib/import/chatgptImport.ts)
(regras, testadas em [`chatgptImport.test.ts`](../src/lib/import/chatgptImport.test.ts)) e
[`runChatgptImport.ts`](../src/lib/import/runChatgptImport.ts) (leitura e gravação).

**No Cofre (como grava):** o script chama os comandos Rust `listar_conversas_chatgpt()` (nome + início
de cada `.md` de `1_Chatgpt`, para as duplicatas) e `salvar_conversa_chatgpt(nome, conteudo)`, que
aceita só um nome `.md` simples (sem pasta, sem `..`, sem caractere proibido no Windows, até 200
caracteres). A janela do chatgpt.com só pode chamar esses dois comandos — a permissão está em
[`capabilities/chatgpt.json`](../src-tauri/capabilities/chatgpt.json) e a lista de comandos do app
em [`build.rs`](../src-tauri/build.rs).

### Claude Web (`2_ClaudeWeb`)

1. Pedir o export em claude.ai (Configurações → Privacidade → Exportar dados); o link chega por e-mail.
2. Baixar os `.zip` e **salvar em `D:\915_CofreNotas-Conversas\2_ClaudeWeb\`** (pode deixar os de
   meses anteriores lá; o app pega o mais recente).
3. No Cofre, **Importar Claude** → etapa de conversão. O app procura o export mais recente primeiro em
   `2_ClaudeWeb`; se não achar nenhum lá, procura em Downloads (como antes). Dá para escolher os `.zip`
   na mão também.
4. A importação já faz os passos 2 e 3: dedupe por `uuid` (fica o `updated` mais novo) e remoção de
   cortesias, gravando no cofre (`D:\2606VAULT-ClaudeConversasOF-v2` por padrão).

### Cursor (`3_Cursor`)

Hoje o Cofre lê os transcripts direto da pasta local do Cursor e grava as notas na subpasta `Cursor\`
do cofre. A pasta `3_Cursor` fica reservada para guardar uma cópia dos originais quando esse passo
for feito.

## O que falta

- **ChatGPT, respostas por ferramenta:** imagem gerada e relatório de pesquisa aprofundada não são
  exportados (a conferência aponta quando a conversa fica sem resposta).
- **Cursor:** copiar os transcripts originais para `3_Cursor`.
