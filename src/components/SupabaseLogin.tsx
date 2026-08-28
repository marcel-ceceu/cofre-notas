import { useState } from "react";
import { unlock } from "../lib/supabase/cofreAuth";

/**
 * Desbloqueio do cofre por senha única (valida no banco via cofre_check).
 * Ao acertar, avisa o pai (onUnlocked) — a senha fica guardada em cofreAuth.
 */
export function SupabaseLogin({ onUnlocked }: { onUnlocked: () => void }) {
  const [senha, setSenha] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !senha) return;
    setBusy(true);
    setError(null);
    const r = await unlock(senha);
    setBusy(false);
    if (r.ok) {
      setSenha("");
      onUnlocked();
    } else {
      setError(r.error);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2 text-left">
      <p className="text-[12px] leading-snug text-[var(--ink-muted)]">
        Digite a senha do cofre para liberar o envio.
      </p>
      <input
        type="password"
        required
        autoComplete="current-password"
        value={senha}
        onChange={(e) => setSenha(e.target.value)}
        placeholder="senha"
        className="field px-2.5"
      />
      {error && (
        <p className="text-[11.5px] leading-snug break-words text-red-600">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="tb-btn tb-btn--primary w-full justify-center"
      >
        {busy ? "Verificando…" : "Desbloquear"}
      </button>
    </form>
  );
}
