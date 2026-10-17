/** Fluxo Claude Web (manifest + zip + conversão). */
export const CLAUDE_WEB_PIPELINE_STEPS = [
  {
    title: "Pedir exportação",
    body: "Claude.ai → Configurações → Privacidade → Exportar dados. Aguarde o e-mail da Anthropic.",
  },
  {
    title: "Inserir o JSON e baixar",
    body: "Escolha o manifest-….json do e-mail; o app abre os links do conversations-*.zip (logado no claude.ai).",
  },
  {
    title: "Rodar a conversão",
    body: "Selecione o(s) .zip baixado(s) e converta em notas .md, com limpeza e sem duplicatas por uuid.",
  },
  {
    title: "Recarregar",
    body: "Ao concluir, recarregue o cofre — as conversas novas entram na lista e na busca.",
  },
] as const;

export const CLAUDE_WEB_IMPORT_START =
  "Iniciar processo de importação Claude Web";

export const CLAUDE_WEB_TOOLBAR_TITLE =
  "Claude Web — importação de conversas do Claude.ai";
