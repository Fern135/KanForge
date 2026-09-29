import { FONTS } from '../docs/fonts';

// A presentation, as saved (backend apps/office/slideContent.js checks it; change both together).
//   { size, theme, active, slides: [{ id, background, notes, elements: [...] }] }
// Positions and sizes are in points on the slide: 960 × 540 for 16:9 and
// 720 × 540 for 4:3, which is also PowerPoint's slide size in points.

export const SIZES = { '16:9': { w: 960, h: 540, label: 'Widescreen (16:9)' }, '4:3': { w: 720, h: 540, label: 'Standard (4:3)' } };
export const LIMITS = { slides: 300, elements: 150, text: 5000, notes: 10_000 };

const font = (label) => FONTS.find((f) => f.label === label).value;

// Each theme: background, text colour, an accent for shapes and titles, and a font.
export const THEMES = {
  light: { label: 'Office', bg: '#ffffff', text: '#262626', title: '#1f1f1f', accent: '#2b579a', font: font('Calibri') },
  dark: { label: 'Dark', bg: '#1f1f1f', text: '#f2f2f2', title: '#ffffff', accent: '#4ea8de', font: font('Calibri') },
  navy: { label: 'Navy', bg: '#0b2545', text: '#e8eef6', title: '#ffffff', accent: '#8ee3a6', font: font('Inter') },
  forest: { label: 'Forest', bg: '#1f3d2b', text: '#eef5ec', title: '#ffffff', accent: '#a8d08d', font: font('Georgia') },
  sunset: { label: 'Sunset', bg: '#fff4e6', text: '#4a2c1a', title: '#8a3b12', accent: '#c55a11', font: font('Trebuchet MS') },
  paper: { label: 'Paper', bg: '#f7f3e9', text: '#3a3a3a', title: '#2b2118', accent: '#8b5e34', font: font('Garamond') },
};

export const SHAPES = [
  { id: 'rect', label: 'Rectangle' },
  { id: 'roundRect', label: 'Rounded rectangle' },
  { id: 'ellipse', label: 'Oval' },
  { id: 'triangle', label: 'Triangle' },
  { id: 'arrow', label: 'Arrow' },
  { id: 'line', label: 'Line' },
];

export const PLACEHOLDER = { title: 'Click to add title', subtitle: 'Click to add subtitle', body: 'Click to add text' };

export const slideSize = (deck) => SIZES[deck.size] ?? SIZES['16:9'];
export const themeOf = (deck) => THEMES[deck.theme] ?? THEMES.light;

export const newId = (prefix) => `${prefix}${Math.random().toString(36).slice(2, 10)}`;

const text = (ph, x, y, w, h, style) => ({ id: newId('e'), type: 'text', ph, x, y, w, h, text: '', style });

// New slides, like PowerPoint's layouts. Positions scale with the slide width.
export const LAYOUTS = [
  { id: 'title', label: 'Title slide' },
  { id: 'content', label: 'Title and content' },
  { id: 'two', label: 'Two content' },
  { id: 'section', label: 'Section header' },
  { id: 'titleOnly', label: 'Title only' },
  { id: 'blank', label: 'Blank' },
];

export function makeSlide(layout, size = '16:9') {
  const { w: W } = SIZES[size] ?? SIZES['16:9'];
  const m = W / 12;
  const full = W - 2 * m;
  const titleTop = text('title', m, 30, full, 90, { size: 36, b: true, valign: 'middle' });
  const elements = {
    title: [
      text('title', m, 160, full, 120, { size: 48, b: true, align: 'center', valign: 'bottom' }),
      text('subtitle', m, 300, full, 70, { size: 24, align: 'center', valign: 'top' }),
    ],
    content: [titleTop, text('body', m, 140, full, 360, { size: 24, list: 'bullet' })],
    two: [
      titleTop,
      text('body', m, 140, full / 2 - 15, 360, { size: 22, list: 'bullet' }),
      text('body', m + full / 2 + 15, 140, full / 2 - 15, 360, { size: 22, list: 'bullet' }),
    ],
    section: [
      text('title', m, 200, full, 110, { size: 44, b: true, valign: 'bottom' }),
      text('subtitle', m, 320, full, 60, { size: 22, valign: 'top' }),
    ],
    titleOnly: [titleTop],
    blank: [],
  }[layout] ?? [];
  return { id: newId('s'), background: null, notes: '', elements };
}

export function emptyDeck() {
  const deck = { size: '16:9', theme: 'light', active: 0, slides: [makeSlide('title')] };
  return deck;
}

// Content from the server → the editor's deck (the same shape, with defaults filled in).
export function fromContent(content) {
  const c = content && Array.isArray(content.slides) && content.slides.length ? content : emptyDeck();
  const slides = c.slides.map((s) => ({
    id: s.id,
    background: s.background ?? null,
    notes: s.notes ?? '',
    elements: (s.elements ?? []).map((e) => ({ ...e, style: e.style ?? {} })),
  }));
  return {
    size: SIZES[c.size] ? c.size : '16:9',
    theme: THEMES[c.theme] ? c.theme : 'light',
    active: Math.min(Math.max(0, c.active ?? 0), slides.length - 1),
    slides,
  };
}

export const toContent = (deck) => deck;

// Where an element's text is drawn inside its box.
const JUSTIFY = { top: 'flex-start', middle: 'center', bottom: 'flex-end' };

// CSS for an element's text, in slide points (1pt = 1px before the slide is scaled).
export function textCss(el, theme) {
  const s = el.style ?? {};
  return {
    fontFamily: s.font ?? theme.font,
    fontSize: `${s.size ?? 18}px`,
    color: s.color ?? (el.type === 'shape' ? '#ffffff' : el.ph === 'title' ? theme.title : theme.text),
    fontWeight: s.b ? 700 : 400,
    fontStyle: s.i ? 'italic' : 'normal',
    textDecoration: s.u ? 'underline' : 'none',
    textAlign: s.align ?? 'left',
    justifyContent: JUSTIFY[s.valign ?? (el.type === 'shape' ? 'middle' : 'top')],
  };
}

// Fill and outline: a colour, 'none', or null for the theme's accent (fill) / no outline.
export function shapeColors(el, accent) {
  const line = el.shape === 'line';
  const fill = line || el.fill === 'none' ? 'none' : el.fill ?? accent;
  const stroke = el.stroke === 'none' ? 'none' : el.stroke ?? (line ? accent : 'none');
  const strokeWidth = stroke === 'none' ? 0 : el.strokeWidth || (line ? 3 : 1);
  return { fill, stroke, strokeWidth };
}

// Every image the deck uses.
export const deckImageIds = (deck) => [...new Set(deck.slides.flatMap((s) => s.elements.filter((e) => e.type === 'image').map((e) => e.imageId)))];
