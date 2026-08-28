import { useCallback, useEffect, useMemo, useState } from "react";
import { useVaultStore } from "../store/vaultStore";
import { planHeaderStamp } from "../lib/import/frontmatter";
import {
  runStampHeaders,
  type StampProgress,
  type StampResult,
} from "../lib/import/runStampHeaders";
import {
  configProblem,
  getSupabaseProjectRef,
  isSupabaseConfigured,
} from "../lib/supabase/client";
import { isUnlocked, lock } from "../lib/supabase/cofreAuth";
import {
  planUpload,
  runUpload,
  type UploadPlan,
  type UploadProgress,
  type UploadReport,
} from "../lib/supabase/runUpload";
import { SupabaseLogin } from "./SupabaseLogin";

type Props = {
  onClose: () => void;
  /** Após carimbar cabeçalhos, o pai recarrega o cofre para refletir no disco. */
  onStamped?: () => void | Promise<void>;
};

/** Fases do fluxo. Cada uma anima a entrada do próprio conteúdo. */
type Phase = "overview" | "preview" | "syncing" | "done" | "stamping";

/** Números da reconciliação, derivados do plano real vindo do banco. */
type Recon = {
  /** notas mapeáveis (cabeçalho completo) no escopo atual */
  localTotal: number;
  /** dessas, quantas já estão no Supabase */
  existing: number;
  toInsert: number;
  toUpdate: number;
  identical: number;
  /** sem cabeçalho completo → ficam de fora do envio */
  invalid: number;
  pending: number;
};

function reconOf(plan: UploadPlan): Recon {
  const toInsert = plan.toInsert.length;
  const toUpdate = plan.toUpdate.length;
  return {
    localTotal: toInsert + toUpdate + plan.skipped,
    existing: toUpdate + plan.skipped,
    toInsert,
    toUpdate,
    identical: plan.skipped,
    invalid: plan.invalid.length,
    pending: toInsert + toUpdate,
  };
}

export function SyncSupabaseModal({ onClose, onStamped }: Props) {
  const notes = useVaultStore((s) => s.notes);
  const dirHandle = useVaultStore((s) => s.dirHandle);
  const syncScope = useVaultStore((s) => s.syncScope);
  const scoped = !!(syncScope && syncScope.length > 0);
  const scopeCount = syncScope?.length ?? 0;

  const [phase, setPhase] = useState<Phase>("overview");
  const [explain, setExplain] = useState(false);
  const [stampProgress, setStampProgress] = useState<StampProgress | null>(null);
  const [stampResult, setStampResult] = useState<StampResult | null>(null);

  // Métrica A: quais notas precisam do cabeçalho padrão (só CLAUDEWEB por ora).
  const plan = useMemo(() => planHeaderStamp(notes), [notes]);

  // Acesso ao Supabase por senha única (cofreAuth): sincronizar exige desbloquear.
  const supaConfigured = isSupabaseConfigured();
  const configErr = supaConfigured ? configProblem() : null;
  const projectRef = getSupabaseProjectRef();
  const [unlocked, setUnlocked] = useState(isUnlocked());
  const syncEnabled = supaConfigured && !configErr && unlocked;

  // Notas do escopo: seleção (botão direito) ou o cofre inteiro.
  const targetNotes = useMemo(() => {
    if (!scoped) return notes;
    const wanted = new Set(syncScope);
    return notes.filter((n) => wanted.has(n.path));
  }, [notes, scoped, syncScope]);

  // ---- Reconciliação real (dry-run contra o banco) --------------------
  const [recon, setRecon] = useState<Recon | null>(null);
  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  /** Muda para forçar um novo dry-run (após enviar ou carimbar cabeçalho). */
  const [reconNonce, setReconNonce] = useState(0);

  useEffect(() => {
    if (!syncEnabled) {
      setRecon(null);
      return;
    }
    let cancelled = false;
    setPlanning(true);
    setPlanError(null);
    planUpload(targetNotes)
      .then((p) => {
        if (!cancelled) setRecon(reconOf(p));
      })
      .catch((e: unknown) => {
        if (!cancelled) setPlanError((e as Error).message ?? String(e));
      })
      .finally(() => {
        if (!cancelled) setPlanning(false);
      });
    return () => {
      cancelled = true;
    };
  }, [syncEnabled, targetNotes, reconNonce]);

  // ---- Envio real ------------------------------------------------------
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [report, setReport] = useState<UploadReport | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const startUpload = useCallback(async () => {
    setReport(null);
    setSendError(null);
    setProgress({ phase: "Preparando…", done: 0, total: recon?.pending ?? 0 });
    setPhase("syncing");
    try {
      const r = await runUpload(targetNotes, setProgress);
      setReport(r);
      setPhase("done");
      setReconNonce((n) => n + 1); // números da visão geral voltam atualizados
    } catch (e) {
      setSendError((e as Error).message ?? String(e));
      setPhase("done");
    }
  }, [targetNotes, recon?.pending]);

  /**
   * Enquanto uma operação longa roda, fechar o modal não a cancela — só faz o
   * resultado (inclusive um erro) se perder no vazio. Vale para o envio e
   * também para o carimbo, que reescreve os .md em disco.
   */
  const sending = phase === "syncing";
  const stamping = phase === "stamping" && !stampResult;
  const busy = sending || stamping;

  // Esc fecha, menos no meio de uma operação (para não abortar sem querer).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  async function runStamp() {
    if (!dirHandle || plan.toStamp.length === 0) return;
    setStampResult(null);
    setStampProgress(null);
    setPhase("stamping");
    try {
      const r = await runStampHeaders(dirHandle, plan.toStamp, setStampProgress);
      setStampResult(r);
      // Recarregar o cofre troca a identidade de `notes`, o que por si só já
      // dispara um novo dry-run. Só forçamos pelo nonce quando não há recarga.
      if (onStamped) await onStamped();
      else setReconNonce((n) => n + 1);
    } catch (e) {
      setStampResult({
        total: plan.toStamp.length,
        stamped: 0,
        skipped: 0,
        failed: plan.toStamp.length,
        errors: [{ path: "", message: (e as Error).message ?? String(e) }],
      });
    }
  }

  const canSend = !!recon && recon.pending > 0 && syncEnabled && !planning;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-6"
      onClick={() => !busy && onClose()}
    >
      <div
        className="flex h-[70vh] w-[70vw] min-w-[520px] flex-col overflow-hidden rounded-lg border border-[var(--rule)] bg-[var(--paper-raised)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sync-title"
      >
        {/* ---------- cabeçalho ---------- */}
        <header className="flex shrink-0 items-center gap-2.5 border-b border-[var(--rule)] bg-[var(--chrome)] px-4 py-3">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-[var(--accent-soft)] text-[var(--accent)]">
            <SyncIcon className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <h2
              id="sync-title"
              className="text-[13px] font-semibold text-[var(--ink)]"
            >
              Sincronizar com o Supabase
            </h2>
            <p className="flex items-center gap-1.5 truncate text-[11.5px] text-[var(--ink-muted)]">
              {scoped ? (
                <span className="rounded-full border border-[var(--accent-ring)] bg-[var(--accent-soft)] px-1.5 py-px font-mono-ui text-[10px] text-[var(--accent-strong)]">
                  seleção · {scopeCount}
                </span>
              ) : (
                <span className="rounded-full border border-[var(--border)] bg-[var(--surface-secondary)] px-1.5 py-px font-mono-ui text-[10px] text-[var(--ink-muted)]">
                  cofre inteiro
                </span>
              )}
              <span className="truncate">
                {projectRef ?? "sem projeto"} ·{" "}
                <code className="font-mono-ui">vault_cofrenotas</code>
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => setExplain((v) => !v)}
            aria-pressed={explain}
            title="Modo explicação — entenda cada etapa"
            aria-label="Modo explicação"
            className={`tb-btn tb-btn--icon shrink-0 ${
              explain
                ? "border-[var(--accent-ring)] bg-[var(--accent-soft)] text-[var(--accent)]"
                : ""
            }`}
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4" aria-hidden>
              <path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16M5.496 6.033h.825c.138 0 .248-.113.266-.25.09-.656.54-1.134 1.342-1.134.686 0 1.314.343 1.314 1.168 0 .635-.374.927-.965 1.371-.673.489-1.206 1.06-1.168 1.987l.003.217a.25.25 0 0 0 .25.246h.811a.25.25 0 0 0 .25-.25v-.105c0-.718.273-.927 1.01-1.486.609-.463 1.244-.977 1.244-2.056 0-1.511-1.276-2.241-2.673-2.241-1.267 0-2.655.59-2.75 2.286a.237.237 0 0 0 .241.247zm2.325 6.443c.61 0 1.029-.394 1.029-.927 0-.552-.42-.94-1.029-.94-.584 0-1.009.388-1.009.94 0 .533.425.927 1.01.927z" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="tb-btn tb-btn--icon shrink-0"
            aria-label="Fechar"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4" aria-hidden>
              <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z" />
            </svg>
          </button>
        </header>

        {/* ---------- corpo (troca por fase) ---------- */}
        <div key={phase} className="phase-in min-h-0 flex-1 overflow-y-auto">
          {phase === "overview" && (
            <Overview
              recon={recon}
              planning={planning}
              planError={planError}
              onRetryPlan={() => setReconNonce((n) => n + 1)}
              explain={explain}
              scoped={scoped}
              toStampCount={plan.toStamp.length}
              pendingRuleCount={plan.unknown.length + plan.noFrontmatter.length}
              onStamp={runStamp}
              syncConfigured={supaConfigured}
              configErr={configErr}
              unlocked={unlocked}
              onUnlocked={() => setUnlocked(true)}
              onLock={() => {
                lock();
                setUnlocked(false);
              }}
            />
          )}
          {phase === "preview" && recon && (
            <Preview recon={recon} explain={explain} />
          )}
          {phase === "syncing" && (
            <Syncing progress={progress} explain={explain} />
          )}
          {phase === "done" && (
            <Done report={report} error={sendError} explain={explain} />
          )}
          {phase === "stamping" && (
            <Stamping progress={stampProgress} result={stampResult} />
          )}
        </div>

        {/* ---------- rodapé (ações por fase) ---------- */}
        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--rule)] bg-[var(--chrome)] px-4 py-2.5">
          <span className="meta-label truncate">
            {sending
              ? "não feche a janela durante o envio"
              : stamping
                ? "não feche a janela enquanto os arquivos são gravados"
                : recon
                  ? `${recon.localTotal} nota(s) com cabeçalho completo no escopo`
                  : "o envio nunca apaga — só insere e atualiza"}
          </span>

          <div className="flex items-center gap-2">
            {phase === "overview" && (
              <>
                <button type="button" onClick={onClose} className="tb-btn">
                  Fechar
                </button>
                <button
                  type="button"
                  disabled={!canSend}
                  onClick={() => setPhase("preview")}
                  className="tb-btn tb-btn--primary"
                  title={
                    syncEnabled
                      ? undefined
                      : "Configure o Supabase e desbloqueie o cofre para sincronizar"
                  }
                >
                  Sincronizar
                </button>
              </>
            )}

            {phase === "preview" && (
              <>
                <button
                  type="button"
                  onClick={() => setPhase("overview")}
                  className="tb-btn"
                >
                  Voltar
                </button>
                <button
                  type="button"
                  disabled={!recon}
                  onClick={startUpload}
                  className="tb-btn tb-btn--primary"
                >
                  Confirmar e enviar
                </button>
              </>
            )}

            {phase === "done" && (
              <button
                type="button"
                onClick={onClose}
                className="tb-btn tb-btn--primary"
              >
                Concluir
              </button>
            )}

            {phase === "stamping" && (
              <button
                type="button"
                disabled={!stampResult}
                onClick={() => setPhase("overview")}
                className="tb-btn tb-btn--primary"
              >
                {stampResult ? "Voltar" : "Padronizando…"}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

/** Bloco do modo explicação: título + parágrafos didáticos. */
function ExplainNote({
  show,
  title,
  children,
}: {
  show: boolean;
  title: string;
  children: React.ReactNode;
}) {
  if (!show) return null;
  return (
    <div className="phase-in mb-5 rounded-md border border-[var(--accent-ring)] bg-[var(--accent-soft)] px-3.5 py-3 text-left">
      <p className="flex items-center gap-1.5 font-mono-ui text-[10px] font-semibold tracking-wide text-[var(--accent-strong)] uppercase">
        <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5" aria-hidden>
          <path d="M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16M5.496 6.033h.825c.138 0 .248-.113.266-.25.09-.656.54-1.134 1.342-1.134.686 0 1.314.343 1.314 1.168 0 .635-.374.927-.965 1.371-.673.489-1.206 1.06-1.168 1.987l.003.217a.25.25 0 0 0 .25.246h.811a.25.25 0 0 0 .25-.25v-.105c0-.718.273-.927 1.01-1.486.609-.463 1.244-.977 1.244-2.056 0-1.511-1.276-2.241-2.673-2.241-1.267 0-2.655.59-2.75 2.286a.237.237 0 0 0 .241.247zm2.325 6.443c.61 0 1.029-.394 1.029-.927 0-.552-.42-.94-1.029-.94-.584 0-1.009.388-1.009.94 0 .533.425.927 1.01.927z" />
        </svg>
        {title}
      </p>
      <div className="mt-2 space-y-2 text-[12px] leading-relaxed text-[var(--ink-muted)]">
        {children}
      </div>
    </div>
  );
}

/** Destaca o rótulo (O quê / Por quê / Como) no início do parágrafo. */
function Lead({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <p>
      <span className="font-semibold text-[var(--ink)]">{k} </span>
      {children}
    </p>
  );
}

/** Linha simples: rótulo à esquerda, número à direita. */
function Line({
  label,
  value,
  strong,
  muted,
}: {
  label: string;
  value: number;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between py-2">
      <span
        className={`text-[13px] ${
          muted ? "text-[var(--ink-faint)]" : "text-[var(--ink)]"
        }`}
      >
        {label}
      </span>
      <span
        className={`font-mono-ui tabular-nums ${
          strong
            ? "text-[15px] font-medium text-[var(--ink)]"
            : muted
              ? "text-[13px] text-[var(--ink-faint)]"
              : "text-[13px] text-[var(--ink-muted)]"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

/** Mensagem de erro com opção de tentar de novo. */
function ErrorBox({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-md border border-red-200 bg-red-50 px-3.5 py-3 text-left">
      <p className="font-mono-ui text-[10px] font-semibold tracking-wide text-red-700 uppercase">
        Falha
      </p>
      <p className="mt-1 text-[12px] leading-snug break-words text-red-700">
        {message}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 text-[12px] text-red-700 underline hover:no-underline"
        >
          Tentar de novo
        </button>
      )}
    </div>
  );
}

// ---------- Fase 1: visão geral ----------
function Overview({
  recon,
  planning,
  planError,
  onRetryPlan,
  explain,
  scoped,
  toStampCount,
  pendingRuleCount,
  onStamp,
  syncConfigured,
  configErr,
  unlocked,
  onUnlocked,
  onLock,
}: {
  recon: Recon | null;
  planning: boolean;
  planError: string | null;
  onRetryPlan: () => void;
  explain: boolean;
  scoped: boolean;
  toStampCount: number;
  pendingRuleCount: number;
  onStamp: () => void;
  syncConfigured: boolean;
  configErr: string | null;
  unlocked: boolean;
  onUnlocked: () => void;
  onLock: () => void;
}) {
  return (
    <div className="mx-auto max-w-[420px] px-6 py-8">
      <ExplainNote show={explain} title="O que é esta tela">
        <Lead k="O quê:">
          compara o que está no seu PC com o que já foi guardado no banco na
          nuvem (Supabase), antes de mudar qualquer coisa.
        </Lead>
        <Lead k="Por quê:">
          dois totais iguais não provam nada — poderiam ser conversas diferentes
          dos dois lados e o número bater por acaso. Por isso o app confere
          conversa por conversa, por um identificador único (a origem + o id da
          conversa).
        </Lead>
        <Lead k="Como ler:">
          “Para sincronizar” é quantas conversas do PC ainda não estão iguais no
          banco — novas ou que você continuou depois da última carga.
        </Lead>
      </ExplainNote>

      {/* Métrica A — cabeçalho padrão (não aparece no envio pontual) */}
      {!scoped && (
        <section className="rounded-md border border-[var(--rule)] bg-[var(--chrome)] px-3.5 py-3 text-left">
          <p className="meta-label">Cabeçalho padrão</p>
          <div className="mt-1 flex items-end justify-between gap-3">
            <p className="leading-none">
              <span className="font-mono-ui text-[26px] font-medium text-[var(--ink)]">
                {toStampCount}
              </span>
              <span className="ml-2 text-[12px] text-[var(--ink-muted)]">
                documento(s) a padronizar
              </span>
            </p>
            <button
              type="button"
              disabled={toStampCount === 0}
              onClick={onStamp}
              className="tb-btn tb-btn--primary shrink-0"
            >
              Padronizar cabeçalho
            </button>
          </div>
          {pendingRuleCount > 0 && (
            <p className="mt-1.5 text-[11px] text-[var(--ink-faint)]">
              {pendingRuleCount} pendente(s) de regra por origem (outra fase)
            </p>
          )}
        </section>
      )}

      {/* Métrica B — sincronização (exige Supabase configurado + senha) */}
      <p className="meta-label mt-6 mb-2 text-center">
        {scoped ? "Envio pontual" : "Sincronização"}
      </p>

      {!syncConfigured ? (
        <div className="rounded-md border border-[var(--rule)] bg-[var(--chrome)] px-3.5 py-3 text-center text-[12px] leading-relaxed text-[var(--ink-muted)]">
          Sincronização desativada — defina{" "}
          <code className="font-mono-ui text-[11px]">VITE_SUPABASE_URL</code> e{" "}
          <code className="font-mono-ui text-[11px]">VITE_SUPABASE_ANON_KEY</code>{" "}
          no arquivo <code className="font-mono-ui text-[11px]">.env</code>.
        </div>
      ) : configErr ? (
        <ErrorBox message={configErr} />
      ) : !unlocked ? (
        <SupabaseLogin onUnlocked={onUnlocked} />
      ) : planError ? (
        <>
          <ErrorBox message={planError} onRetry={onRetryPlan} />
          {/* A senha fica guardada; se ela deixou de valer, o erro se repetiria
              para sempre sem uma saída para redigitar. */}
          <p className="mt-2 text-center text-[11.5px] text-[var(--ink-faint)]">
            Se a senha mudou,{" "}
            <button
              type="button"
              onClick={onLock}
              className="text-[var(--ink-muted)] underline hover:text-[var(--accent)]"
            >
              digite a senha de novo
            </button>
            .
          </p>
        </>
      ) : planning || !recon ? (
        <p className="py-6 text-center text-[13px] text-[var(--ink-muted)]">
          Conferindo com o banco…
        </p>
      ) : (
        <>
          <div className="text-center">
            <p
              className={`font-mono-ui text-[52px] leading-none font-medium ${
                recon.pending === 0
                  ? "text-emerald-600"
                  : "text-[var(--accent-strong)]"
              }`}
            >
              {recon.pending}
            </p>
            <p className="mt-2 text-[13px] text-[var(--ink-muted)]">
              {recon.pending === 0
                ? "tudo em dia — nada para enviar"
                : "conversa(s) para sincronizar"}
            </p>
          </div>

          <div className="mt-6 divide-y divide-[var(--rule-soft)] border-y border-[var(--rule-soft)]">
            <Line label="No cofre (prontas)" value={recon.localTotal} />
            <Line label="Já no Supabase" value={recon.existing} />
            <Line label="Novas (inserir)" value={recon.toInsert} strong />
            <Line label="Alteradas (atualizar)" value={recon.toUpdate} strong />
            {recon.invalid > 0 && (
              <Line
                label="Sem cabeçalho completo (fora)"
                value={recon.invalid}
                muted
              />
            )}
          </div>

          <p className="mt-2 flex items-center justify-center gap-2 text-[11px] text-[var(--ink-faint)]">
            <span>cofre desbloqueado</span>
            <button
              type="button"
              onClick={onLock}
              className="text-[var(--ink-muted)] hover:text-[var(--accent)] hover:underline"
            >
              trancar
            </button>
          </p>
        </>
      )}
    </div>
  );
}

// ---------- Fase 2: prévia ----------
function Preview({ recon, explain }: { recon: Recon; explain: boolean }) {
  return (
    <div className="mx-auto max-w-[420px] px-6 py-8">
      <ExplainNote show={explain} title="O que a prévia faz">
        <Lead k="O quê:">
          é um ensaio. O app mostra exatamente o que vai fazer, mas ainda não
          gravou nada — é a sua chance de conferir antes.
        </Lead>
        <Lead k="Como decide:">
          cada conversa tem uma chave (origem + id). Se a chave não existe no
          banco, ele <strong>insere</strong>. Se existe mas o texto mudou (ele
          compara um “resumo digital”, o hash), <strong>atualiza</strong>. Se
          está idêntica, <strong>pula</strong>, para não reescrever à toa.
        </Lead>
        <Lead k="Nunca apaga:">
          o envio só insere e atualiza. Se você apagou uma conversa no PC, ela
          continua guardada no banco.
        </Lead>
      </ExplainNote>
      <p className="text-center text-[13px] text-[var(--ink-muted)]">
        Isto vai gravar no Supabase. Nada muda até confirmar.
      </p>

      <div className="mt-5 divide-y divide-[var(--rule-soft)] border-y border-[var(--rule-soft)]">
        <Line label="Inserir novas" value={recon.toInsert} strong />
        <Line label="Atualizar existentes" value={recon.toUpdate} strong />
        {recon.identical > 0 && (
          <Line label="Pular idênticas" value={recon.identical} muted />
        )}
      </div>

      <p className="mt-4 text-center text-[11.5px] leading-snug text-[var(--ink-faint)]">
        O envio confere de novo com o banco antes de gravar, então repetir é
        seguro.
      </p>
    </div>
  );
}

// ---------- Fase 3: enviando ----------
function Syncing({
  progress,
  explain,
}: {
  progress: UploadProgress | null;
  explain: boolean;
}) {
  const done = progress?.done ?? 0;
  const total = progress?.total ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="grid h-full place-items-center px-6">
      <div className="w-full max-w-[380px] text-center">
        <ExplainNote show={explain} title="Por que em lotes">
          <Lead k="Como:">
            em vez de mandar uma conversa por vez (lento) ou todas de uma vez
            (estoura o limite da requisição), o app agrupa em blocos e envia bloco
            a bloco. A barra mostra esse avanço.
          </Lead>
          <Lead k="Seguro repetir:">
            se cair no meio, é só rodar de novo — o que já subiu está gravado e
            será pulado por estar idêntico.
          </Lead>
        </ExplainNote>
        <p className="text-[14px] font-medium text-[var(--ink)]">
          {progress?.phase ?? "Preparando…"}
        </p>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--paper-sunken)]">
          <div
            className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-150 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-1.5 font-mono-ui text-[11px] text-[var(--ink-faint)]">
          {done} de {total}
        </p>
      </div>
    </div>
  );
}

// ---------- Fase 4: concluído ----------
function Done({
  report,
  error,
  explain,
}: {
  report: UploadReport | null;
  error: string | null;
  explain: boolean;
}) {
  if (error || !report) {
    return (
      <div className="grid h-full place-items-center px-6">
        <div className="w-full max-w-[420px]">
          <ErrorBox message={error ?? "O envio não retornou um resultado."} />
        </div>
      </div>
    );
  }

  const ok = report.failed === 0;
  return (
    <div className="grid h-full place-items-center px-6">
      <div className="w-full max-w-[420px] text-center">
        <ExplainNote show={explain} title="O que significa este resultado">
          <Lead k="Enviadas / atualizadas:">
            conversas que entraram agora no banco ou tiveram o texto reescrito
            porque mudaram desde a última carga.
          </Lead>
          <Lead k="Mantidas:">
            estavam idênticas ao que já havia no banco, então foram puladas — é o
            comportamento esperado ao sincronizar duas vezes seguidas.
          </Lead>
        </ExplainNote>
        <span
          className={`mx-auto grid h-12 w-12 place-items-center rounded-full ${
            ok ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"
          }`}
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-7 w-7" aria-hidden>
            <path
              fillRule="evenodd"
              d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0l-3.5-3.5a1 1 0 1 1 1.4-1.4l2.8 2.8 6.8-6.8a1 1 0 0 1 1.4 0z"
              clipRule="evenodd"
            />
          </svg>
        </span>
        <p className="mt-4 text-[15px] font-semibold text-[var(--ink)]">
          {ok ? "Concluído" : "Concluído com falhas"}
        </p>
        <p className="mt-1 text-[13px] text-[var(--ink-muted)]">
          {report.inserted} enviada(s) · {report.updated} atualizada(s) ·{" "}
          {report.skipped} mantida(s)
        </p>

        {report.failed > 0 && (
          <div className="mt-4 text-left">
            <ErrorBox
              message={`${report.failed} conversa(s) falharam. ${
                report.errors[0]
                  ? `Primeira: ${report.errors[0].key} — ${report.errors[0].message}`
                  : ""
              }`}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Fase: carimbando cabeçalho ----------
function Stamping({
  progress,
  result,
}: {
  progress: StampProgress | null;
  result: StampResult | null;
}) {
  const pct = result
    ? 100
    : progress && progress.total
      ? Math.round((progress.done / progress.total) * 100)
      : 0;
  return (
    <div className="grid h-full place-items-center px-6">
      <div className="w-full max-w-[380px] text-center">
        {!result ? (
          <>
            <p className="text-[14px] font-medium text-[var(--ink)]">
              Padronizando cabeçalho… {progress?.done ?? 0}/{progress?.total ?? 0}
            </p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--paper-sunken)]">
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-150 ease-out"
                style={{ width: `${pct}%` }}
              />
            </div>
          </>
        ) : (
          <>
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-emerald-50 text-emerald-600">
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-7 w-7" aria-hidden>
                <path
                  fillRule="evenodd"
                  d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0l-3.5-3.5a1 1 0 1 1 1.4-1.4l2.8 2.8 6.8-6.8a1 1 0 0 1 1.4 0z"
                  clipRule="evenodd"
                />
              </svg>
            </span>
            <p className="mt-4 text-[15px] font-semibold text-[var(--ink)]">
              Cabeçalho padronizado
            </p>
            <p className="mt-1 text-[13px] text-[var(--ink-muted)]">
              {result.stamped} carimbada(s) · {result.skipped} já ok ·{" "}
              {result.failed} erro(s)
            </p>
            {result.failed > 0 && result.errors[0] && (
              <p className="mt-2 text-[11px] leading-snug break-words text-[var(--ink-faint)]">
                {result.errors[0].message}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Banco de dados com seta de envio — estilo Bootstrap Icons (16×16). */
export function SyncIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden>
      <path d="M12.5 0c-1.612 0-3.083.196-4.174.545-.545.174-1.017.4-1.366.678C6.612 1.5 6.3 1.897 6.3 2.4v3.2c0 .503.312.9.66 1.177.35.278.821.504 1.366.678C9.417 7.804 10.888 8 12.5 8s3.083-.196 4.174-.545c.545-.174 1.017-.4 1.366-.678.348-.277.66-.674.66-1.177V2.4c0-.503-.312-.9-.66-1.177-.35-.278-.821-.504-1.366-.678C15.583.196 14.112 0 12.5 0z" />
      <path d="M3.5 1C1.567 1 0 1.895 0 3v10c0 1.105 1.567 2 3.5 2 .786 0 1.512-.148 2.098-.398a4.4 4.4 0 0 1-.383-.94C4.79 13.876 4.18 14 3.5 14 2.02 14 1 13.36 1 13v-1.508c.616.362 1.485.59 2.5.59.322 0 .634-.023.932-.066a4.5 4.5 0 0 1 .118-1.011c-.325.056-.678.087-1.05.087C2.02 11.092 1 10.451 1 10.092V8.583c.616.363 1.485.59 2.5.59.567 0 1.1-.07 1.572-.195.2-.31.436-.594.703-.847A6.6 6.6 0 0 1 3.5 8.174C2.02 8.174 1 7.533 1 7.174V5.666c.616.362 1.485.59 2.5.59 1.015 0 1.884-.228 2.5-.59V5c0-.199.02-.393.058-.581C5.53 4.75 4.6 5 3.5 5 2.02 5 1 4.36 1 4s1.02-1 2.5-1c.53 0 1.017.082 1.42.22A2.6 2.6 0 0 1 5.5 2.4c0-.14.011-.276.032-.408A7.5 7.5 0 0 0 3.5 1z" />
      <path d="M11.5 16a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9m.354-6.854 1.5 1.5a.5.5 0 0 1-.708.708L12 10.707V13.5a.5.5 0 0 1-1 0v-2.793l-.646.647a.5.5 0 0 1-.708-.708l1.5-1.5a.5.5 0 0 1 .708 0" />
    </svg>
  );
}
