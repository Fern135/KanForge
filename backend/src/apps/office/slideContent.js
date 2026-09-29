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
//   footer: { number, text, skipFirst },
//   slides: [{ id, background, background2, bgAngle, transition, hidden, notes, elements: [element] }],
// }
// Every element: { id, type, x, y, w, h, rotation, flipH, flipV, opacity, shadow,
//                  locked, group, link, anim, animOrder }
//   text:  { ph, text, style }   ph: a layout placeholder ('title', 'subtitle', 'body', 'picture')
//   shape: { shape, fill, stroke, strokeWidth, text, style }
//   image: { imageId, radius }
//   table: { rows, cols, cells: [[text]], header, headerFill, fill, border, style }
//   chart: { chart, labels, series: [{ name, values }], title, legend, style }
//   icon:  { icon, color }
// style: { font, size, color, b, i, u, s, highlight, align, valign, list, spacing }
//
// Text is plain text with line breaks. It's only ever rendered as text, never as markup.

const LIMITS = {
  slides: 300,
  elements: 150,
  text: 5_000,
  cell: 1_000,
  notes: 10_000,
  tableRows: 20,
  tableCols: 10,
  chartLabels: 24,
  chartSeries: 6,
  jsonBytes: 3_000_000,
  searchText: 1_000_000,
};

const SIZES = { '16:9': { w: 960, h: 540 }, '4:3': { w: 720, h: 540 } };
const THEMES = ['light', 'dark', 'navy', 'forest', 'sunset', 'paper', 'ocean', 'aurora', 'slate', 'mint', 'berry', 'sand'];
const SHAPES = [
  'rect', 'roundRect', 'ellipse', 'triangle', 'rtTriangle', 'diamond', 'pentagon', 'hexagon', 'octagon',
  'star5', 'star6', 'chevron', 'parallelogram', 'trapezoid', 'plus', 'heart', 'callout',
  'arrow', 'leftRightArrow', 'downArrow', 'line',
];
const ICONS = [
  'star', 'heart', 'check', 'xmark', 'circle-check', 'lightbulb', 'rocket', 'chart-line', 'chart-pie', 'chart-column',
  'users', 'user', 'envelope', 'phone', 'globe', 'location-dot', 'calendar', 'clock', 'gear', 'lock', 'shield-halved',
  'flag', 'trophy', 'bolt', 'fire', 'leaf', 'cloud', 'sun', 'moon', 'house', 'building', 'briefcase', 'cart-shopping',
  'credit-card', 'dollar-sign', 'tag', 'gift', 'book', 'graduation-cap', 'laptop', 'mobile-screen', 'server',
  'database', 'code', 'bug', 'wrench', 'magnifying-glass', 'bell', 'comment', 'comments', 'thumbs-up', 'handshake',
  'bullseye', 'puzzle-piece', 'arrow-right', 'arrow-trend-up', 'circle-info', 'triangle-exclamation', 'camera',
  'image', 'music', 'video', 'plane', 'truck', 'map', 'compass', 'eye',
];
const CHARTS = ['column', 'bar', 'line', 'area', 'pie', 'donut'];
const ANIMATIONS = ['appear', 'fade', 'fly', 'zoom', 'wipe'];
const TRANSITIONS = ['none', 'fade', 'push', 'wipe', 'zoom', 'cover'];
const SPACINGS = [1, 1.15, 1.5, 2];
const COLOR = /^#[0-9a-f]{6}$/i;
const ID = /^[a-z0-9]{1,16}$/;
const OBJECT_ID = /^[a-f0-9]{24}$/;
const SAFE_LINK = /^(https?:\/\/|mailto:)[^\s<>"]+$/i;

const bad = (msg) => AppError.badRequest(msg, 'INVALID_CONTENT');
const color = (v) => (typeof v === 'string' && COLOR.test(v) ? v.toLowerCase() : null);
const num = (v, min, max, fallback) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(max, Math.max(min, v)) * 10) / 10 : fallback);
const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max) : '');

function cleanStyle(raw) {
  const s = isObject(raw) ? raw : {};
  const out = {};
  if (FONTS.includes(s.font)) out.font = s.font;
  if (typeof s.size === 'number' && s.size >= 6 && s.size <= 200) out.size = Math.round(s.size * 2) / 2;
  const c = color(s.color);
  if (c) out.color = c;
  const hl = color(s.highlight);
  if (hl) out.highlight = hl;
  for (const flag of ['b', 'i', 'u', 's']) if (s[flag] === true) out[flag] = true;
  const align = oneOf(s.align, ['left', 'center', 'right', 'justify']);
  if (align) out.align = align;
  const valign = oneOf(s.valign, ['top', 'middle', 'bottom']);
  if (valign) out.valign = valign;
  const list = oneOf(s.list, ['bullet', 'number']);
  if (list) out.list = list;
  const spacing = oneOf(s.spacing, SPACINGS);
  if (spacing && spacing !== 1) out.spacing = spacing;
  return out;
}

function cleanText(v, max = LIMITS.text, what = 'A text box') {
  if (typeof v !== 'string') return '';
  if (v.length > max) throw bad(`${what} can hold up to ${max.toLocaleString('en-US')} characters`);
  // Keep line breaks and tabs; drop other control characters.
  return v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
}

// Position, size and the options every kind of item has.
function cleanCommon(raw, id, W, H) {
  const el = {
    id,
    type: raw.type,
    x: num(raw.x, -W, 2 * W, 0),
    y: num(raw.y, -H, 2 * H, 0),
    w: num(raw.w, 1, 4 * W, 100),
    h: num(raw.h, 1, 4 * H, 100),
  };
  const rotation = num(raw.rotation, -3600, 3600, 0);
  const turn = Math.round((((rotation % 360) + 360) % 360) * 10) / 10;
  if (turn) el.rotation = turn;
  if (raw.flipH === true) el.flipH = true;
  if (raw.flipV === true) el.flipV = true;
  const opacity = num(raw.opacity, 0.1, 1, 1);
  if (opacity < 1) el.opacity = opacity;
  if (raw.shadow === true) el.shadow = true;
  if (raw.locked === true) el.locked = true;
  if (typeof raw.group === 'string' && ID.test(raw.group)) el.group = raw.group;
  if (typeof raw.link === 'string' && raw.link.length <= 2048 && SAFE_LINK.test(raw.link.trim())) el.link = raw.link.trim();
  const anim = oneOf(raw.anim, ANIMATIONS);
  if (anim) {
    el.anim = anim;
    el.animOrder = int(raw.animOrder, 1, 9999, 1);
  }
  return el;
}

function cleanTable(raw, el, addText) {
  el.rows = int(raw.rows, 1, LIMITS.tableRows, 1);
  el.cols = int(raw.cols, 1, LIMITS.tableCols, 1);
  const rows = Array.isArray(raw.cells) ? raw.cells : [];
  el.cells = Array.from({ length: el.rows }, (_, r) => Array.from({ length: el.cols }, (__, c) => {
    const t = cleanText(Array.isArray(rows[r]) ? rows[r][c] : '', LIMITS.cell, 'A table cell');
    addText(t);
    return t;
  }));
  el.header = raw.header !== false;
  el.headerFill = raw.headerFill === 'none' ? 'none' : color(raw.headerFill);
  el.fill = raw.fill === 'none' ? 'none' : color(raw.fill);
  el.border = raw.border === 'none' ? 'none' : color(raw.border);
  el.style = cleanStyle(raw.style);
}

function cleanChart(raw, el, addText) {
  el.chart = oneOf(raw.chart, CHARTS, 'column');
  const labels = Array.isArray(raw.labels) ? raw.labels.slice(0, LIMITS.chartLabels) : [];
  el.labels = labels.map((l) => str(l, 60));
  const series = Array.isArray(raw.series) ? raw.series.slice(0, LIMITS.chartSeries) : [];
  el.series = series.filter(isObject).map((s) => ({
    name: str(s.name, 60),
    values: el.labels.map((_, i) => {
      const v = Array.isArray(s.values) ? s.values[i] : 0;
      return typeof v === 'number' && Number.isFinite(v) ? Math.max(-1e12, Math.min(1e12, v)) : 0;
    }),
  }));
  if (!el.series.length) el.series = [{ name: 'Series 1', values: el.labels.map(() => 0) }];
  el.title = str(raw.title, 120);
  el.legend = raw.legend !== false;
  el.style = cleanStyle(raw.style);
  addText([el.title, ...el.labels, ...el.series.map((s) => s.name)].filter(Boolean).join(' '));
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
    for (const raw of rawElements) {
      if (!isObject(raw) || !oneOf(raw.type, ['text', 'shape', 'image', 'table', 'chart', 'icon'])) continue;
      if (raw.type === 'image' && (typeof raw.imageId !== 'string' || !OBJECT_ID.test(raw.imageId))) continue;
      const el = cleanCommon(raw, uniqueId(raw.id, 'e'), W, H);
      if (raw.type === 'text') {
        const ph = oneOf(raw.ph, ['title', 'subtitle', 'body', 'picture']);
        if (ph) el.ph = ph;
        el.text = cleanText(raw.text);
        el.style = cleanStyle(raw.style);
        addText(el.text);
      } else if (raw.type === 'shape') {
        el.shape = oneOf(raw.shape, SHAPES, 'rect');
        // A colour, 'none', or null for the theme's default.
        el.fill = raw.fill === 'none' ? 'none' : color(raw.fill);
        el.stroke = raw.stroke === 'none' ? 'none' : color(raw.stroke);
        el.strokeWidth = num(raw.strokeWidth, 0, 20, 0);
        el.text = cleanText(raw.text);
        el.style = cleanStyle(raw.style);
        addText(el.text);
      } else if (raw.type === 'image') {
        el.imageId = raw.imageId;
        const radius = num(raw.radius, 0, 50, 0);
        if (radius) el.radius = radius;
        imageIds.add(raw.imageId);
      } else if (raw.type === 'table') {
        cleanTable(raw, el, addText);
      } else if (raw.type === 'chart') {
        cleanChart(raw, el, addText);
      } else {
        el.icon = oneOf(raw.icon, ICONS, 'star');
        el.color = color(raw.color);
      }
      elements.push(el);
    }

    let notes = typeof slide.notes === 'string' ? slide.notes : '';
    if (notes.length > LIMITS.notes) throw bad(`Speaker notes can be up to ${LIMITS.notes.toLocaleString('en-US')} characters`);
    notes = cleanText(notes.slice(0, LIMITS.notes), LIMITS.notes, 'Speaker notes');
    addText(notes);

    const out = {
      id: uniqueId(slide.id, 's'),
      background: color(slide.background),
      background2: color(slide.background2),
      bgAngle: int(slide.bgAngle, 0, 360, 135),
      transition: oneOf(slide.transition, TRANSITIONS, 'none'),
      notes,
      elements,
    };
    if (slide.hidden === true) out.hidden = true;
    return out;
  });

  const footer = isObject(input.footer) ? input.footer : {};
  const doc = {
    size,
    theme: oneOf(input.theme, THEMES, 'light'),
    footer: { number: footer.number === true, text: str(footer.text, 200), skipFirst: footer.skipFirst !== false },
    slides,
    active: int(input.active, 0, slides.length - 1, 0),
  };
  addText(doc.footer.text);
  return { doc, text: text.join('\n').slice(0, LIMITS.searchText), imageIds: [...imageIds] };
}

// A title slide, like a new PowerPoint presentation.
const emptyDeck = () => ({
  size: '16:9',
  theme: 'light',
  footer: { number: false, text: '', skipFirst: true },
  active: 0,
  slides: [{
    id: 's1',
    background: null,
    background2: null,
    bgAngle: 135,
    transition: 'none',
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

module.exports = {
  sanitizeSlideContent, emptyDeck, SLIDE_SETTINGS, SLIDE_LIMITS: LIMITS, SLIDE_THEMES: THEMES, SLIDE_SHAPES: SHAPES, SLIDE_ICONS: ICONS,
};
