/**
 * Cliente Supabase — configurado por variáveis de ambiente do Vite.
 *
 * Usa a ANON KEY (nunca a service_role no app: o pacote é distribuível e a
 * chave viajaria junto). A autorização de escrita depende da RLS da tabela
 * vault_cofrenotas — ver nota na migration.
 *
 * Config em .env (não versionado):
 *   VITE_SUPABASE_URL=https://xxxx.supabase.co
 *   VITE_SUPABASE_ANON_KEY=eyJ...
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null | undefined;

export function isSupabaseConfigured(): boolean {
  return Boolean(
    import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY
  );
}

/**
 * A chave vai em um header HTTP, que só aceita Latin-1. Um caractere colado
 * torto (acento invisível, letra de outro alfabeto) faz o fetch estourar com
 * "String contains non ISO-8859-1 code point" — erro que não diz o que houve.
 * Conferimos antes para devolver uma mensagem acionável.
 */
export function configProblem(): string | null {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return null; // ausência de config é tratada em outro lugar

  for (const [nome, valor] of [
    ["VITE_SUPABASE_URL", url],
    ["VITE_SUPABASE_ANON_KEY", key],
  ] as const) {
    // Percorrido por code point: a posição e o código relatados vêm da mesma
    // fatia, então continuam batendo mesmo se houver um par substituto antes.
    const chars = [...valor];
    const i = chars.findIndex((ch) => (ch.codePointAt(0) ?? 0) > 126);
    if (i >= 0) {
      const cp = (chars[i].codePointAt(0) ?? 0)
        .toString(16)
        .toUpperCase()
        .padStart(4, "0");
      return `${nome} tem um caractere inválido na posição ${i} (U+${cp}). Recopie o valor do painel do Supabase para o .env e reinicie o app.`;
    }
  }

  if (key.split(".").length !== 3) {
    return "VITE_SUPABASE_ANON_KEY não parece uma chave válida (esperado 3 partes separadas por ponto). Recopie do painel do Supabase.";
  }
  return null;
}

/** Referência do projeto (subdomínio da URL) — só para exibir no rodapé/cabeçalho. */
export function getSupabaseProjectRef(): string | null {
  const url = import.meta.env.VITE_SUPABASE_URL;
  if (!url) return null;
  try {
    return new URL(url).hostname.split(".")[0] ?? null;
  } catch {
    return null;
  }
}

/** Cliente único (memoizado). null se as variáveis não estiverem configuradas. */
export function getSupabase(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  cached =
    url && key
      ? createClient(url, key, {
          auth: { persistSession: true, autoRefreshToken: true },
        })
      : null;
  return cached;
}
