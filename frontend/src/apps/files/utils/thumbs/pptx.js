import { unzipSync } from 'fflate';
import { importPptx } from '../../../office/slides/importPptx';
import {
  THEMES, slideSize, shapePath, shapeColors,
} from '../../../office/slides/model';
import {
  THUMB_WIDTH, NoThumbnail, makeCanvas, canvasToThumb, wrapText, loadImage,
} from '../thumbnails';

// A PowerPoint file's preview: its first slide.
//
// PowerPoint saves a picture of the first slide inside every .pptx
// (docProps/thumbnail.jpeg), which is exactly what's wanted: it's used when
// present. Otherwise (files from other apps) the first slide is read with
// Office's own PowerPoint import, the same as opening it in Office, and drawn
// here: background, pictures, shapes, tables and text.

// The embedded picture is usually 256 px wide, plenty for a tile. One smaller
// than this is drawn from the slide instead.
const MIN_EMBEDDED_WIDTH = 200;

// The thumbnail PowerPoint stores in the file, as a Blob, or null if there isn't one.
function embeddedThumbnail(bytes) {
  let files;
  try {
    // Only the small picture is unpacked, never the whole file.
    files = unzipSync(bytes, { filter: (f) => /^docProps\/thumbnail\.(jpe?g|png)$/i.test(f.name) && f.originalSize < 2 * 1024 * 1024 });
  } catch {
    throw new NoThumbnail('This isn\'t a PowerPoint file that can be read');
  }
  const [name] = Object.keys(files);
  if (!name) return null;
  return new Blob([files[name]], { type: name.toLowerCase().endsWith('png') ? 'image/png' : 'image/jpeg' });
}

// Turns a picture's bytes into a data: URL the canvas can draw (pictures stay
// in the browser: nothing is uploaded).
const toDataUrl = (bytes, mime) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve({ src: reader.result });
  reader.onerror = () => reject(reader.error);
  reader.readAsDataURL(new Blob([bytes], { type: mime }));
});

// A CSS-like linear gradient across the slide, at `angle` degrees.
function gradient(ctx, w, h, angle, from, to) {
  const rad = ((angle - 90) * Math.PI) / 180;
  const len = Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad));
  const [cx, cy, dx, dy] = [w / 2, h / 2, (Math.cos(rad) * len) / 2, (Math.sin(rad) * len) / 2];
  const g = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
  g.addColorStop(0, from);
  g.addColorStop(1, to);
  return g;
}

// Draws text inside a box, with the element's size, weight, colour, alignment,
// vertical alignment and bullets. Coordinates are in slide points.
function drawText(ctx, el, theme) {
  const s = el.style ?? {};
  const size = s.size ?? 18;
  const lineHeight = size * 1.2 * (s.spacing ?? 1);
  const pad = 7;
  ctx.font = `${s.i ? 'italic ' : ''}${s.b ? '700' : '400'} ${size}px ${s.font ?? theme.font}`;
  ctx.fillStyle = s.color ?? (el.type === 'shape' ? '#ffffff' : el.ph === 'title' ? theme.title : theme.text);
  ctx.textBaseline = 'alphabetic';
  const bullet = s.list === 'number' ? (i) => `${i + 1}. ` : s.list ? () => '• ' : null;
  const lines = [];
  el.text.split('\n').forEach((para, i) => {
    const prefix = bullet && para ? bullet(i) : '';
    wrapText(ctx, prefix + para, el.w - pad * 2).forEach((l) => lines.push(l));
  });
  const total = lines.length * lineHeight;
  const valign = s.valign ?? (el.type === 'shape' ? 'middle' : 'top');
  let y = el.y + pad + (valign === 'middle' ? (el.h - pad * 2 - total) / 2 : valign === 'bottom' ? el.h - pad * 2 - total : 0);
  for (const line of lines) {
    const w = ctx.measureText(line).width;
    const x = s.align === 'center' ? el.x + (el.w - w) / 2 : s.align === 'right' ? el.x + el.w - pad - w : el.x + pad;
    ctx.fillText(line, x, y + size);
    y += lineHeight;
  }
}

async function drawElement(ctx, el, theme) {
  ctx.save();
  // Rotation and flips turn the element around its centre, as on the slide.
  if (el.rotation || el.flipH || el.flipV) {
    ctx.translate(el.x + el.w / 2, el.y + el.h / 2);
    if (el.rotation) ctx.rotate((el.rotation * Math.PI) / 180);
    ctx.scale(el.flipH ? -1 : 1, el.flipV ? -1 : 1);
    ctx.translate(-(el.x + el.w / 2), -(el.y + el.h / 2));
  }
  if (el.type === 'image' && el.src) {
    try {
      ctx.drawImage(await loadImage(el.src), el.x, el.y, el.w, el.h);
    } catch { /* a picture the browser can't draw is left out */ }
  } else if (el.type === 'shape') {
    const { fill, stroke, strokeWidth } = shapeColors(el, theme.accent);
    ctx.translate(el.x, el.y);
    if (el.shape === 'line') {
      ctx.beginPath();
      ctx.moveTo(0, el.h / 2);
      ctx.lineTo(el.w, el.h / 2);
    }
    const path = el.shape === 'line' ? null : new Path2D(shapePath(el.shape, el.w, el.h));
    if (path && fill !== 'none') {
      ctx.fillStyle = fill;
      ctx.fill(path);
    }
    if (stroke !== 'none' && strokeWidth) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = strokeWidth;
      if (path) ctx.stroke(path);
      else ctx.stroke();
    }
    ctx.translate(-el.x, -el.y);
    if (el.text && el.shape !== 'line') drawText(ctx, el, theme);
  } else if (el.type === 'table') {
    const rh = el.h / el.rows;
    const cw = el.w / el.cols;
    const size = el.style?.size ?? 16;
    el.cells.forEach((row, r) => row.forEach((cell, c) => {
      const [x, y] = [el.x + c * cw, el.y + r * rh];
      if (el.header && r === 0) {
        ctx.fillStyle = theme.accent;
        ctx.fillRect(x, y, cw, rh);
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.22)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, cw, rh);
      ctx.font = `${el.header && r === 0 ? '700' : '400'} ${size}px ${theme.font}`;
      ctx.fillStyle = el.header && r === 0 ? '#ffffff' : theme.text;
      ctx.fillText(String(cell).split('\n')[0], x + 6, y + Math.min(rh, size * 1.3));
    }));
  } else if (el.type === 'text' && el.text) {
    drawText(ctx, el, theme);
  }
  ctx.restore();
}

// Draws a slide from Office's slide model onto a THUMB_WIDTH-wide canvas.
async function drawSlide(deck) {
  const slide = deck.slides[0];
  const theme = THEMES[deck.theme] ?? THEMES.light;
  const { w, h } = slideSize(deck);
  const k = THUMB_WIDTH / w;
  const { canvas, ctx } = makeCanvas(THUMB_WIDTH, h * k, null);
  ctx.scale(k, k);
  const from = slide.background ?? theme.bg;
  const to = slide.background ? slide.background2 : theme.bg2;
  ctx.fillStyle = to ? gradient(ctx, w, h, slide.bgAngle ?? theme.angle ?? 135, from, to) : from;
  ctx.fillRect(0, 0, w, h);
  for (const el of slide.elements) await drawElement(ctx, el, theme);
  return canvas;
}

export async function pptxThumb(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const embedded = embeddedThumbnail(bytes);
  if (embedded) {
    const bmp = await createImageBitmap(embedded).catch(() => null);
    if (bmp && bmp.width >= MIN_EMBEDDED_WIDTH) {
      // Never enlarged: that would only blur it.
      const width = Math.min(bmp.width, THUMB_WIDTH);
      const { canvas, ctx } = makeCanvas(width, (bmp.height / bmp.width) * width, null);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      return canvasToThumb(canvas);
    }
  }
  let deck;
  try {
    deck = (await importPptx(new File([bytes], 'preview.pptx'), { maxSlides: 1, storePicture: toDataUrl })).content;
  } catch {
    throw new NoThumbnail('This isn\'t a PowerPoint file that can be read');
  }
  return canvasToThumb(await drawSlide(deck));
}
