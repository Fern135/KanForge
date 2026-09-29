import { FONTS } from '../docs/fonts';

// Cell formats → CSS. Sheets offers the same fonts as Docs, and the server
// accepts only those (backend apps/office/docContent.js).

export { FONTS };
export const DEFAULT_FONT_STACK = FONTS[0].value;
export const DEFAULT_SIZE = 11;
export const SIZES = [6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];
export const BORDER_COLOR = '#000000';

export function cellCss(style, z) {
  if (!style) return undefined;
  const css = {};
  if (style.font) css.fontFamily = style.font;
  if (style.size) css.fontSize = `${style.size * z}pt`;
  if (style.b) css.fontWeight = 700;
  if (style.i) css.fontStyle = 'italic';
  const deco = [style.u && 'underline', style.s && 'line-through'].filter(Boolean).join(' ');
  if (deco) css.textDecoration = deco;
  if (style.color) css.color = style.color;
  if (style.fill) css.background = style.fill;
  const shadows = [];
  if (style.bt) shadows.push(`inset 0 1px 0 ${BORDER_COLOR}`);
  if (style.bb) shadows.push(`inset 0 -1px 0 ${BORDER_COLOR}`);
  if (style.bl) shadows.push(`inset 1px 0 0 ${BORDER_COLOR}`);
  if (style.br) shadows.push(`inset -1px 0 0 ${BORDER_COLOR}`);
  if (shadows.length) css.boxShadow = shadows.join(', ');
  return css;
}

// Number format choices for the toolbar and Format menu.
export const NUMBER_FORMATS = [
  { id: 'general', label: 'General', sample: '1234.5' },
  { id: 'number', label: 'Number', sample: '1,234.50' },
  { id: 'currency', label: 'Currency', sample: '$1,234.50' },
  { id: 'percent', label: 'Percent', sample: '12.35%' },
  { id: 'scientific', label: 'Scientific', sample: '1.23E+03' },
  { id: 'date', label: 'Date', sample: '9/28/2026' },
  { id: 'time', label: 'Time', sample: '2:30 PM' },
  { id: 'datetime', label: 'Date and time', sample: '9/28/2026 2:30 PM' },
  { id: 'text', label: 'Plain text', sample: 'abc' },
];
