import React from "react";
import { searchTerms, type SearchMode } from "./search";
import { findMatches, type Span } from "./noteFind";

type SpansOf = (text: string) => Span[];

/** Realce da busca global: termos da consulta (classe "hl"). */
export function highlight(
  children: React.ReactNode,
  query: string,
  mode: SearchMode = "tokens"
): React.ReactNode {
  if (!query) return children;
  const terms = searchTerms(query, mode);
  if (terms.length === 0) return children;
  return walk(children, (text) => termSpans(text, terms), "hl");
}

/** Realce da busca dentro da nota: substring literal, sem maiúsculas/acentos (classe "hl-find"). */
export function highlightFind(
  children: React.ReactNode,
  term: string
): React.ReactNode {
  if (term.trim() === "") return children;
  return walk(children, (text) => findMatches(text, term), "hl-find");
}

function walk(
  node: React.ReactNode,
  spansOf: SpansOf,
  markClass: string
): React.ReactNode {
  if (typeof node === "string") return renderSpans(node, spansOf(node), markClass);
  if (typeof node === "number") return node;
  if (Array.isArray(node)) {
    return node.map((c, i) => (
      <React.Fragment key={i}>{walk(c, spansOf, markClass)}</React.Fragment>
    ));
  }
  if (React.isValidElement(node)) {
    const el = node as React.ReactElement<{ children?: React.ReactNode }>;
    // Blocos aninhados (li > p, p > code) já vêm realçados pelo componente de
    // fora; descer num <mark> geraria <mark><mark>…</mark></mark> e inflaria a
    // contagem de ocorrências.
    if (el.type === "mark") return node;
    const childProps = el.props ?? {};
    if (childProps.children === undefined) return node;
    return React.cloneElement(el, {
      ...childProps,
      children: walk(childProps.children, spansOf, markClass),
    });
  }
  return node;
}

/** Ocorrências dos termos (já em minúsculas), mescladas quando se sobrepõem. */
function termSpans(text: string, terms: string[]): Span[] {
  const lower = text.toLowerCase();
  const spans: Span[] = [];

  for (const term of terms) {
    let i = 0;
    while (i < text.length) {
      const idx = lower.indexOf(term, i);
      if (idx === -1) break;
      spans.push({ start: idx, end: idx + term.length });
      i = idx + term.length;
    }
  }
  if (spans.length === 0) return spans;

  spans.sort((a, b) => a.start - b.start);
  const merged: Span[] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) {
      merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, s.end) };
    } else {
      merged.push(s);
    }
  }
  return merged;
}

function renderSpans(text: string, spans: Span[], markClass: string): React.ReactNode {
  if (spans.length === 0) return text;

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  for (const { start, end } of spans) {
    if (cursor < start) parts.push(text.slice(cursor, start));
    parts.push(
      <mark key={key++} className={markClass}>
        {text.slice(start, end)}
      </mark>
    );
    cursor = end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}
