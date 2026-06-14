import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import React, { useMemo } from "react";
import { useVaultStore } from "../store/vaultStore";
import { highlight } from "../lib/highlight";

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

export function NoteViewer() {
  const notes = useVaultStore((s) => s.notes);
  const activePath = useVaultStore((s) => s.activePath);
  const query = useVaultStore((s) => s.query);
  const searchMode = useVaultStore((s) => s.searchPrefs.searchMode);
  const note = notes.find((n) => n.path === activePath) ?? null;

  const components = useMemo<Components>(() => {
    const base: Components = {
      pre: (props) => {
        if (shouldSkipBlock(props.children)) return null;
        return <pre {...props} />;
      },
    };

    if (!query) return base;

    const wrap = (Tag: keyof React.JSX.IntrinsicElements) => {
      const Comp = (props: { children?: React.ReactNode }) => (
        <Tag>{highlight(props.children, query, searchMode)}</Tag>
      );
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
  }, [query, searchMode]);

  if (!note) {
    return (
      <div className="h-full grid place-items-center text-zinc-400 text-sm">
        Selecione uma nota
      </div>
    );
  }

  return (
    <article className="max-w-3xl mx-auto px-8 py-10">
      <header className="mb-8 pb-4 border-b border-zinc-200">
        <h1 className="text-3xl font-semibold text-zinc-900">
          {highlight(note.name, query, searchMode)}
        </h1>
        <p className="mt-1 text-xs text-zinc-500">
          {note.path} · {new Date(note.lastModified).toLocaleString("pt-BR")}
        </p>
      </header>
      <div className="md-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {note.content}
        </ReactMarkdown>
      </div>
    </article>
  );
}
