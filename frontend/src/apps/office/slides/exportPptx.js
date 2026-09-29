import { imageBlob } from '../docs/images';
import {
  shapeColors, slideSize, themeOf, textCss,
} from './model';

// A deck → a PowerPoint file (.pptx). Positions are in points; PowerPoint wants inches.
const inch = (pt) => pt / 72;
const hex = (color) => color.replace('#', '').toUpperCase();
// "Calibri, Carlito, sans-serif" → "Calibri"
const face = (stack) => stack.split(',')[0].replace(/"/g, '').trim();

const SHAPE_TYPES = { rect: 'rect', roundRect: 'roundRect', ellipse: 'ellipse', triangle: 'triangle', arrow: 'rightArrow', line: 'line' };

const toDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

function textOptions(el, theme) {
  const css = textCss(el, theme);
  const s = el.style ?? {};
  return {
    fontFace: face(css.fontFamily),
    fontSize: s.size ?? 18,
    color: hex(css.color),
    bold: Boolean(s.b),
    italic: Boolean(s.i),
    underline: s.u ? { style: 'sng' } : undefined,
    align: s.align ?? 'left',
    valign: s.valign ?? (el.type === 'shape' ? 'middle' : 'top'),
  };
}

// Lines of text, as bullets or numbers when the box is a list.
function runs(el) {
  const lines = el.text.split('\n');
  const list = el.style?.list;
  return lines.map((line, i) => ({
    text: line,
    options: {
      ...(list ? { bullet: list === 'number' ? { type: 'number' } : true } : {}),
      breakLine: i < lines.length - 1,
    },
  }));
}

export async function exportPptx(deck, title) {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pptx = new PptxGenJS();
  const { w: W, h: H } = slideSize(deck);
  const theme = themeOf(deck);
  pptx.defineLayout({ name: 'KANFORGE', width: inch(W), height: inch(H) });
  pptx.layout = 'KANFORGE';
  pptx.title = title || 'Untitled presentation';

  for (const slide of deck.slides) {
    const out = pptx.addSlide();
    out.background = { color: hex(slide.background ?? theme.bg) };
    for (const el of slide.elements) {
      const box = { x: inch(el.x), y: inch(el.y), w: inch(el.w), h: inch(el.h) };
      if (el.type === 'image') {
        try {
          out.addImage({ data: await toDataUrl(await imageBlob(el.imageId)), ...box });
        } catch {
          // An image that can't be loaded is left out rather than failing the download.
        }
      } else if (el.type === 'shape') {
        const { fill, stroke, strokeWidth } = shapeColors(el, theme.accent);
        const shapeOpts = {
          ...box,
          fill: fill === 'none' ? { color: 'FFFFFF', transparency: 100 } : { color: hex(fill) },
          line: stroke === 'none' ? { type: 'none' } : { color: hex(stroke), width: strokeWidth },
          ...(el.shape === 'roundRect' ? { rectRadius: 0.15 } : {}),
        };
        if (el.shape === 'line') {
          out.addShape(pptx.ShapeType.line, { ...shapeOpts, y: inch(el.y + el.h / 2), h: 0 });
        } else if (el.text) {
          out.addText(runs(el), { ...shapeOpts, ...textOptions(el, theme), shape: pptx.ShapeType[SHAPE_TYPES[el.shape]] });
        } else {
          out.addShape(pptx.ShapeType[SHAPE_TYPES[el.shape]], shapeOpts);
        }
      } else if (el.text) {
        out.addText(runs(el), { ...box, ...textOptions(el, theme) });
      }
    }
    if (slide.notes) out.addNotes(slide.notes);
  }
  return pptx.write({ outputType: 'blob' });
}
