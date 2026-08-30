/**
 * Ícones compartilhados — SVG puro, ZERO dependências.
 * Ficam aqui (e não nos modais) para o ActivityRail não arrastar o grafo dos
 * modais (Supabase, fflate, …) para o chunk de boot.
 */

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

/** Ícone do rail e do cabeçalho — cérebro/memória destilada. */
export function PilotoIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M10 3.25c-2 0-3.25 1.2-3.25 2.6-1.3.3-2 1.3-2 2.4 0 .8.35 1.45.9 1.85-.3.4-.45.9-.45 1.4 0 1.5 1.25 2.5 2.9 2.5.55 0 1-.1 1.4-.3v2.05" />
      <path d="M10 3.25c2 0 3.25 1.2 3.25 2.6 1.3.3 2 1.3 2 2.4 0 .8-.35 1.45-.9 1.85.3.4.45.9.45 1.4 0 1.5-1.25 2.5-2.9 2.5-.55 0-1-.1-1.4-.3v2.05" />
      <path d="M10 3.25v12.5" />
    </svg>
  );
}
