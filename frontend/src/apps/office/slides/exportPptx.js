import { imageBlob } from '../docs/images';
import { iconShape } from './icons';
import {
  SHAPES, chartColors, shapeColors, showsFooter, slideSize, themeOf, textCss,
} from './model';

// A deck → a PowerPoint file (.pptx). Positions are in points; PowerPoint wants inches.
// Slide transitions and animations aren't written: the export library doesn't support them.
const inch = (pt) => pt / 72;
const hex = (color) => color.replace('#', '').toUpperCase();
// "Calibri, Carlito, sans-serif" → "Calibri"
const face = (stack) => stack.split(',')[0].replace(/"/g, '').trim();
const PPT_SHAPE = Object.fromEntries(SHAPES.map((s) => [s.id, s.ppt]));
const CHART_TYPES = { column: 'bar', bar: 'bar', line: 'line', area: 'area', pie: 'pie', donut: 'doughnut' };

const toDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(blob);
});

// Draws on a canvas and returns it as a PNG data URL.
function png(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'));
  return canvas.toDataURL('image/png');
}

function gradientPng(from, to, angle, W, H) {
  return png(W * 2, H * 2, (ctx) => {
    const a = ((angle - 90) * Math.PI) / 180;
    const [cx, cy, r] = [W, H, Math.hypot(W, H)];
    const g = ctx.createLinearGradient(cx - Math.cos(a) * r, cy - Math.sin(a) * r, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    g.addColorStop(0, from);
    g.addColorStop(1, to);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W * 2, H * 2);
  });
}

function iconPng(el, color) {
  const { width, height, path } = iconShape(el.icon);
  const size = 512;
  return png(size, size, (ctx) => {
    const k = Math.min(size / width, size / height);
    ctx.translate(size / 2, size / 2);
    ctx.scale(el.flipH ? -1 : 1, el.flipV ? -1 : 1);
    ctx.translate(-(width * k) / 2, -(height * k) / 2);
    ctx.scale(k, k);
    ctx.fillStyle = color;
    ctx.fill(new Path2D(path));
  });
}

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
    strike: s.s ? 'sngStrike' : undefined,
    highlight: s.highlight ? hex(s.highlight) : undefined,
    lineSpacingMultiple: s.spacing,
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
      ...(el.link ? { hyperlink: { url: el.link } } : {}),
      breakLine: i < lines.length - 1,
    },
  }));
}

// Options every kind of item shares.
function common(el) {
  return {
    x: inch(el.x),
    y: inch(el.y),
    w: inch(el.w),
    h: inch(el.h),
    ...(el.rotation ? { rotate: el.rotation } : {}),
    ...(el.flipH ? { flipH: true } : {}),
    ...(el.flipV ? { flipV: true } : {}),
    ...(el.shadow ? { shadow: { type: 'outer', angle: 60, blur: 6, offset: 4, color: '000000', opacity: 0.35 } } : {}),
    ...(el.link && el.type !== 'text' ? { hyperlink: { url: el.link } } : {}),
  };
}
const transparency = (el) => (el.opacity ? Math.round((1 - el.opacity) * 100) : 0);

function addDecoration(out, pptx, theme, W, H) {
  const fill = { color: hex(theme.accent) };
  const line = { type: 'none' };
  const add = (shape, x, y, w, h, extra = {}) => out.addShape(shape, { x: inch(x), y: inch(y), w: inch(w), h: inch(h), fill, line, ...extra });
  switch (theme.deco) {
    case 'bar': add(pptx.ShapeType.rect, 0, 0, 14, H); break;
    case 'band': add(pptx.ShapeType.rect, 0, H - 16, W, 16); break;
    case 'underline': add(pptx.ShapeType.roundRect, W / 12 + 7, 124, 110, 5, { rectRadius: 0.5 }); break;
    case 'corner':
      add(pptx.ShapeType.ellipse, W - 170, -170, 340, 340, { fill: { ...fill, transparency: 82 } });
      add(pptx.ShapeType.ellipse, W - 70, -70, 140, 140, { fill: { ...fill, transparency: 70 } });
      break;
    default:
  }
}

async function addElement(out, pptx, el, theme) {
  const box = common(el);
  switch (el.type) {
    case 'image':
      try {
        out.addImage({ data: await toDataUrl(await imageBlob(el.imageId)), ...box, transparency: transparency(el) || undefined, rounding: el.radius >= 50 });
      } catch {
        // An image that can't be loaded is left out rather than failing the download.
      }
      return;
    case 'icon':
      out.addImage({ data: iconPng(el, el.color ?? theme.accent), ...box, flipH: undefined, flipV: undefined, transparency: transparency(el) || undefined });
      return;
    case 'shape': {
      const { fill, stroke, strokeWidth } = shapeColors(el, theme.accent);
      const opts = {
        ...box,
        fill: fill === 'none' ? { color: 'FFFFFF', transparency: 100 } : { color: hex(fill), transparency: transparency(el) },
        line: stroke === 'none' ? { type: 'none' } : { color: hex(stroke), width: strokeWidth },
        ...(el.shape === 'roundRect' ? { rectRadius: 0.15 } : {}),
      };
      if (el.shape === 'line') out.addShape(pptx.ShapeType.line, { ...opts, y: inch(el.y + el.h / 2), h: 0 });
      else if (el.text) out.addText(runs(el), { ...opts, ...textOptions(el, theme), shape: pptx.ShapeType[PPT_SHAPE[el.shape]] });
      else out.addShape(pptx.ShapeType[PPT_SHAPE[el.shape]], opts);
      return;
    }
    case 'table': {
      const t = textOptions({ ...el, type: 'text' }, theme);
      const border = el.border === 'none' ? { type: 'none' } : { type: 'solid', pt: 1, color: hex(el.border ?? (theme.dark ? '#5a5a5a' : '#bfbfbf')) };
      const headerFill = el.headerFill === 'none' ? null : el.headerFill ?? theme.accent;
      const rows = el.cells.map((row, r) => row.map((text) => {
        const head = el.header && r === 0;
        const fill = head ? headerFill : el.fill && el.fill !== 'none' ? el.fill : null;
        return {
          text,
          options: {
            bold: head || t.bold,
            ...(fill ? { fill: { color: hex(fill) } } : {}),
            ...(head && headerFill && !el.style?.color ? { color: 'FFFFFF' } : {}),
          },
        };
      }));
      out.addTable(rows, {
        x: box.x, y: box.y, w: box.w, h: box.h,
        colW: Array.from({ length: el.cols }, () => box.w / el.cols),
        fontFace: t.fontFace, fontSize: t.fontSize, color: t.color, italic: t.italic, align: t.align, valign: 'middle', border,
      });
      return;
    }
    case 'chart': {
      const pie = el.chart === 'pie' || el.chart === 'donut';
      const colors = chartColors(theme).map(hex);
      const series = pie ? el.series.slice(0, 1) : el.series;
      const ink = hex(el.style?.color ?? theme.text);
      const fontFace = face(el.style?.font ?? theme.font);
      out.addChart(pptx.ChartType[CHART_TYPES[el.chart]], series.map((s) => ({ name: s.name, labels: el.labels, values: s.values })), {
        ...box,
        barDir: el.chart === 'bar' ? 'bar' : 'col',
        chartColors: colors,
        holeSize: el.chart === 'donut' ? 55 : undefined,
        showTitle: Boolean(el.title),
        title: el.title || undefined,
        titleColor: ink,
        titleFontFace: fontFace,
        showLegend: el.legend && (pie || series.length > 1),
        legendPos: 'b',
        legendColor: ink,
        legendFontFace: fontFace,
        showValue: !pie,
        showPercent: pie,
        dataLabelColor: pie ? 'FFFFFF' : ink,
        catAxisLabelColor: ink,
        valAxisLabelColor: ink,
        catAxisLabelFontFace: fontFace,
        valAxisLabelFontFace: fontFace,
        valGridLine: { color: theme.dark ? '555555' : 'D9D9D9', size: 0.75 },
        catGridLine: { style: 'none' },
      });
      return;
    }
    default:
      if (el.text && el.ph !== 'picture') out.addText(runs(el), { ...box, ...textOptions(el, theme) });
  }
}

export async function exportPptx(deck, title) {
  const { default: PptxGenJS } = await import('pptxgenjs');
  const pptx = new PptxGenJS();
  const { w: W, h: H } = slideSize(deck);
  const theme = themeOf(deck);
  pptx.defineLayout({ name: 'KANFORGE', width: inch(W), height: inch(H) });
  pptx.layout = 'KANFORGE';
  pptx.title = title || 'Untitled presentation';

  for (const [index, slide] of deck.slides.entries()) {
    const out = pptx.addSlide();
    const from = slide.background ?? theme.bg;
    const to = slide.background ? slide.background2 : slide.background2 ?? theme.bg2;
    const angle = slide.background ? slide.bgAngle ?? 135 : theme.angle ?? 135;
    out.background = to ? { data: gradientPng(from, to, angle, W, H) } : { color: hex(from) };
    if (slide.hidden) out.hidden = true;
    addDecoration(out, pptx, theme, W, H);
    for (const el of slide.elements) await addElement(out, pptx, el, theme);
    if (showsFooter(deck, index)) {
      const style = { fontFace: face(theme.font), fontSize: 12, color: hex(theme.text), transparency: 30 };
      if (deck.footer.text) out.addText(deck.footer.text, { x: inch(W / 12), y: inch(H - 40), w: inch(W / 2), h: inch(20), ...style });
      if (deck.footer.number) out.slideNumber = { x: inch(W - W / 12 - 80), y: inch(H - 40), w: inch(80), h: inch(20), ...style, align: 'right' };
    }
    if (slide.notes) out.addNotes(slide.notes);
  }
  return pptx.write({ outputType: 'blob' });
}
