import { filesApi } from '../api';

// Preview images for the grid view, made here in the browser (the API only
// stores and serves them: backend files/thumbnails.js).
//
//   images       the picture itself, shrunk
//   PDFs         the first page (pdf.js)
//   Word         the first page, laid out from the document's text and pictures
//   PowerPoint   the first slide
//   Excel, CSV   the top-left corner of the sheet, as a grid
//   text         the start of the file, as a page of text
//
// A preview is made right after a file is uploaded, from the copy already in the
// browser. Files from before previews existed get one the first time someone who
// can edit them looks at the grid view (ensureThumbnails).

// Every preview is this many pixels wide. Tiles show it at about half that, so
// it stays sharp on high-density screens.
export const THUMB_WIDTH = 480;
// A Letter page's shape, for documents and text.
export const PAGE_HEIGHT = Math.round(THUMB_WIDTH * (11 / 8.5));

const MB = 1024 * 1024;
// The largest file each kind of preview is made from. Bigger files would take
// too long to download and open just for a picture of their first page.
const MAX_SOURCE = {
  image: 40 * MB, pdf: 60 * MB, docx: 40 * MB, pptx: 60 * MB, text: Infinity,
  // What Office's spreadsheet import accepts (25 MB for Excel, 20 MB for CSV).
  xlsx: 25 * MB, csv: 20 * MB,
};
// Only the start of a text file is ever read.
const TEXT_BYTES = 64 * 1024;

const ext = (name) => (name.includes('.') ? name.split('.').pop().toLowerCase() : '');
const TEXT_EXT = new Set(['txt', 'md', 'markdown', 'log', 'json', 'xml', 'yaml', 'yml', 'ini', 'js', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'cs', 'php', 'sh', 'css', 'scss', 'html', 'sql']);
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp']);

// Which kind of preview a file can have, or null for none.
export function thumbKind(item) {
  if (item.kind !== 'file' || !item.size) return null;
  const mime = item.mime || '';
  const e = ext(item.name);
  let kind = null;
  if (IMAGE_TYPES.has(mime)) kind = 'image';
  else if (mime === 'application/pdf' || e === 'pdf') kind = 'pdf';
  else if (e === 'docx') kind = 'docx';
  else if (e === 'pptx') kind = 'pptx';
  // CSV and TSV are checked before plain text: they look better as a grid.
  else if (e === 'xlsx') kind = 'xlsx';
  else if (e === 'csv' || e === 'tsv') kind = 'csv';
  else if (mime.startsWith('text/') || TEXT_EXT.has(e)) kind = 'text';
  return kind && item.size <= MAX_SOURCE[kind] ? kind : null;
}

// Thrown when a file can't have a preview (damaged, password protected, an
// image format the browser can't read). The API is told, so nobody tries again.
export class NoThumbnail extends Error {}

// ---------- Drawing helpers, shared by every kind ----------

export function makeCanvas(width, height, background = '#ffffff') {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d');
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  return { canvas, ctx };
}

const toBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

// The canvas as a compact image: WebP, or JPEG in browsers that can't make WebP
// (they hand back a PNG instead, which can be large for photos). JPEG has no
// transparency, so it's drawn over white first.
export async function canvasToThumb(canvas) {
  const webp = await toBlob(canvas, 'image/webp', 0.8);
  if (webp?.type === 'image/webp') return webp;
  const { canvas: flat, ctx } = makeCanvas(canvas.width, canvas.height, '#ffffff');
  ctx.drawImage(canvas, 0, 0);
  const jpeg = await toBlob(flat, 'image/jpeg', 0.82);
  if (!jpeg) throw new Error('Could not make the preview image');
  return jpeg;
}

// Splits text into lines that fit `maxWidth` with the context's current font.
// Words longer than a line are broken wherever they have to be.
export function wrapText(ctx, text, maxWidth) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      const next = line + word;
      if (!line || ctx.measureText(next).width <= maxWidth) {
        line = next;
        continue;
      }
      lines.push(line.trimEnd());
      line = word.trimStart();
      while (line && ctx.measureText(line).width > maxWidth) {
        let cut = line.length - 1;
        while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > maxWidth) cut -= 1;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

// Loads an image from a URL the page may use (data: or same-site), for drawImage.
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load an image'));
    img.src = src;
  });
}

// ---------- Each kind ----------

// The picture, shrunk so its longer side is THUMB_WIDTH (smaller ones keep their size).
async function imageThumb(blob) {
  let bmp;
  try {
    bmp = await createImageBitmap(blob);
  } catch {
    throw new NoThumbnail('This image format can\'t be shown');
  }
  const scale = Math.min(1, THUMB_WIDTH / Math.max(bmp.width, bmp.height));
  const { canvas, ctx } = makeCanvas(bmp.width * scale, bmp.height * scale, null);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  return canvasToThumb(canvas);
}

// The start of a text file, as a page in a monospace font.
async function textThumb(blob) {
  const text = (await blob.slice(0, TEXT_BYTES).text()).replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
  const { canvas, ctx } = makeCanvas(THUMB_WIDTH, PAGE_HEIGHT);
  const pad = 28;
  const size = 11;
  const lineHeight = size * 1.45;
  ctx.font = `${size}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
  ctx.fillStyle = '#2b2f36';
  ctx.textBaseline = 'top';
  const maxLines = Math.floor((PAGE_HEIGHT - pad * 2) / lineHeight);
  const lines = wrapText(ctx, text.slice(0, 8000), THUMB_WIDTH - pad * 2).slice(0, maxLines);
  lines.forEach((line, i) => ctx.fillText(line, pad, pad + i * lineHeight));
  return canvasToThumb(canvas);
}

// Makes the preview for `file` (a File or Blob of the whole file; for text, the
// start is enough). `item` gives its name and type. Returns the image Blob.
export async function makeThumbnail(file, item) {
  const kind = thumbKind(item);
  if (kind === 'image') return imageThumb(file);
  if (kind === 'text') return textThumb(file);
  // The heavier ones load their code only when needed.
  if (kind === 'pdf') return (await import('./thumbs/pdf')).pdfThumb(file);
  if (kind === 'docx') return (await import('./thumbs/docx')).docxThumb(file);
  if (kind === 'pptx') return (await import('./thumbs/pptx')).pptxThumb(file);
  if (kind === 'xlsx' || kind === 'csv') return (await import('./thumbs/sheet')).sheetThumb(file, item.name);
  throw new NoThumbnail('No preview for this kind of file');
}

// ---------- Making and storing them ----------

// Makes and stores the preview for one file, given its contents. Returns the
// updated item (with thumbUrl), or null when it can't have one.
export async function createThumbnail(file, item) {
  let image;
  try {
    image = await makeThumbnail(file, item);
  } catch (err) {
    if (err instanceof NoThumbnail || err?.name === 'InvalidPDFException' || err?.name === 'PasswordException') {
      await filesApi.noThumbnail(item.id).catch(() => {});
      return null;
    }
    throw err;
  }
  return (await filesApi.setThumbnail(item.id, image)).item;
}

// Pages showing files listen here, to swap in each preview as it's ready.
const listeners = new Set();
export const onThumbnail = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const announce = (item) => item && listeners.forEach((fn) => fn(item));

// Files already tried during this visit, so a failure isn't retried on every render.
const tried = new Set();
const queue = [];
let running = 0;
// Two at a time: each downloads a file and draws it, which is work for the browser.
const AT_ONCE = 2;

// Downloads a file (only the start, for text) and makes its preview.
async function backfill(item) {
  const url = await filesApi.downloadUrl(item.id, false);
  const res = await fetch(url, thumbKind(item) === 'text' ? { headers: { Range: `bytes=0-${TEXT_BYTES - 1}` } } : undefined);
  if (!res.ok) throw new Error('Could not download the file');
  return createThumbnail(await res.blob(), item);
}

function pump() {
  while (running < AT_ONCE && queue.length) {
    const item = queue.shift();
    running += 1;
    backfill(item)
      .then(announce)
      // Network trouble: left for another visit.
      .catch(() => {})
      .finally(() => {
        running -= 1;
        pump();
      });
  }
}

// Queues previews for listed files that could have one but don't yet.
// canEdit(item): only people who can edit a file may store its preview.
// Each one is announced to onThumbnail listeners as it's ready.
export function ensureThumbnails(items, canEdit) {
  for (const item of items) {
    if (item.thumb || tried.has(item.id) || !thumbKind(item) || !canEdit(item)) continue;
    tried.add(item.id);
    queue.push(item);
  }
  pump();
}

// Right after an upload: the preview is made from the file still in the browser.
// Failures are quiet; the grid view can try again later.
export function thumbnailAfterUpload(file, item) {
  if (!item || item.thumb || !thumbKind(item)) return;
  tried.add(item.id);
  createThumbnail(file, item).then(announce).catch(() => tried.delete(item.id));
}

