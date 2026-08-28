/**
 * Acesso ao cofre no Supabase por SENHA ÚNICA (sem Supabase Auth).
 *
 * A tabela vault_cofrenotas fica fechada na API; ler/gravar só pelas funções
 * cofre_check / cofre_hashes / cofre_upsert, que conferem a senha no banco
 * (hash bcrypt em public.cofre_config). Aqui guardamos a senha desbloqueada
 * em memória + localStorage (é o app desktop do próprio dono).
 */

import { getSupabase } from "./client";

const KEY = "cofre-notas:senha";

let senha: string | null = readStored();

function readStored(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function isUnlocked(): boolean {
  return senha !== null && senha.length > 0;
}

/** Senha atual — usada pelo runUpload nas chamadas RPC. */
export function getSenha(): string | null {
  return senha;
}

/** Valida a senha contra o banco (cofre_check) e, se ok, guarda. */
export async function unlock(
  input: string
): Promise<{ ok: boolean; error: string | null }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, error: "Supabase não configurado." };

  const { data, error } = await sb.rpc("cofre_check", { p_senha: input });
  if (error) return { ok: false, error: error.message };
  if (data !== true) return { ok: false, error: "Senha incorreta." };

  senha = input;
  try {
    localStorage.setItem(KEY, input);
  } catch {
    // sem persistência — vale só para esta sessão
  }
  return { ok: true, error: null };
}

export function lock(): void {
  senha = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignora
  }
}
