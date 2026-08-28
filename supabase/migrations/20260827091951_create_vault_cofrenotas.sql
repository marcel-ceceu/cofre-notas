-- ============================================================
-- vault_cofrenotas — acervo unificado de transcricoes de IA
--
-- Fontes: CLAUDECODE, CURSOR, CLAUDEWEB, CHATGPT.
-- Dedupe e atualizacao pela chave natural (origem, id_origem):
-- conversa nova insere, conversa que continuou sobrescreve.
-- ============================================================

create table public.vault_cofrenotas (
  -- identidade
  id              bigint generated always as identity primary key,
  origem          text        not null,
  id_origem       text        not null,

  -- conteudo
  titulo          text        not null,
  conteudo        text        not null,

  -- datas da conversa
  dtconversaini   timestamptz,
  dtconversafin   timestamptz,

  -- controle de carga
  dtinsert        timestamptz not null default now(),
  dtupdate        timestamptz not null default now(),

  -- derivadas
  hash_conteudo   text generated always as (md5(conteudo)) stored,
  -- left(...) limita a entrada do indice: um tsvector nao pode passar de ~1MB,
  -- e transcricoes grandes de codigo (alta cardinalidade) estourariam isso e
  -- fariam o INSERT falhar. 600k chars de corpo dao busca de sobra.
  busca           tsvector generated always as (
                    setweight(to_tsvector('portuguese', left(coalesce(titulo, ''), 2000)),     'A') ||
                    setweight(to_tsvector('portuguese', left(coalesce(conteudo, ''), 600000)), 'B')
                  ) stored,

  constraint vault_cofrenotas_origem_ck
    check (origem in ('CLAUDECODE', 'CURSOR', 'CLAUDEWEB', 'CHATGPT')),

  constraint vault_cofrenotas_periodo_ck
    check (dtconversafin >= dtconversaini),

  constraint vault_cofrenotas_conversa_uk
    unique (origem, id_origem)
);

-- ------------------------------------------------------------
-- Indices
-- ------------------------------------------------------------
create index vault_cofrenotas_busca_ix
  on public.vault_cofrenotas using gin (busca);

create index vault_cofrenotas_recentes_ix
  on public.vault_cofrenotas (dtconversafin desc nulls last);

create index vault_cofrenotas_origem_ix
  on public.vault_cofrenotas (origem, dtconversafin desc);

-- ------------------------------------------------------------
-- dtupdate automatico
-- dtinsert NAO e tocado: preserva a data da primeira carga
-- mesmo quando a conversa e reescrita por um reprocessamento.
-- ------------------------------------------------------------
create or replace function public.tg_vault_cofrenotas_dtupdate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.dtupdate := now();
  return new;
end;
$$;

create trigger vault_cofrenotas_dtupdate_tg
  before update on public.vault_cofrenotas
  for each row execute function public.tg_vault_cofrenotas_dtupdate();

-- ------------------------------------------------------------
-- RLS — obrigatoria: a tabela esta no schema public e portanto
-- exposta na API do projeto. Sem isso, qualquer portador da
-- chave anon le o acervo inteiro.
--
-- O app usa a chave anon (publica), entao NENHUMA policy libera anon:
-- a leitura/gravacao passa pelas funcoes cofre_* (SECURITY DEFINER), que
-- conferem a senha unica — ver 20260827120000_cofre_senha_unica.sql.
-- A policy abaixo cobre so o acesso autenticado (painel/scripts futuros).
-- Para multiusuario, adicionar user_id uuid references auth.users
-- e trocar o using/with check por (user_id = auth.uid()).
-- ------------------------------------------------------------
alter table public.vault_cofrenotas enable row level security;

create policy vault_cofrenotas_rw
  on public.vault_cofrenotas
  for all
  to authenticated
  using (true)
  with check (true);

-- ------------------------------------------------------------
-- Documentacao (aparece no Table Editor do Supabase)
-- ------------------------------------------------------------
comment on table  public.vault_cofrenotas               is 'Transcricoes de conversas de IA de todas as fontes.';
comment on column public.vault_cofrenotas.origem        is 'Plataforma de origem: CLAUDECODE, CURSOR, CLAUDEWEB ou CHATGPT.';
comment on column public.vault_cofrenotas.id_origem     is 'ID da conversa na plataforma de origem — chave do upsert.';
comment on column public.vault_cofrenotas.titulo        is 'Titulo original da conversa.';
comment on column public.vault_cofrenotas.conteudo      is 'Transcricao completa em markdown.';
comment on column public.vault_cofrenotas.dtconversaini is 'Data/hora da primeira mensagem.';
comment on column public.vault_cofrenotas.dtconversafin is 'Data/hora da ultima mensagem.';
comment on column public.vault_cofrenotas.dtinsert      is 'Primeira carga desta conversa; nao muda em reprocessamento.';
comment on column public.vault_cofrenotas.dtupdate      is 'Ultima vez que a linha foi reescrita.';
comment on column public.vault_cofrenotas.hash_conteudo is 'md5 do conteudo — permite pular reenvio identico.';
comment on column public.vault_cofrenotas.busca         is 'Indice de texto completo (pt-BR); titulo com peso A, corpo com peso B.';
