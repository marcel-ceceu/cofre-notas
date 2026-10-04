import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import React, { useMemo } from "react";
import { useVaultStore } from "../store/vaultStore";
import { highlight, highlightFind } from "../lib/highlight";

/**
 * Lixo de export do Claude/ChatGPT — code fences contendo apenas placeholders
 * de artifacts/tool-calls que nao couberam no markdown.
 */
const SKIP_BLOCK_PATTERNS = [
  /^this block is not supported on your current device yet\.?$/i,
];

function extractTextFromChildren(children: React.ReactNode): string {
  if (children == null) return "";
  if (typeof children === "string") return children;
  if (typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(extractTextFromChildren).join("");
  if (React.isValidElement(children)) {
    const el = children as React.ReactElement<{ children?: React.ReactNode }>;
    return extractTextFromChildren(el.props?.children);
  }
  return "";
}

function shouldSkipBlock(children: React.ReactNode): boolean {
  const text = extractTextFromChildren(children).trim();
  if (!text) return false;
  return SKIP_BLOCK_PATTERNS.some((re) => re.test(text));
}

type Marker = (children: React.ReactNode) => React.ReactNode;

/** Props que o react-markdown entrega aos componentes (inclui o nó hast em `node`). */
type MdProps = React.HTMLAttributes<HTMLElement> & { node?: unknown };

/**
 * memo: o viewer assina a store sozinho (sem props) — re-renders do App
 * (seleção, arraste da sidebar, modais) não devem re-parsear o markdown.
 */
export const NoteViewer = React.memo(function NoteViewer() {
  const notes = useVaultStore((s) => s.notes);
  const activePath = useVaultStore((s) => s.activePath);
  const query = useVaultStore((s) => s.query);
  const findTerm = useVaultStore((s) => s.findTerm);
  const searchMode = useVaultStore((s) => s.searchPrefs.searchMode);
  const note = notes.find((n) => n.path === activePath) ?? null;

  // Busca na nota ativa suprime o realce da busca global: um só conjunto de
  // <mark> no DOM, para o contador "N de M" e a régua baterem.
  // Com findTerm ativo a query não entra nas deps: digitar na busca global
  // não deve remontar o markdown (perderia a ocorrência atual).
  const effectiveQuery = findTerm ? "" : query;
  const mark = useMemo<Marker | null>(() => {
    if (findTerm) return (c) => highlightFind(c, findTerm);
    if (effectiveQuery) return (c) => highlight(c, effectiveQuery, searchMode);
    return null;
  }, [effectiveQuery, searchMode, findTerm]);

  const components = useMemo<Components>(() => {
    const base: Components = {
      // `node` (hast) não pode vazar para o DOM.
      pre: ({ node: _node, ...rest }) => {
        if (shouldSkipBlock(rest.children)) return null;
        return <pre {...rest} />;
      },
    };

    if (!mark) return base;

    const wrap = (Tag: keyof React.JSX.IntrinsicElements) => {
      const Comp = ({ node: _node, children, ...rest }: MdProps) =>
        React.createElement(Tag, rest, mark(children));
      Comp.displayName = `Highlighted(${String(Tag)})`;
      return Comp;
    };
    return {
      ...base,
      p: wrap("p"),
      li: wrap("li"),
      h1: wrap("h1"),
      h2: wrap("h2"),
      h3: wrap("h3"),
      h4: wrap("h4"),
      h5: wrap("h5"),
      h6: wrap("h6"),
      td: wrap("td"),
      th: wrap("th"),
      blockquote: wrap("blockquote"),
      code: wrap("code"),
    };
  }, [mark]);

  if (!note) {
    return (
      <div className="grid h-full place-items-center px-8 text-center">
        <div>
          <p className="text-[15px] font-medium text-[var(--ink-muted)]">
            Nenhuma nota aberta
          </p>
          <p className="mt-1 text-[12.5px] text-[var(--ink-faint)]">
            Escolha uma conversa na coluna à esquerda.
          </p>
        </div>
      </div>
    );
  }

  return (
    <article className="mx-auto max-w-[76ch] px-9 py-8">
      <header className="mb-7 border-b border-[var(--rule-soft)] pb-5">
        <p className="meta-label">
          {new Date(note.lastModified).toLocaleDateString("pt-BR", {
            day: "2-digit",
            month: "long",
            year: "numeric",
          })}
        </p>
        <h1 className="mt-1.5 text-[1.6rem] leading-[1.2] font-semibold tracking-tight text-balance text-[var(--ink)]">
          {mark ? mark(note.name) : note.name}
        </h1>
        <div className="mt-3 flex items-center gap-2">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
          <span className="truncate font-mono-ui text-[10px] text-[var(--ink-faint)]">
            {note.path}
          </span>
        </div>
      </header>
      <div className="md-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {note.content}
        </ReactMarkdown>
      </div>
    </article>
  );
});
