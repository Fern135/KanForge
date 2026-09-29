import { FONTS } from '../docs/fonts';

// A presentation, as saved (backend apps/office/slideContent.js checks it; change both together).
//   { size, theme, footer, active, slides: [{ id, background, background2, bgAngle, transition, hidden, notes, elements }] }
// Positions and sizes are in points on the slide: 960 × 540 for 16:9 and
// 720 × 540 for 4:3, which is also PowerPoint's slide size in points.

export const SIZES = { '16:9': { w: 960, h: 540, label: 'Widescreen (16:9)' }, '4:3': { w: 720, h: 540, label: 'Standard (4:3)' } };
export const LIMITS = {
  slides: 300, elements: 150, text: 5000, cell: 1000, notes: 10_000, tableRows: 20, tableCols: 10, chartLabels: 24, chartSeries: 6,
};

const font = (label) => FONTS.find((f) => f.label === label).value;

// Chart colours: the data-viz reference palette, in its validated order, with
// steps for light and for dark slide backgrounds.
const CHART_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'];
const CHART_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300'];

// Each theme: background (a second colour makes it a gradient), text colours,
// an accent for shapes and decoration, a font and a decoration.
export const THEMES = {
  light: { label: 'Office', bg: '#ffffff', text: '#262626', title: '#1f1f1f', accent: '#2b579a', font: font('Calibri'), deco: 'none', dark: false },
  dark: { label: 'Dark', bg: '#1f1f1f', text: '#f2f2f2', title: '#ffffff', accent: '#4ea8de', font: font('Calibri'), deco: 'none', dark: true },
  navy: { label: 'Navy', bg: '#0b2545', text: '#e8eef6', title: '#ffffff', accent: '#8ee3a6', font: font('Inter'), deco: 'bar', dark: true },
  forest: { label: 'Forest', bg: '#1f3d2b', text: '#eef5ec', title: '#ffffff', accent: '#a8d08d', font: font('Georgia'), deco: 'underline', dark: true },
  sunset: { label: 'Sunset', bg: '#fff4e6', text: '#4a2c1a', title: '#8a3b12', accent: '#c55a11', font: font('Trebuchet MS'), deco: 'band', dark: false },
  paper: { label: 'Paper', bg: '#f7f3e9', text: '#3a3a3a', title: '#2b2118', accent: '#8b5e34', font: font('Garamond'), deco: 'underline', dark: false },
  ocean: { label: 'Ocean', bg: '#0f4c81', bg2: '#1b9aaa', angle: 135, text: '#eaf6f8', title: '#ffffff', accent: '#ffd166', font: font('Trebuchet MS'), deco: 'corner', dark: true },
  aurora: { label: 'Aurora', bg: '#3a1c71', bg2: '#1f7a8c', angle: 135, text: '#f3eefc', title: '#ffffff', accent: '#ffaf7b', font: font('Inter'), deco: 'corner', dark: true },
  slate: { label: 'Slate', bg: '#2f3640', text: '#dcdde1', title: '#ffffff', accent: '#e1b12c', font: font('Tahoma'), deco: 'bar', dark: true },
  mint: { label: 'Mint', bg: '#f0fbf6', text: '#1d3b30', title: '#0f5132', accent: '#20c997', font: font('Verdana'), deco: 'band', dark: false },
  berry: { label: 'Berry', bg: '#5b1a4a', bg2: '#a4165a', angle: 160, text: '#fde8f1', title: '#ffffff', accent: '#ffc4d6', font: font('Georgia'), deco: 'underline', dark: true },
  sand: { label: 'Sand', bg: '#faf3e3', text: '#3e3322', title: '#6b4f1d', accent: '#d4a373', font: font('Cambria'), deco: 'bar', dark: false },
};

export const chartColors = (theme) => (theme.dark ? CHART_DARK : CHART_LIGHT);

// Shapes, in menu order, with PowerPoint's preset name for export.
export const SHAPES = [
  { id: 'rect', label: 'Rectangle', ppt: 'rect' },
  { id: 'roundRect', label: 'Rounded rectangle', ppt: 'roundRect' },
  { id: 'ellipse', label: 'Oval', ppt: 'ellipse' },
  { id: 'triangle', label: 'Triangle', ppt: 'triangle' },
  { id: 'rtTriangle', label: 'Right triangle', ppt: 'rtTriangle' },
  { id: 'diamond', label: 'Diamond', ppt: 'diamond' },
  { id: 'pentagon', label: 'Pentagon', ppt: 'pentagon' },
  { id: 'hexagon', label: 'Hexagon', ppt: 'hexagon' },
  { id: 'octagon', label: 'Octagon', ppt: 'octagon' },
  { id: 'star5', label: '5-point star', ppt: 'star5' },
  { id: 'star6', label: '6-point star', ppt: 'star6' },
  { id: 'chevron', label: 'Chevron', ppt: 'chevron' },
  { id: 'parallelogram', label: 'Parallelogram', ppt: 'parallelogram' },
  { id: 'trapezoid', label: 'Trapezoid', ppt: 'trapezoid' },
  { id: 'plus', label: 'Plus', ppt: 'plus' },
  { id: 'heart', label: 'Heart', ppt: 'heart' },
  { id: 'callout', label: 'Speech bubble', ppt: 'wedgeRoundRectCallout' },
  { id: 'arrow', label: 'Right arrow', ppt: 'rightArrow' },
  { id: 'leftRightArrow', label: 'Left-right arrow', ppt: 'leftRightArrow' },
  { id: 'downArrow', label: 'Down arrow', ppt: 'downArrow' },
  { id: 'line', label: 'Line', ppt: 'line' },
];

// A regular polygon or star, stretched to fill the box.
function fitted(points, w, h) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return `M${points.map(([x, y]) => `${((x - x0) / (x1 - x0)) * w} ${((y - y0) / (y1 - y0)) * h}`).join(' L')} Z`;
}
const ring = (n, inner = null) => Array.from({ length: inner ? n * 2 : n }, (_, i) => {
  const a = -Math.PI / 2 + (i * Math.PI * 2) / (inner ? n * 2 : n);
  const r = inner && i % 2 ? inner : 1;
  return [Math.cos(a) * r, Math.sin(a) * r];
});

// The outline of a shape as an SVG path in its own w × h box.
export function shapePath(shape, w, h) {
  const m = Math.min(w, h);
  switch (shape) {
    case 'roundRect': {
      const r = m * 0.15;
      return `M${r} 0 H${w - r} Q${w} 0 ${w} ${r} V${h - r} Q${w} ${h} ${w - r} ${h} H${r} Q0 ${h} 0 ${h - r} V${r} Q0 0 ${r} 0 Z`;
    }
    case 'ellipse':
      return `M0 ${h / 2} A${w / 2} ${h / 2} 0 1 0 ${w} ${h / 2} A${w / 2} ${h / 2} 0 1 0 0 ${h / 2} Z`;
    case 'triangle': return `M${w / 2} 0 L${w} ${h} L0 ${h} Z`;
    case 'rtTriangle': return `M0 0 L${w} ${h} L0 ${h} Z`;
    case 'diamond': return `M${w / 2} 0 L${w} ${h / 2} L${w / 2} ${h} L0 ${h / 2} Z`;
    case 'pentagon': return fitted(ring(5), w, h);
    case 'hexagon': return `M${w * 0.25} 0 H${w * 0.75} L${w} ${h / 2} L${w * 0.75} ${h} H${w * 0.25} L0 ${h / 2} Z`;
    case 'octagon': {
      const kx = w * 0.29;
      const ky = h * 0.29;
      return `M${kx} 0 H${w - kx} L${w} ${ky} V${h - ky} L${w - kx} ${h} H${kx} L0 ${h - ky} V${ky} Z`;
    }
    case 'star5': return fitted(ring(5, 0.382), w, h);
    case 'star6': return fitted(ring(6, 0.577), w, h);
    case 'chevron': {
      const d = Math.min(w * 0.3, h / 2);
      return `M0 0 H${w - d} L${w} ${h / 2} L${w - d} ${h} H0 L${d} ${h / 2} Z`;
    }
    case 'parallelogram': return `M${w * 0.25} 0 H${w} L${w * 0.75} ${h} H0 Z`;
    case 'trapezoid': return `M${w * 0.25} 0 H${w * 0.75} L${w} ${h} H0 Z`;
    case 'plus': {
      const [a, b, c, d] = [w * 0.33, w * 0.67, h * 0.33, h * 0.67];
      return `M${a} 0 H${b} V${c} H${w} V${d} H${b} V${h} H${a} V${d} H0 V${c} H${a} Z`;
    }
    case 'heart':
      return `M${w / 2} ${h * 0.28} C${w * 0.5} ${h * 0.02} ${w * 0.02} ${-h * 0.02} ${w * 0.02} ${h * 0.34} C${w * 0.02} ${h * 0.62} ${w * 0.42} ${h * 0.82} ${w / 2} ${h} C${w * 0.58} ${h * 0.82} ${w * 0.98} ${h * 0.62} ${w * 0.98} ${h * 0.34} C${w * 0.98} ${-h * 0.02} ${w * 0.5} ${h * 0.02} ${w / 2} ${h * 0.28} Z`;
    case 'callout': {
      const b = h * 0.78;
      const r = Math.min(w, b) * 0.12;
      return `M${r} 0 H${w - r} Q${w} 0 ${w} ${r} V${b - r} Q${w} ${b} ${w - r} ${b} H${w * 0.38} L${w * 0.16} ${h} L${w * 0.2} ${b} H${r} Q0 ${b} 0 ${b - r} V${r} Q0 0 ${r} 0 Z`;
    }
    case 'arrow': {
      const head = Math.min(w * 0.4, h);
      return `M0 ${h * 0.3} H${w - head} V0 L${w} ${h / 2} L${w - head} ${h} V${h * 0.7} H0 Z`;
    }
    case 'leftRightArrow': {
      const head = Math.min(w * 0.3, h);
      return `M0 ${h / 2} L${head} 0 V${h * 0.3} H${w - head} V0 L${w} ${h / 2} L${w - head} ${h} V${h * 0.7} H${head} V${h} Z`;
    }
    case 'downArrow': {
      const head = Math.min(h * 0.4, w);
      return `M${w * 0.3} 0 H${w * 0.7} V${h - head} H${w} L${w / 2} ${h} L0 ${h - head} H${w * 0.3} Z`;
    }
    default: return `M0 0 H${w} V${h} H0 Z`;
  }
}

export const ANIMATIONS = [
  { id: 'appear', label: 'Appear' },
  { id: 'fade', label: 'Fade' },
  { id: 'fly', label: 'Fly in' },
  { id: 'zoom', label: 'Zoom' },
  { id: 'wipe', label: 'Wipe' },
];
export const TRANSITIONS = [
  { id: 'none', label: 'None' },
  { id: 'fade', label: 'Fade' },
  { id: 'push', label: 'Push' },
  { id: 'wipe', label: 'Wipe' },
  { id: 'zoom', label: 'Zoom' },
  { id: 'cover', label: 'Cover' },
];
export const CHARTS = [
  { id: 'column', label: 'Column' },
  { id: 'bar', label: 'Bar' },
  { id: 'line', label: 'Line' },
  { id: 'area', label: 'Area' },
  { id: 'pie', label: 'Pie' },
  { id: 'donut', label: 'Donut' },
];
export const SPACINGS = [1, 1.15, 1.5, 2];

export const PLACEHOLDER = { title: 'Click to add title', subtitle: 'Click to add subtitle', body: 'Click to add text', picture: 'Click to add a picture' };

export const slideSize = (deck) => SIZES[deck.size] ?? SIZES['16:9'];
export const themeOf = (deck) => THEMES[deck.theme] ?? THEMES.light;

export const newId = (prefix) => `${prefix}${Math.random().toString(36).slice(2, 10)}`;

// A slide's background as CSS: its own colours, or the theme's.
export function backgroundCss(slide, theme) {
  const from = slide.background ?? theme.bg;
  const to = slide.background ? slide.background2 : slide.background2 ?? theme.bg2;
  const angle = slide.background ? slide.bgAngle ?? 135 : theme.angle ?? slide.bgAngle ?? 135;
  return to ? `linear-gradient(${angle}deg, ${from}, ${to})` : from;
}

const text = (ph, x, y, w, h, style) => ({ id: newId('e'), type: 'text', ph, x, y, w, h, text: '', style });

// New slides, like PowerPoint's layouts. Positions scale with the slide width.
export const LAYOUTS = [
  { id: 'title', label: 'Title slide' },
  { id: 'content', label: 'Title and content' },
  { id: 'two', label: 'Two content' },
  { id: 'comparison', label: 'Comparison' },
  { id: 'section', label: 'Section header' },
  { id: 'picture', label: 'Picture with caption' },
  { id: 'quote', label: 'Quote' },
  { id: 'bigNumber', label: 'Big number' },
  { id: 'titleOnly', label: 'Title only' },
  { id: 'blank', label: 'Blank' },
];

export function makeSlide(layout, size = '16:9') {
  const { w: W } = SIZES[size] ?? SIZES['16:9'];
  const m = W / 12;
  const full = W - 2 * m;
  const half = full / 2 - 15;
  const right = m + full / 2 + 15;
  const titleTop = () => text('title', m, 30, full, 90, { size: 36, b: true, valign: 'middle' });
  const elements = {
    title: [
      text('title', m, 160, full, 120, { size: 48, b: true, align: 'center', valign: 'bottom' }),
      text('subtitle', m, 300, full, 70, { size: 24, align: 'center', valign: 'top' }),
    ],
    content: [titleTop(), text('body', m, 140, full, 360, { size: 24, list: 'bullet' })],
    two: [
      titleTop(),
      text('body', m, 140, half, 360, { size: 22, list: 'bullet' }),
      text('body', right, 140, half, 360, { size: 22, list: 'bullet' }),
    ],
    comparison: [
      titleTop(),
      text('subtitle', m, 135, half, 50, { size: 24, b: true, valign: 'bottom' }),
      text('body', m, 195, half, 305, { size: 20, list: 'bullet' }),
      text('subtitle', right, 135, half, 50, { size: 24, b: true, valign: 'bottom' }),
      text('body', right, 195, half, 305, { size: 20, list: 'bullet' }),
    ],
    section: [
      text('title', m, 200, full, 110, { size: 44, b: true, valign: 'bottom' }),
      text('subtitle', m, 320, full, 60, { size: 22, valign: 'top' }),
    ],
    picture: [
      text('title', m, 60, full * 0.36, 110, { size: 32, b: true, valign: 'bottom' }),
      text('body', m, 185, full * 0.36, 300, { size: 18 }),
      text('picture', m + full * 0.42, 60, full * 0.58, 425, {}),
    ],
    quote: [
      text('body', m + 40, 130, full - 80, 220, { size: 40, i: true, align: 'center', valign: 'middle' }),
      text('subtitle', m + 40, 370, full - 80, 50, { size: 22, align: 'center' }),
    ],
    bigNumber: [
      text('title', m, 110, full, 200, { size: 120, b: true, align: 'center', valign: 'bottom' }),
      text('subtitle', m, 320, full, 80, { size: 28, align: 'center', valign: 'top' }),
    ],
    titleOnly: [titleTop()],
    blank: [],
  }[layout] ?? [];
  return { id: newId('s'), background: null, background2: null, bgAngle: 135, transition: 'none', notes: '', elements };
}

export function emptyDeck() {
  return { size: '16:9', theme: 'light', footer: { number: false, text: '', skipFirst: true }, active: 0, slides: [makeSlide('title')] };
}

// A new table or chart.
export function makeTable(rows = 3, cols = 3) {
  return {
    type: 'table', rows, cols, header: true, headerFill: null, fill: null, border: null, style: { size: 16 },
    cells: Array.from({ length: rows }, () => Array.from({ length: cols }, () => '')),
  };
}
export function makeChart(chart = 'column') {
  return {
    type: 'chart', chart, title: '', legend: true, style: {},
    labels: ['Q1', 'Q2', 'Q3', 'Q4'],
    series: [{ name: 'Sales', values: [42, 55, 61, 74] }, { name: 'Costs', values: [30, 34, 39, 41] }],
  };
}

// Content from the server → the editor's deck (the same shape, with defaults filled in).
export function fromContent(content) {
  const c = content && Array.isArray(content.slides) && content.slides.length ? content : emptyDeck();
  const slides = c.slides.map((s) => ({
    id: s.id,
    background: s.background ?? null,
    background2: s.background2 ?? null,
    bgAngle: s.bgAngle ?? 135,
    transition: s.transition ?? 'none',
    ...(s.hidden ? { hidden: true } : {}),
    notes: s.notes ?? '',
    elements: (s.elements ?? []).map((e) => ({ ...e, style: e.style ?? {} })),
  }));
  return {
    size: SIZES[c.size] ? c.size : '16:9',
    theme: THEMES[c.theme] ? c.theme : 'light',
    footer: { number: false, text: '', skipFirst: true, ...c.footer },
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
  const deco = [s.u && 'underline', s.s && 'line-through'].filter(Boolean).join(' ');
  return {
    fontFamily: s.font ?? theme.font,
    fontSize: `${s.size ?? 18}px`,
    color: s.color ?? (el.type === 'shape' ? '#ffffff' : el.ph === 'title' ? theme.title : theme.text),
    fontWeight: s.b ? 700 : 400,
    fontStyle: s.i ? 'italic' : 'normal',
    textDecoration: deco || 'none',
    textAlign: s.align ?? 'left',
    lineHeight: 1.2 * (s.spacing ?? 1),
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

// Items that move and select together: the element and the rest of its group.
export function groupIds(elements, ids) {
  const groups = new Set(elements.filter((e) => ids.has(e.id) && e.group).map((e) => e.group));
  return new Set(elements.filter((e) => ids.has(e.id) || (e.group && groups.has(e.group))).map((e) => e.id));
}

// Animated items in the order they appear.
export const animated = (slide) => slide.elements.filter((e) => e.anim).sort((a, b) => (a.animOrder ?? 0) - (b.animOrder ?? 0));

// Whether the slide shows the footer (slide number or text).
export const showsFooter = (deck, index) => (deck.footer?.number || deck.footer?.text) && !(deck.footer.skipFirst && index === 0);

// Every image the deck uses.
export const deckImageIds = (deck) => [...new Set(deck.slides.flatMap((s) => s.elements.filter((e) => e.type === 'image').map((e) => e.imageId)))];
