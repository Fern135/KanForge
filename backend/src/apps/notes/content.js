'use strict';

const { createSanitizer, int, linkMark } = require('../../core/services/richText');

// The Notes editor's schema (frontend apps/notes/extensions.js). Change both together.
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

const MARKS = {
  bold: {},
  italic: {},
  strike: {},
  underline: {},
  code: {},
  link: linkMark,
};

const MAX_TEXT = 100_000;

const sanitizeDoc = createSanitizer({
  nodes: NODES,
  marks: MARKS,
  // Blocks whose text ends a line in the plain-text copy used for search and previews.
  lineBlocks: ['paragraph', 'heading', 'codeBlock', 'listItem', 'taskItem', 'blockquote', 'horizontalRule'],
  noun: 'Note',
  limits: { maxText: MAX_TEXT, maxJsonBytes: 200_000 },
});

const EMPTY_DOC = Object.freeze({ type: 'doc', content: [{ type: 'paragraph' }] });

module.exports = { sanitizeDoc, EMPTY_DOC, MAX_TEXT };
