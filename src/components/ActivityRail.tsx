import type { ReactNode } from "react";
import { SyncIcon, PilotoIcon } from "./icons";

export type RailView = "notes" | "import" | "consolidate";

type Item = {
  view: RailView;
  label: string;
  hint: string;
  icon: ReactNode;
};

const ITEMS: Item[] = [
  {
    view: "notes",
    label: "Notas",
    hint: "Buscar e navegar pelas notas do cofre",
    icon: (
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-[18px] w-[18px]"
        aria-hidden
      >
        <path d="M5 2.75h6.5L15 6.25v11H5z" />
        <path d="M11.25 2.75v3.5H15" />
        <path d="M7.5 10h5M7.5 13h3.5" />
      </svg>
    ),
  },
  {
    view: "import",
    label: "Importar",
    hint: "Pipeline: exportação do Claude.ai / transcripts do Cursor → notas .md no cofre",
    icon: (
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-[18px] w-[18px]"
        aria-hidden
      >
        <path d="M10 2.75v9" />
        <path d="M6.75 8.5 10 11.75 13.25 8.5" />
        <path d="M3.5 13.25v2A1.75 1.75 0 0 0 5.25 17h9.5a1.75 1.75 0 0 0 1.75-1.75v-2" />
      </svg>
    ),
  },
  {
    view: "consolidate",
    label: "Consolidar",
    hint: "Agregar conversas selecionadas em um único documento para a IA",
    icon: (
      <svg
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-[18px] w-[18px]"
        aria-hidden
      >
        <path d="M3.25 5.25h5.5M3.25 8.25h5.5M3.25 11.25h3.5" />
        <path d="M11.5 8.25 14 10.75l-2.5 2.5" />
        <rect x="14.75" y="6.5" width="2.5" height="8.5" rx="0.6" />
      </svg>
    ),
  },
];

type Props = {
  active: RailView;
  onChange: (view: RailView) => void;
  onOpenSettings: () => void;
  onOpenSync: () => void;
  onOpenPiloto: () => void;
  /** Quantidade selecionada — badge no ícone de consolidação. */
  selectedCount: number;
};

/**
 * Rail de atividades à esquerda (padrão VS Code / Obsidian): troca o painel
 * da barra lateral em vez de abrir modais soltos.
 */
export function ActivityRail({
  active,
  onChange,
  onOpenSettings,
  onOpenSync,
  onOpenPiloto,
  selectedCount,
}: Props) {
  return (
    <nav
      className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-[var(--rule)] bg-[var(--chrome)] py-2"
      aria-label="Seções do aplicativo"
    >
      {ITEMS.map((item) => {
        const isActive = active === item.view;
        return (
          <button
            key={item.view}
            type="button"
            onClick={() => onChange(item.view)}
            title={`${item.label} — ${item.hint}`}
            aria-label={item.label}
            aria-current={isActive ? "page" : undefined}
            className={`rail-btn ${isActive ? "rail-btn--active" : ""}`}
          >
            {item.icon}
            {item.view === "consolidate" && selectedCount > 0 && (
              <span className="rail-badge">{selectedCount}</span>
            )}
          </button>
        );
      })}

      <span className="my-1 h-px w-6 bg-[var(--rule)]" />

      <button
        type="button"
        onClick={onOpenPiloto}
        title="Piloto de memória — destilar conversas escolhidas em memórias auditáveis"
        aria-label="Piloto de memória"
        className="rail-btn"
      >
        <PilotoIcon className="h-[19px] w-[19px]" />
      </button>

      <button
        type="button"
        onClick={onOpenSync}
        title="Sincronizar o cofre com a tabela vault_cofrenotas no Supabase"
        aria-label="Sincronizar com o Supabase"
        className="rail-btn rail-btn--accent"
      >
        <SyncIcon className="h-[19px] w-[19px]" />
      </button>

      <div className="flex-1" />

      <button
        type="button"
        onClick={onOpenSettings}
        title="Preferências de pesquisa"
        aria-label="Preferências de pesquisa"
        className="rail-btn"
      >
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-[18px] w-[18px]"
          aria-hidden
        >
          <path
            fillRule="evenodd"
            d="M7.84 1.804A1 1 0 018.82 1h2.36a1 1 0 01.98.804l.331 1.652a6.993 6.993 0 011.929 1.115l1.598-.54a1 1 0 011.186.447l1.18 2.044a1 1 0 01-.205 1.251l-1.267 1.113a7.047 7.047 0 010 2.228l1.267 1.113a1 1 0 01.206 1.25l-1.18 2.045a1 1 0 01-1.187.447l-1.598-.54a6.993 6.993 0 01-1.929 1.115l-.33 1.652a1 1 0 01-.98.804H8.82a1 1 0 01-.98-.804l-.331-1.652a6.993 6.993 0 01-1.929-1.115l-1.598.54a1 1 0 01-1.186-.447l-1.18-2.044a1 1 0 01.205-1.251l1.267-1.114a7.05 7.05 0 010-2.227L1.821 7.773a1 1 0 01-.206-1.25l1.18-2.045a1 1 0 011.187-.447l1.598.54A6.993 6.993 0 017.51 3.456l.33-1.652zM10 13a3 3 0 100-6 3 3 0 000 6z"
            clipRule="evenodd"
          />
        </svg>
      </button>
    </nav>
  );
}
