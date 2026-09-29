'use strict';

const { createSanitizer, int, oneOf, linkMark } = require('../../core/services/richText');

// The Docs editor's schema (frontend apps/office/docs/extensions.js). Change both together.

// Fonts offered in the font picker. Stored as full CSS stacks so text renders
// with a close fallback where the named font isn't installed.
const FONTS = [
  'Calibri, Carlito, "Segoe UI", Arial, sans-serif',
  'Arial, "Liberation Sans", Helvetica, sans-serif',
  '"Times New Roman", "Liberation Serif", Times, serif',
  'Georgia, serif',
  'Cambria, Caladea, Georgia, serif',
  'Garamond, "EB Garamond", Georgia, serif',
  'Verdana, Geneva, sans-serif',
  'Tahoma, Verdana, sans-serif',
  '"Trebuchet MS", Arial, sans-serif',
  '"Courier New", "Liberation Mono", Courier, monospace',
  '"Comic Sans MS", "Comic Neue", cursive',
  'Inter, system-ui, sans-serif',
];

const ALIGN = ['left', 'center', 'right', 'justify'];
const COLOR = /^(#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\))$/i;
const OBJECT_ID = /^[a-f0-9]{24}$/;

const color = (v) => (typeof v === 'string' && COLOR.test(v.trim()) ? v.trim() : null);
const fontSize = (v) => {
  if (typeof v !== 'string' || !/^\d{1,3}(\.\d)?pt$/.test(v)) return null;
  const n = parseFloat(v);
  return n >= 1 && n <= 400 ? v : null;
};
const lineHeight = (v) => {
  if (typeof v !== 'string' || !/^\d(\.\d{1,2})?$/.test(v)) return null;
  const n = parseFloat(v);
  return n >= 0.5 && n <= 5 ? v : null;
};
const colwidth = (v, span) => (Array.isArray(v) && v.length <= span && v.every((w) => Number.isInteger(w) && w >= 10 && w <= 3000) ? v : null);
const cell = (a) => {
  const colspan = int(a.colspan, 1, 50, 1);
  return { colspan, rowspan: int(a.rowspan, 1, 50, 1), colwidth: colwidth(a.colwidth, colspan), align: oneOf(a.align, ALIGN) };
};

const NODES = {
  doc: {},
  text: {},
  paragraph: { attrs: (a) => ({ textAlign: oneOf(a.textAlign, ALIGN) }) },
  heading: { attrs: (a) => ({ level: int(a.level, 1, 4, 1), textAlign: oneOf(a.textAlign, ALIGN) }) },
  blockquote: {},
  bulletList: {},
  orderedList: {
    attrs: (a) => ({ start: int(a.start, 0, 100_000, 1), type: oneOf(a.type, ['1', 'a', 'A', 'i', 'I']) }),
  },
  listItem: {},
  horizontalRule: {},
  hardBreak: {},
  pageBreak: {},
  table: {},
  tableRow: {},
  tableCell: { attrs: cell },
  tableHeader: { attrs: cell },
  // Images are stored separately (office_images) and referenced by id, so a
  // document never carries image data or an external URL.
  docImage: {
    attrs: (a) => ({
      imageId: typeof a.imageId === 'string' && OBJECT_ID.test(a.imageId) ? a.imageId : null,
      width: int(a.width, 16, 3000, null),
      alt: typeof a.alt === 'string' ? a.alt.slice(0, 300) : '',
      align: oneOf(a.align, ['left', 'center', 'right'], 'center'),
    }),
  },
};

const MARKS = {
  bold: {},
  italic: {},
  strike: {},
  underline: {},
  subscript: {},
  superscript: {},
  link: linkMark,
  highlight: { attrs: (a) => ({ color: color(a.color) }) },
  textStyle: {
    attrs: (a) => {
      const out = {
        color: color(a.color),
        backgroundColor: color(a.backgroundColor),
        fontFamily: FONTS.includes(a.fontFamily) ? a.fontFamily : null,
        fontSize: fontSize(a.fontSize),
        lineHeight: lineHeight(a.lineHeight),
      };
      return Object.values(out).some((v) => v !== null) ? out : null;
    },
  },
};

const sanitize = createSanitizer({
  nodes: NODES,
  marks: MARKS,
  lineBlocks: ['paragraph', 'heading', 'listItem', 'blockquote', 'tableCell', 'tableHeader', 'horizontalRule', 'pageBreak'],
  noun: 'Document',
  limits: { maxDepth: 40, maxNodes: 150_000, maxText: 1_000_000, maxJsonBytes: 3_000_000 },
});

// Also returns the ids of the images the document uses, so unused images can be cleaned up.
function sanitizeDocContent(input) {
  const { doc, text } = sanitize(input);
  const imageIds = new Set();
  (function collect(node) {
    if (node.type === 'docImage' && node.attrs.imageId) imageIds.add(node.attrs.imageId);
    node.content?.forEach(collect);
  })(doc);
  // An image node without a usable id has nothing to show.
  (function prune(node) {
    if (!node.content) return;
    node.content = node.content.filter((c) => !(c.type === 'docImage' && !c.attrs.imageId));
    node.content.forEach(prune);
  })(doc);
  if (!doc.content?.length) doc.content = [{ type: 'paragraph', attrs: { textAlign: null } }];
  return { doc, text, imageIds: [...imageIds] };
}

const EMPTY_DOC = Object.freeze({ type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: null } }] });

// Page setup, in millimetres. Letter with 1-inch margins, like Word.
const PAGE_SIZES = ['letter', 'a4', 'legal', 'a5'];
const DEFAULT_SETTINGS = Object.freeze({
  pageSize: 'letter',
  orientation: 'portrait',
  margins: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 },
});

module.exports = { sanitizeDocContent, EMPTY_DOC, FONTS, PAGE_SIZES, DEFAULT_SETTINGS };
