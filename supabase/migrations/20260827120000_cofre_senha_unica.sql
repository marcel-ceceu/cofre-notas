-- ============================================================
-- Acesso ao cofre por SENHA UNICA (sem Supabase Auth).
--
-- O app desktop carrega a chave anon, que e publica. Por isso a
-- tabela vault_cofrenotas NAO fica exposta na API: nenhuma policy
-- libera anon. Todo acesso passa por estas funcoes SECURITY DEFINER,
-- que conferem a senha (bcrypt em cofre_config) antes de ler/gravar.
--
-- Definir/trocar a senha (rodar no SQL Editor, nunca no app):
--   insert into public.cofre_config (id, senha_hash)
--   values (1, extensions.crypt('NOVA_SENHA', extensions.gen_salt('bf', 10)))
--   on conflict (id) do update set senha_hash = excluded.senha_hash;
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

-- ------------------------------------------------------------
-- Cofre da senha. Linha unica (id = 1). Fechada na API: sem policy,
-- so as funcoes abaixo (SECURITY DEFINER) enxergam o hash.
-- ------------------------------------------------------------
create table if not exists public.cofre_config (
  id          smallint primary key default 1,
  senha_hash  text not null,
  dtupdate    timestamptz not null default now(),
  constraint cofre_config_linha_unica_ck check (id = 1)
);

alter table public.cofre_config enable row level security;

comment on table public.cofre_config is
  'Senha unica do cofre (hash bcrypt). Sem policy: so acessivel pelas funcoes cofre_*.';

-- ------------------------------------------------------------
-- cofre_check — a senha confere?
-- ------------------------------------------------------------
create or replace function public.cofre_check(p_senha text)
returns boolean
language sql
security definer
set search_path = 'public', 'extensions'
as $$
  select exists (
    select 1 from public.cofre_config
    where id = 1 and senha_hash = extensions.crypt(p_senha, senha_hash)
  );
$$;

-- ------------------------------------------------------------
-- cofre_hashes — reconciliacao (dry-run).
-- Devolve so (origem, id_origem, hash) das conversas pedidas: o app
-- compara com o md5 local para decidir inserir / atualizar / pular.
-- Nao expoe conteudo.
-- ------------------------------------------------------------
create or replace function public.cofre_hashes(p_senha text, p_ids text[])
returns table (origem text, id_origem text, hash_conteudo text)
language plpgsql
security definer
set search_path = 'public', 'extensions'
as $$
begin
  if not public.cofre_check(p_senha) then
    raise exception 'senha incorreta';
  end if;
  return query
    select v.origem, v.id_origem, v.hash_conteudo
    from public.vault_cofrenotas v
    where v.id_origem = any (p_ids);
end;
$$;

-- ------------------------------------------------------------
-- cofre_upsert — grava um lote.
-- Chave natural (origem, id_origem): nova insere, existente atualiza.
-- Nunca apaga. Retorna quantas linhas foram afetadas.
-- ------------------------------------------------------------
create or replace function public.cofre_upsert(p_senha text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = 'public', 'extensions'
as $$
declare n integer;
begin
  if not public.cofre_check(p_senha) then
    raise exception 'senha incorreta';
  end if;

  insert into public.vault_cofrenotas
    (origem, id_origem, titulo, conteudo, dtconversaini, dtconversafin)
  select r.origem, r.id_origem, r.titulo, r.conteudo, r.dtconversaini, r.dtconversafin
  from jsonb_to_recordset(p_rows) as r(
    origem        text,
    id_origem     text,
    titulo        text,
    conteudo      text,
    dtconversaini timestamptz,
    dtconversafin timestamptz
  )
  on conflict (origem, id_origem) do update set
    titulo        = excluded.titulo,
    conteudo      = excluded.conteudo,
    dtconversaini = excluded.dtconversaini,
    dtconversafin = excluded.dtconversafin;

  get diagnostics n = row_count;
  return n;
end;
$$;

-- ------------------------------------------------------------
-- Somente estas tres portas ficam abertas para a chave anon.
-- ------------------------------------------------------------
revoke all on function public.cofre_check(text)          from public;
revoke all on function public.cofre_hashes(text, text[]) from public;
revoke all on function public.cofre_upsert(text, jsonb)  from public;

grant execute on function public.cofre_check(text)          to anon, authenticated;
grant execute on function public.cofre_hashes(text, text[]) to anon, authenticated;
grant execute on function public.cofre_upsert(text, jsonb)  to anon, authenticated;
