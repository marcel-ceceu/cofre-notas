/**
 * Conversas pequenas usadas pelos specs, com o nome de nota esperado
 * (`{yyyy-MM-dd do created_at}-{slug do título}`) e os marcadores visíveis.
 * Títulos acentuados (no zip viram \uXXXX, como no export real).
 */
import {
  MEMORY_MARKER,
  THINKING_MARKER,
  TOOL_MARKER,
  type ConversationSpec,
} from "./claudeExport";

export interface Sample {
  readonly conv: ConversationSpec;
  /** Nome da nota na lista/viewer (arquivo sem .md). */
  readonly noteName: string;
  /** Textos que DEVEM aparecer na nota. */
  readonly visible: readonly string[];
}

/** Texto com chaves, aspas e barras invertidas — confere o unescape do JSON. */
export const TRICKY_TEXT =
  'Analisei o orçamento: corte de 12% em insumos, objeto {"chave": "valor [x]"} e caminho C:\\dados\\ revisados. MARCADOR-CLAUDE-A';

/** Conversa completa: memória injetada, thinking, tool_use/tool_result e 4 turnos. */
export const ORCAMENTO: Sample = {
  noteName: "2026-08-10-Revisão-do-orçamento-de-produção",
  visible: ["MARCADOR-HUMANO-A", "MARCADOR-CLAUDE-A", "MARCADOR-HUMANO-A2", "MARCADOR-CLAUDE-A2"],
  conv: {
    uuid: "a1b2c3d4-0001-4000-8000-000000000001",
    name: "Revisão do orçamento de produção",
    createdAt: "2026-08-10T14:03:22.418977Z",
    updatedAt: "2026-08-10T14:20:05.112233Z",
    turns: [
      {
        sender: "human",
        at: "2026-08-10T14:03:22.418977Z",
        memory: `${MEMORY_MARKER}: o usuário trabalha com "orçamentos" {industriais} e prefere tabelas.`,
        text: "Preciso revisar o orçamento de produção de 2026. MARCADOR-HUMANO-A",
      },
      {
        sender: "assistant",
        at: "2026-08-10T14:04:10.000001Z",
        thinking: `${THINKING_MARKER}: calcular {"insumos": [1, 2]} e "margens" com C:\\planilhas\\`,
        toolResult: `${TOOL_MARKER}: preços médios de insumos 2026 → {"aço": 7.5}`,
        text: TRICKY_TEXT,
      },
      {
        sender: "human",
        at: "2026-08-10T14:15:00.000000Z",
        text: "E quanto à manutenção preventiva? MARCADOR-HUMANO-A2",
      },
      {
        sender: "assistant",
        at: "2026-08-10T14:20:05.112233Z",
        text: "A manutenção preventiva fica em 40 mil reais por trimestre. MARCADOR-CLAUDE-A2",
      },
    ],
  },
};

/** Título com emoji (some do slug) e resposta só no campo `text` (content vazio). */
export const MIGRACAO: Sample = {
  noteName: "2026-08-12-Plano-de-migração",
  visible: ["MARCADOR-HUMANO-B", "MARCADOR-CLAUDE-B"],
  conv: {
    uuid: "a1b2c3d4-0002-4000-8000-000000000002",
    name: "Plano de migração 🚀",
    createdAt: "2026-08-12T09:00:00.000001Z",
    updatedAt: "2026-08-12T09:05:00.000001Z",
    turns: [
      {
        sender: "human",
        at: "2026-08-12T09:00:00.000001Z",
        memory: `${MEMORY_MARKER}: servidor atual roda PostgreSQL 15.`,
        text: "Como migrar o banco para o novo servidor? MARCADOR-HUMANO-B",
      },
      {
        sender: "assistant",
        at: "2026-08-12T09:05:00.000001Z",
        textOnlyField: true,
        text: "Use replicação lógica e uma janela de corte curta. MARCADOR-CLAUDE-B",
      },
    ],
  },
};

const VENDAS_UUID = "b2c3d4e5-0101-4000-8000-000000000101";
const VENDAS_NAME = "Planejamento trimestral de vendas";
const VENDAS_CREATED = "2026-07-30T08:00:00.000000Z";
const VENDAS_QUESTION = {
  sender: "human",
  at: "2026-07-30T08:00:00.000000Z",
  text: "Qual a meta de vendas do trimestre? MARCADOR-PERGUNTA-P",
} as const;

/** Versão ANTIGA (part 000) da conversa que se repete entre as partes. */
export const VENDAS_ANTIGA: Sample = {
  noteName: "2026-07-30-Planejamento-trimestral-de-vendas",
  visible: ["MARCADOR-PERGUNTA-P", "MARCADOR-VERSAO-ANTIGA"],
  conv: {
    uuid: VENDAS_UUID,
    name: VENDAS_NAME,
    createdAt: VENDAS_CREATED,
    updatedAt: "2026-08-01T10:00:00.000000Z",
    turns: [
      VENDAS_QUESTION,
      {
        sender: "assistant",
        at: "2026-07-30T08:01:00.000000Z",
        text: "Meta antiga de vendas: 100 unidades. MARCADOR-VERSAO-ANTIGA",
      },
    ],
  },
};

/** Versão NOVA (part 001): mesmo uuid, updated_at maior, texto alterado. */
export const VENDAS_NOVA: Sample = {
  noteName: "2026-07-30-Planejamento-trimestral-de-vendas",
  visible: ["MARCADOR-PERGUNTA-P", "MARCADOR-VERSAO-NOVA", "MARCADOR-VERSAO-NOVA-2"],
  conv: {
    uuid: VENDAS_UUID,
    name: VENDAS_NAME,
    createdAt: VENDAS_CREATED,
    updatedAt: "2026-08-20T10:00:00.000000Z",
    turns: [
      VENDAS_QUESTION,
      {
        sender: "assistant",
        at: "2026-07-30T08:01:00.000000Z",
        text: "Meta revisada de vendas: 150 unidades. MARCADOR-VERSAO-NOVA",
      },
      {
        sender: "human",
        at: "2026-08-20T09:59:00.000000Z",
        text: "E para o próximo trimestre?",
      },
      {
        sender: "assistant",
        at: "2026-08-20T10:00:00.000000Z",
        text: "Manter as 150 unidades. MARCADOR-VERSAO-NOVA-2",
      },
    ],
  },
};

export const INADIMPLENCIA: Sample = {
  noteName: "2026-08-05-Análise-de-inadimplência",
  visible: ["MARCADOR-INADIMPLENCIA"],
  conv: {
    uuid: "b2c3d4e5-0102-4000-8000-000000000102",
    name: "Análise de inadimplência",
    createdAt: "2026-08-05T11:00:00.000000Z",
    updatedAt: "2026-08-05T11:10:00.000000Z",
    turns: [
      {
        sender: "human",
        at: "2026-08-05T11:00:00.000000Z",
        memory: `${MEMORY_MARKER}: carteira com 3 mil clientes.`,
        text: "Quais clientes estão inadimplentes há mais de 90 dias?",
      },
      {
        sender: "assistant",
        at: "2026-08-05T11:10:00.000000Z",
        thinking: `${THINKING_MARKER}: filtrar por vencimento`,
        text: "São 42 clientes acima de 90 dias. MARCADOR-INADIMPLENCIA",
      },
    ],
  },
};

export const FRETES: Sample = {
  noteName: "2026-08-18-Cotação-de-fretes-rodoviários",
  visible: ["MARCADOR-FRETES"],
  conv: {
    uuid: "b2c3d4e5-0103-4000-8000-000000000103",
    name: "Cotação de fretes rodoviários",
    createdAt: "2026-08-18T15:00:00.000000Z",
    updatedAt: "2026-08-18T15:30:00.000000Z",
    turns: [
      {
        sender: "human",
        at: "2026-08-18T15:00:00.000000Z",
        text: "Preciso cotar fretes rodoviários para o Nordeste.",
      },
      {
        sender: "assistant",
        at: "2026-08-18T15:30:00.000000Z",
        toolResult: `${TOOL_MARKER}: tabela de fretes ANTT`,
        text: "A melhor cotação ficou em 3,20 por km. MARCADOR-FRETES",
      },
    ],
  },
};

/** Conversas do export ANTIGO (sem bloco de memória injetada). */
export const LEGADO_REUNIAO: Sample = {
  noteName: "2026-03-15-Reunião-de-alinhamento-técnico",
  visible: ["MARCADOR-LEGADO-H", "MARCADOR-LEGADO-A"],
  conv: {
    uuid: "c3d4e5f6-0201-4000-8000-000000000201",
    name: "Reunião de alinhamento técnico",
    createdAt: "2026-03-15T13:30:00.000000Z",
    updatedAt: "2026-03-15T14:00:00.000000Z",
    turns: [
      {
        sender: "human",
        at: "2026-03-15T13:30:00.000000Z",
        text: "Pauta da reunião de alinhamento técnico. MARCADOR-LEGADO-H",
      },
      {
        sender: "assistant",
        at: "2026-03-15T14:00:00.000000Z",
        thinking: `${THINKING_MARKER}: organizar itens`,
        text: "Pauta registrada com três itens. MARCADOR-LEGADO-A",
      },
    ],
  },
};

export const LEGADO_ELETRICA: Sample = {
  noteName: "2026-04-02-Orçamento-de-manutenção-elétrica",
  visible: ["MARCADOR-LEGADO-ELETRICA"],
  conv: {
    uuid: "c3d4e5f6-0202-4000-8000-000000000202",
    name: "Orçamento de manutenção elétrica",
    createdAt: "2026-04-02T10:00:00.000000Z",
    updatedAt: "2026-04-02T10:20:00.000000Z",
    turns: [
      {
        sender: "human",
        at: "2026-04-02T10:00:00.000000Z",
        text: "Quanto custa a manutenção elétrica anual?",
      },
      {
        sender: "assistant",
        at: "2026-04-02T10:20:00.000000Z",
        text: "Cerca de 18 mil reais por ano. MARCADOR-LEGADO-ELETRICA",
      },
    ],
  },
};

/** Textos que NUNCA podem chegar numa nota. */
export const FORBIDDEN_IN_NOTES: readonly string[] = [
  "user_memory_snapshot",
  "system-reminder",
  MEMORY_MARKER,
  THINKING_MARKER,
  TOOL_MARKER,
];
