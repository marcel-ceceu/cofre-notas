import { lazy, Suspense, useState } from "react";
import { isDesktopShell, openChatGptTeste } from "../lib/runtime/shell";
import { conversasDir } from "../lib/import/dest";
import { copyToClipboard } from "../lib/copyResults";
import { carregarScriptExportador } from "../lib/import/scriptExportador";
import { VaultContextSummary } from "./VaultContextSummary";

/** Tempo que o botão mostra "Script copiado". */
const COPIADO_MS = 4000;

const ImportCursorModal = lazy(() =>
  import("./ImportCursorModal").then((m) => ({ default: m.ImportCursorModal }))
);
const ImportChatgptModal = lazy(() =>
  import("./ImportChatgptModal").then((m) => ({ default: m.ImportChatgptModal }))
);

type Props = {
  onImported: (dest: string) => void;
};

/** Painel Importar — conversas do ChatGPT (já baixadas) e do Cursor IDE. */
export function ImportPanel({ onImported }: Props) {
  const [openCursor, setOpenCursor] = useState(false);
  const [openChatgpt, setOpenChatgpt] = useState(false);
  const [erroChatgpt, setErroChatgpt] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const desktop = isDesktopShell();

  const copiarScript = async () => {
    setErroChatgpt(null);
    try {
      await copyToClipboard(await carregarScriptExportador());
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), COPIADO_MS);
    } catch (e) {
      setErroChatgpt(`Não deu para copiar o script: ${String(e)}`);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="pane-head">
        <span className="pane-title">Importar</span>
      </div>

      <div className="space-y-3 px-3 py-3">
        <p className="text-[12px] leading-relaxed text-[var(--ink-muted)]">
          Importação de conversas do ChatGPT e do Cursor IDE. Para o export
          oficial do Claude.ai (.zip), use a aba{" "}
          <strong className="font-medium text-[var(--ink)]">Claude Web</strong>.
        </p>

        <div className="space-y-2">
          <p className="text-[12px] font-medium text-[var(--ink)]">ChatGPT</p>
          <ol className="list-decimal space-y-1 pl-4 text-[11.5px] leading-snug text-[var(--ink-muted)]">
            <li>
              <strong className="font-medium text-[var(--ink)]">Baixar</strong> — copie o
              script abaixo, abra o chatgpt.com no Chrome, <strong>F12</strong> → aba{" "}
              <strong>Console</strong>, <strong>Ctrl+V</strong> e <strong>Enter</strong> (na 1ª
              vez o Chrome pede para digitar <code>allow pasting</code>). No popup, escolha a pasta{" "}
              <code className="break-all">{conversasDir("chatgpt")}</code>.
            </li>
            <li>
              <strong className="font-medium text-[var(--ink)]">Conferir</strong> — duplicatas
              (mesma conversa) e padrão do Cofre; o formato antigo é convertido.
            </li>
            <li>
              <strong className="font-medium text-[var(--ink)]">Limpar e gravar</strong> — tira
              as cortesias e grava em <code>ChatGPT\</code> dentro do cofre.
            </li>
          </ol>
          <button
            type="button"
            onClick={copiarScript}
            className="tb-btn tb-btn--primary w-full justify-center"
            title="Copia o exportador do ChatGPT para colar no Console do Chrome"
          >
            {copiado ? "Script copiado — cole no Console do chatgpt.com" : "Copiar script do exportador"}
          </button>
          <button
            type="button"
            onClick={() => setOpenChatgpt(true)}
            className="tb-btn tb-btn--primary w-full justify-center"
          >
            Levar conversas do ChatGPT para o cofre
          </button>
          <button
            type="button"
            onClick={() => {
              setErroChatgpt(null);
              openChatGptTeste().catch((e) => setErroChatgpt(String(e)));
            }}
            className="tb-btn w-full justify-center"
            title="Abre o chatgpt.com com o exportador (⬇ GPT) já carregado"
          >
            Baixar pela janela do app
          </button>
          {erroChatgpt && (
            <p className="text-[11px] text-red-700">{erroChatgpt}</p>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-[12px] font-medium text-[var(--ink)]">
            Cursor (local)
          </p>
          <p className="text-[11.5px] leading-snug text-[var(--ink-muted)]">
            Lê os transcripts em <code>~\.cursor\projects</code>, mostra quais
            conversas são novas ou mudaram, e grava só as que você marcar em{" "}
            <code>Cursor\</code> dentro do cofre.
          </p>
          <button
            type="button"
            onClick={() => setOpenCursor(true)}
            className="tb-btn tb-btn--primary w-full justify-center"
          >
            Importar do Cursor
          </button>
          {!desktop && (
            <p className="text-[11px] text-[var(--ink-faint)]">
              No PWA o inventário automático do Cursor exige o app instalado
              (Windows); o botão abre o mesmo assistente com orientação.
            </p>
          )}
        </div>

        <VaultContextSummary />
      </div>

      <Suspense fallback={null}>
        {openCursor && (
          <ImportCursorModal
            onClose={() => setOpenCursor(false)}
            onImported={(dest) => {
              setOpenCursor(false);
              onImported(dest);
            }}
          />
        )}
        {openChatgpt && (
          <ImportChatgptModal
            onClose={() => setOpenChatgpt(false)}
            onImported={(dest) => {
              setOpenChatgpt(false);
              onImported(dest);
            }}
          />
        )}
      </Suspense>
    </div>
  );
}

/** Título do botão da toolbar que abre o painel Importar. */
export const IMPORT_TOOLBAR_TITLE =
  "Importar — conversas do ChatGPT (baixadas) e do Cursor IDE (transcripts locais)";
