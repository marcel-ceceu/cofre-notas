import React from "react";
import { searchTerms, type SearchMode } from "./search";

export function highlight(
  children: React.ReactNode,
  query: string,
  mode: SearchMode = "tokens"
): React.ReactNode {
  if (!query) return children;
  const terms = searchTerms(query, mode);
  if (terms.length === 0) return children;
  return walk(children, terms);
}

function walk(node: React.ReactNode, terms: string[]): React.ReactNode {
  if (typeof node === "string") return highlightString(node, terms);
  if (typeof node === "number") return node;
  if (Array.isArray(node)) {
    return node.map((c, i) => (
      <React.Fragment key={i}>{walk(c, terms)}</React.Fragment>
    ));
  }
  if (React.isValidElement(node)) {
    const el = node as React.ReactElement<{ children?: React.ReactNode }>;
    const childProps = el.props ?? {};
    if (childProps.children === undefined) return node;
    return React.cloneElement(el, {
      ...childProps,
      children: walk(childProps.children, terms),
    });
  }
  return node;
}

function highlightString(text: string, terms: string[]): React.ReactNode {
  const lower = text.toLowerCase();
  const spans: { start: number; end: number }[] = [];

  for (const term of terms) {
    let i = 0;
    while (i < text.length) {
      const idx = lower.indexOf(term, i);
      if (idx === -1) break;
      spans.push({ start: idx, end: idx + term.length });
      i = idx + term.length;
    }
  }

  if (spans.length === 0) return text;

  spans.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) {
      last.end = Math.max(last.end, s.end);
    } else {
      merged.push({ ...s });
    }
  }

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  for (const { start, end } of merged) {
    if (cursor < start) parts.push(text.slice(cursor, start));
    parts.push(
      <mark
        key={key++}
        className="bg-yellow-200 text-zinc-900 rounded px-0.5"
      >
        {text.slice(start, end)}
      </mark>
    );
    cursor = end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}
