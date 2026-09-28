'use strict';

const AppError = require('../../core/utils/AppError');

// Notes are stored as the editor's JSON document, never as HTML. This rebuilds
// every document from an allow-list that matches the editor's schema exactly:
// unknown node or mark types are refused, unknown attributes are dropped, and
// links only keep http(s) and mailto addresses. The editor renders the result
// through its schema, so nothing in a note can become markup or script.

const MAX_DEPTH = 30;
const MAX_NODES = 20_000;
const MAX_TEXT = 100_000;
const MAX_JSON_BYTES = 200_000;

const int = (v, min, max, fallback) => (Number.isInteger(v) && v >= min && v <= max ? v : fallback);

const NODES = {
  doc: {},
  paragraph: {},
  text: {},
  heading: { attrs: (a) => ({ level: int(a.level, 1, 3, 1) }) },
  blockquote: {},
  bulletList: {},
  orderedList: {
    attrs: (a) => ({
      start: int(a.start, 0, 100_000, 1),
      type: ['1', 'a', 'A', 'i', 'I'].includes(a.type) ? a.type : null,
    }),
  },
  listItem: {},
  taskList: {},
  taskItem: { attrs: (a) => ({ checked: a.checked === true }) },
  codeBlock: {
    attrs: (a) => ({ language: typeof a.language === 'string' && /^[\w+#-]{1,30}$/.test(a.language) ? a.language : null }),
  },
  horizontalRule: {},
  hardBreak: {},
};

const SAFE_HREF = /^(https?:\/\/|mailto:)/i;
const MARKS = {
  bold: {},
  italic: {},
  strike: {},
  underline: {},
  code: {},
  link: {
    // Returning null drops the mark (the text stays).
    attrs: (a) => {
      if (typeof a.href !== 'string' || a.href.length > 2048 || !SAFE_HREF.test(a.href.trim())) return null;
      return {
        href: a.href.trim(),
        target: '_blank',
        rel: 'noopener noreferrer nofollow',
        class: null,
        title: typeof a.title === 'string' ? a.title.slice(0, 200) : null,
      };
    },
  },
};

// Blocks whose text ends a line in the plain-text copy used for search and previews.
const LINE_BLOCKS = new Set(['paragraph', 'heading', 'codeBlock', 'listItem', 'taskItem', 'blockquote', 'horizontalRule']);

const bad = (msg) => AppError.badRequest(msg, 'INVALID_CONTENT');
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function sanitizeDoc(input) {
  if (!isObject(input) || input.type !== 'doc') throw bad('Note content must be a document');
  const state = { nodes: 0, textLength: 0, lines: [], line: '' };

  function flush() {
    if (state.line) state.lines.push(state.line);
    state.line = '';
  }

  function walk(node, depth) {
    if (!isObject(node)) throw bad('Invalid note content');
    if (depth > MAX_DEPTH) throw bad('Note content is nested too deeply');
    if (++state.nodes > MAX_NODES) throw bad('Note is too long');
    const spec = NODES[node.type];
    if (!spec) throw bad('Note content has an unsupported element');

    const out = { type: node.type };
    if (spec.attrs) out.attrs = spec.attrs(isObject(node.attrs) ? node.attrs : {});

    if (node.type === 'text') {
      if (typeof node.text !== 'string' || !node.text) throw bad('Invalid note content');
      state.textLength += node.text.length;
      if (state.textLength > MAX_TEXT) throw bad('Note is too long');
      out.text = node.text;
      state.line += node.text;
      if (Array.isArray(node.marks) && node.marks.length) {
        const marks = [];
        for (const m of node.marks.slice(0, 10)) {
          const mSpec = isObject(m) ? MARKS[m.type] : undefined;
          if (!mSpec) throw bad('Note content has an unsupported format');
          if (!mSpec.attrs) {
            marks.push({ type: m.type });
            continue;
          }
          const attrs = mSpec.attrs(isObject(m.attrs) ? m.attrs : {});
          if (attrs) marks.push({ type: m.type, attrs });
        }
        if (marks.length) out.marks = marks;
      }
      return out;
    }

    if (node.type === 'hardBreak') {
      flush();
      return out;
    }
    if (Array.isArray(node.content)) {
      out.content = node.content.map((child) => walk(child, depth + 1));
    } else if (node.content !== undefined) {
      throw bad('Invalid note content');
    }
    if (LINE_BLOCKS.has(node.type)) flush();
    return out;
  }

  const doc = walk(input, 0);
  flush();
  if (JSON.stringify(doc).length > MAX_JSON_BYTES) throw bad('Note is too long');
  return { doc, text: state.lines.join('\n') };
}

const EMPTY_DOC = Object.freeze({ type: 'doc', content: [{ type: 'paragraph' }] });

module.exports = { sanitizeDoc, EMPTY_DOC, MAX_TEXT };
