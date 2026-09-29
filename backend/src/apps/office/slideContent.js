'use strict';

const AppError = require('../../core/utils/AppError');
const { int, oneOf, isObject } = require('../../core/services/richText');
const { FONTS } = require('./docContent');

// A presentation, as the editor saves it (frontend apps/office/slides/model.js).
// Change both together.
//
// {
//   size: '16:9' | '4:3',        slide area in points: 960 × 540 or 720 × 540
//   theme: theme id,
//   slides: [{ id, background, notes, elements: [element] }],
// }
// element: { id, type: 'text' | 'shape' | 'image', x, y, w, h, ... }
//   text:  { ph, text, style }   ph: 'title' | 'subtitle' | 'body' (a layout placeholder)
//   shape: { shape, fill, stroke, strokeWidth, text, style }
//   image: { imageId }
// style: { font, size, color, b, i, u, align, valign, list }
//
// Text is plain text with line breaks. It's only ever rendered as text, never as markup.

const LIMITS = {
  slides: 300,
  elements: 150,
  text: 5_000,
  notes: 10_000,
  jsonBytes: 3_000_000,
  searchText: 1_000_000,
};

const SIZES = { '16:9': { w: 960, h: 540 }, '4:3': { w: 720, h: 540 } };
const THEMES = ['light', 'dark', 'navy', 'forest', 'sunset', 'paper'];
const SHAPES = ['rect', 'roundRect', 'ellipse', 'triangle', 'line', 'arrow'];
const COLOR = /^#[0-9a-f]{6}$/i;
const ID = /^[a-z0-9]{1,16}$/;
const OBJECT_ID = /^[a-f0-9]{24}$/;

const bad = (msg) => AppError.badRequest(msg, 'INVALID_CONTENT');
const color = (v) => (typeof v === 'string' && COLOR.test(v) ? v.toLowerCase() : null);
const num = (v, min, max, fallback) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(max, Math.max(min, v)) * 10) / 10 : fallback);

function cleanStyle(raw) {
  const s = isObject(raw) ? raw : {};
  const out = {};
  if (FONTS.includes(s.font)) out.font = s.font;
  if (typeof s.size === 'number' && s.size >= 6 && s.size <= 200) out.size = Math.round(s.size * 2) / 2;
  const c = color(s.color);
  if (c) out.color = c;
  for (const flag of ['b', 'i', 'u']) if (s[flag] === true) out[flag] = true;
  const align = oneOf(s.align, ['left', 'center', 'right', 'justify']);
  if (align) out.align = align;
  const valign = oneOf(s.valign, ['top', 'middle', 'bottom']);
  if (valign) out.valign = valign;
  const list = oneOf(s.list, ['bullet', 'number']);
  if (list) out.list = list;
  return out;
}

function cleanText(v) {
  if (typeof v !== 'string') return '';
  if (v.length > LIMITS.text) throw bad(`A text box can hold up to ${LIMITS.text.toLocaleString('en-US')} characters`);
  // Keep line breaks and tabs; drop other control characters.
  return v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
}

function sanitizeSlideContent(input) {
  if (!isObject(input) || !Array.isArray(input.slides)) throw bad('Presentation content must be a slide deck');
  if (!input.slides.length) throw bad('A presentation needs at least one slide');
  if (input.slides.length > LIMITS.slides) throw bad(`A presentation can have up to ${LIMITS.slides} slides`);
  if (JSON.stringify(input).length > LIMITS.jsonBytes) throw bad('This presentation is too large to save');

  const size = SIZES[input.size] ? input.size : '16:9';
  const { w: W, h: H } = SIZES[size];
  const ids = new Set();
  const uniqueId = (raw, prefix) => {
    let id = typeof raw === 'string' && ID.test(raw) && !ids.has(raw) ? raw : null;
    for (let n = ids.size + 1; !id; n += 1) if (!ids.has(`${prefix}${n}`)) id = `${prefix}${n}`;
    ids.add(id);
    return id;
  };

  const text = [];
  let textLength = 0;
  const addText = (t) => {
    if (!t || textLength >= LIMITS.searchText) return;
    text.push(t);
    textLength += t.length + 1;
  };
  const imageIds = new Set();

  const slides = input.slides.map((rawSlide) => {
    const slide = isObject(rawSlide) ? rawSlide : {};
    const rawElements = Array.isArray(slide.elements) ? slide.elements : [];
    if (rawElements.length > LIMITS.elements) throw bad(`A slide can have up to ${LIMITS.elements} items`);

    const elements = [];
    for (const rawEl of rawElements) {
      if (!isObject(rawEl)) continue;
      const type = oneOf(rawEl.type, ['text', 'shape', 'image']);
      if (!type) continue;
      const el = {
        id: uniqueId(rawEl.id, 'e'),
        type,
        x: num(rawEl.x, -W, 2 * W, 0),
        y: num(rawEl.y, -H, 2 * H, 0),
        w: num(rawEl.w, 1, 4 * W, 100),
        h: num(rawEl.h, 1, 4 * H, 100),
      };
      if (type === 'text') {
        // A layout's placeholder role, which picks the hint shown while it's empty.
        const ph = oneOf(rawEl.ph, ['title', 'subtitle', 'body']);
        if (ph) el.ph = ph;
        el.text = cleanText(rawEl.text);
        el.style = cleanStyle(rawEl.style);
        addText(el.text);
      } else if (type === 'shape') {
        el.shape = oneOf(rawEl.shape, SHAPES, 'rect');
        // A colour, 'none', or null for the theme's default.
        el.fill = rawEl.fill === 'none' ? 'none' : color(rawEl.fill);
        el.stroke = rawEl.stroke === 'none' ? 'none' : color(rawEl.stroke);
        el.strokeWidth = num(rawEl.strokeWidth, 0, 20, 0);
        el.text = cleanText(rawEl.text);
        el.style = cleanStyle(rawEl.style);
        addText(el.text);
      } else {
        if (typeof rawEl.imageId !== 'string' || !OBJECT_ID.test(rawEl.imageId)) continue;
        el.imageId = rawEl.imageId;
        imageIds.add(rawEl.imageId);
      }
      elements.push(el);
    }

    let notes = typeof slide.notes === 'string' ? slide.notes : '';
    if (notes.length > LIMITS.notes) throw bad(`Speaker notes can be up to ${LIMITS.notes.toLocaleString('en-US')} characters`);
    notes = cleanText(notes.slice(0, LIMITS.notes));
    addText(notes);

    return { id: uniqueId(slide.id, 's'), background: color(slide.background), notes, elements };
  });

  const doc = {
    size,
    theme: oneOf(input.theme, THEMES, 'light'),
    slides,
    active: int(input.active, 0, slides.length - 1, 0),
  };
  return { doc, text: text.join('\n').slice(0, LIMITS.searchText), imageIds: [...imageIds] };
}

// A title slide, like a new PowerPoint presentation.
const emptyDeck = () => ({
  size: '16:9',
  theme: 'light',
  active: 0,
  slides: [{
    id: 's1',
    background: null,
    notes: '',
    elements: [
      { id: 'e1', type: 'text', ph: 'title', x: 80, y: 160, w: 800, h: 120, text: '', style: { size: 48, align: 'center', valign: 'bottom', b: true } },
      { id: 'e2', type: 'text', ph: 'subtitle', x: 80, y: 300, w: 800, h: 70, text: '', style: { size: 24, align: 'center', valign: 'top' } },
    ],
  }],
});

// Printing: one slide per landscape page, edge to edge.
const SLIDE_SETTINGS = Object.freeze({
  pageSize: 'letter',
  orientation: 'landscape',
  margins: { top: 0, right: 0, bottom: 0, left: 0 },
});

module.exports = { sanitizeSlideContent, emptyDeck, SLIDE_SETTINGS, SLIDE_LIMITS: LIMITS, SLIDE_THEMES: THEMES };
