# Cofre de Notas

App desktop (Tauri v2 + React) que lê um cofre de notas `.md` no estilo Obsidian —
transcrições de conversas de IA exportadas do Claude.ai e afins — com busca,
consolidação e sincronização para o Supabase.

## Abrir o app

**Uso normal:** rode o instalador
`src-tauri/target/release/bundle/nsis/Cofre de Notas_0.9.2_x64-setup.exe`,
ou abra direto o executável `src-tauri/target/release/app.exe` (o nome vem do
pacote Cargo; o instalador é que cria o atalho "Cofre de Notas"). Não precisa
de terminal aberto.

Para gerar esses artefatos:

```bash
npm run tauri build
```

A assinatura do updater exige `TAURI_SIGNING_PRIVATE_KEY` apontando para o
conteúdo de `~/.tauri/cofre-notas.key`.

**Desenvolvimento:**

```bash
npm install
npm run tauri dev
```

O app também roda no navegador (`npm run dev`, porta 5173), mas nesse modo a
pasta aberta é somente-leitura: gravar o cabeçalho padrão exige o app desktop
ou o cofre do navegador (IndexedDB, alimentado pela importação `.zip`).

## Sincronização com o Supabase

A sincronização é opcional. Sem `.env`, o app funciona normalmente como leitor —
o painel de sincronização só avisa que está desativado.

### 1. Criar o `.env`

Na raiz do projeto (o arquivo não vai para o git), em **UTF-8 sem BOM**:

```
VITE_SUPABASE_URL=https://SEU_PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

Copie os dois valores do **painel do Supabase** (Project Settings → API), nunca
de uma mensagem de chat, e-mail ou PDF: a colagem pode trazer caracteres
invisíveis e o app quebra com um erro que não diz a causa
(`String contains non ISO-8859-1 code point`). O app confere isso ao abrir o
modal e aponta a posição do caractere problemático.

A chave `anon` é pública por natureza — o Vite a embute no bundle distribuído.
**Nunca coloque a `service_role` aqui**, ela viajaria dentro do instalador.

O Vite lê o `.env` só na inicialização: depois de editar, reinicie o app.

### 2. Aplicar as migrations

Em `supabase/migrations/`, na ordem:

| Arquivo | O que cria |
|---|---|
| `20260827091951_create_vault_cofrenotas.sql` | A tabela `vault_cofrenotas` |
| `20260827120000_cofre_senha_unica.sql` | `cofre_config` + as funções `cofre_check` / `cofre_hashes` / `cofre_upsert` |

### 3. Definir a senha do cofre

O acesso não usa Supabase Auth — é uma senha única, guardada como hash bcrypt.
Rode no SQL Editor do Supabase (nunca dentro do app):

```sql
insert into public.cofre_config (id, senha_hash)
values (1, extensions.crypt('SUA_SENHA', extensions.gen_salt('bf', 10)))
on conflict (id) do update set senha_hash = excluded.senha_hash;
```

A tabela fica fechada na API: nenhuma policy libera `anon`. Toda leitura e
gravação passa pelas três funções `SECURITY DEFINER`, que conferem a senha
antes de qualquer coisa. Ou seja, quem tiver a chave anon do bundle não
alcança o acervo sem a senha.

## Como o envio decide o que fazer

Cada conversa tem uma chave natural `(origem, id_origem)`, tirada do
frontmatter (`origem` + `uuid`):

- chave não existe no banco → **insere**
- existe e o `md5` do conteúdo mudou → **atualiza**
- existe e está idêntica → **pula**

O envio **nunca apaga**. Repetir é seguro: a reconciliação é refeita contra o
banco imediatamente antes de gravar, então uma queda no meio se resolve
rodando de novo.

Só entram notas com o cabeçalho completo (`title`, `origem`, `uuid`, `created`,
`updated`). O botão **Padronizar cabeçalho** insere o `origem` que estiver
faltando, com backup `.bak` ao lado de cada arquivo alterado. Hoje a detecção
automática de origem só reconhece `CLAUDEWEB`; as demais aparecem como
"pendente(s) de regra por origem".

## Estrutura

```
src/lib/supabase/    cliente, auth por senha, mapeamento nota→linha, upload
src/lib/import/      frontmatter, cabeçalho padrão, importação .zip
src/components/      rail lateral, painéis, modal de sincronização
supabase/migrations/ DDL versionado
src-tauri/           shell desktop (Rust)
```
