'use strict';

const AppError = require('../utils/AppError');

// Rich text (Notes, Office documents) is stored as the editor's JSON document,
// never as HTML. createSanitizer() builds a function that rebuilds every
// document from an app's allow-list, which must match that app's editor schema
// exactly: unknown node or mark types are refused, unknown attributes are
// dropped, and attribute values are checked. The editor renders the result
// through its schema, so nothing stored can become markup or script.
//
// A node or mark spec is {} (no attributes) or { attrs: (raw) => clean }.
// A mark's attrs() may return null to drop the mark and keep its text.

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const int = (v, min, max, fallback) => (Number.isInteger(v) && v >= min && v <= max ? v : fallback);
const oneOf = (v, allowed, fallback = null) => (allowed.includes(v) ? v : fallback);

const SAFE_HREF = /^(https?:\/\/|mailto:)/i;
const linkMark = {
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
};

function createSanitizer({ nodes, marks, lineBlocks, noun = 'Document', limits = {} }) {
  const { maxDepth = 30, maxNodes = 20_000, maxText = 100_000, maxJsonBytes = 200_000 } = limits;
  const bad = (msg) => AppError.badRequest(msg, 'INVALID_CONTENT');
  const lines = new Set(lineBlocks);

  return function sanitizeDoc(input) {
    if (!isObject(input) || input.type !== 'doc') throw bad(`${noun} content must be a document`);
    const state = { nodes: 0, textLength: 0, lines: [], line: '' };

    function flush() {
      if (state.line) state.lines.push(state.line);
      state.line = '';
    }

    function cleanMarks(list) {
      const out = [];
      for (const m of list.slice(0, 12)) {
        const spec = isObject(m) ? marks[m.type] : undefined;
        if (!spec) throw bad(`${noun} content has an unsupported format`);
        if (!spec.attrs) {
          out.push({ type: m.type });
          continue;
        }
        const attrs = spec.attrs(isObject(m.attrs) ? m.attrs : {});
        if (attrs) out.push({ type: m.type, attrs });
      }
      return out;
    }

    function walk(node, depth) {
      if (!isObject(node)) throw bad(`Invalid ${noun.toLowerCase()} content`);
      if (depth > maxDepth) throw bad(`${noun} content is nested too deeply`);
      if (++state.nodes > maxNodes) throw bad(`${noun} is too long`);
      const spec = nodes[node.type];
      if (!spec) throw bad(`${noun} content has an unsupported element`);

      const out = { type: node.type };
      if (spec.attrs) out.attrs = spec.attrs(isObject(node.attrs) ? node.attrs : {});

      if (node.type === 'text') {
        if (typeof node.text !== 'string' || !node.text) throw bad(`Invalid ${noun.toLowerCase()} content`);
        state.textLength += node.text.length;
        if (state.textLength > maxText) throw bad(`${noun} is too long`);
        out.text = node.text;
        state.line += node.text;
        if (Array.isArray(node.marks) && node.marks.length) {
          const cleaned = cleanMarks(node.marks);
          if (cleaned.length) out.marks = cleaned;
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
        throw bad(`Invalid ${noun.toLowerCase()} content`);
      }
      if (lines.has(node.type)) flush();
      return out;
    }

    const doc = walk(input, 0);
    flush();
    if (JSON.stringify(doc).length > maxJsonBytes) throw bad(`${noun} is too long`);
    return { doc, text: state.lines.join('\n') };
  };
}

module.exports = { createSanitizer, isObject, int, oneOf, linkMark };
