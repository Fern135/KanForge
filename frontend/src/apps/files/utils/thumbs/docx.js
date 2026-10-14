import {
  THUMB_WIDTH, PAGE_HEIGHT, NoThumbnail, makeCanvas, canvasToThumb, loadImage,
} from '../thumbnails';

// A Word document's preview: its first page. mammoth (the library Office's Word
// import uses) turns the .docx into plain HTML: headings, paragraphs with
// bold/italic/underline and links, lists, tables, quotes and pictures. That
// HTML is read inert with DOMParser (nothing in it runs or loads) and laid out
// here on a page-shaped canvas. Exact fonts, columns and spacing aren't kept,
// but the page reads the same at thumbnail size.

// A Letter page at THUMB_WIDTH: 1 inch is this many pixels.
const INCH = THUMB_WIDTH / 8.5;
const MARGIN = Math.round(INCH * 0.85);
const WIDTH = THUMB_WIDTH - MARGIN * 2;
const BOTTOM = PAGE_HEIGHT - MARGIN;
// 11pt body text, Word's default, at this scale.
const BODY = (11 / 72) * INCH;
const HEADINGS = { H1: 2, H2: 1.6, H3: 1.35, H4: 1.15, H5: 1.05, H6: 1 };
const FONT = 'Calibri, Carlito, "Segoe UI", Arial, sans-serif';
const INK = '#1f1f1f';
const LINK = '#0563c1';

// Thrown to stop laying out once the page is full.
class PageFull extends Error {}

// The text of an element as runs of one style each: [{ text, b, i, u, color }],
// with "\n" for line breaks.
function runsOf(node, style = {}, out = []) {
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      if (child.textContent) out.push({ text: child.textContent.replace(/\s+/g, ' '), ...style });
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const tag = child.tagName;
      if (tag === 'BR') out.push({ text: '\n', ...style });
      else if (tag === 'IMG') continue;
      else {
        runsOf(child, {
          ...style,
          ...((tag === 'STRONG' || tag === 'B') && { b: true }),
          ...((tag === 'EM' || tag === 'I') && { i: true }),
          ...(tag === 'U' && { u: true }),
          ...(tag === 'A' && { color: LINK, u: true }),
        }, out);
      }
    }
  }
  return out;
}

function createLayout(ctx) {
  let y = MARGIN;

  const font = (run, size) => `${run.i ? 'italic ' : ''}${run.b ? '700' : '400'} ${size}px ${FONT}`;

  // Lays out runs from `x` to the right margin, wrapping by word. Returns once
  // the text is placed; throws PageFull when it reaches the bottom.
  function text(runs, { x = MARGIN, size = BODY, color = INK, align = 'left', after = size * 0.6 } = {}) {
    const lineHeight = size * 1.3;
    const width = MARGIN + WIDTH - x;
    // Words with their style, split so wrapping can happen between any two.
    const words = runs.flatMap((r) => r.text.split(/(\s+|\n)/).filter(Boolean).map((w) => ({ ...r, text: w })));
    let line = [];
    let lineWidth = 0;
    const flush = () => {
      if (y + lineHeight > BOTTOM) throw new PageFull();
      // Trailing spaces don't count towards centring or right-aligning.
      while (line.length && !line[line.length - 1].text.trim()) lineWidth -= line.pop().w;
      let cx = x + (align === 'center' ? (width - lineWidth) / 2 : align === 'right' ? width - lineWidth : 0);
      for (const w of line) {
        ctx.font = font(w, size);
        ctx.fillStyle = w.color ?? color;
        ctx.fillText(w.text, cx, y + size);
        if (w.u && w.text.trim()) ctx.fillRect(cx, y + size + 1.5, w.w, Math.max(0.6, size / 14));
        cx += w.w;
      }
      y += lineHeight;
      line = [];
      lineWidth = 0;
    };
    for (const word of words) {
      if (word.text === '\n') {
        flush();
        continue;
      }
      ctx.font = font(word, size);
      const w = ctx.measureText(word.text).width;
      if (lineWidth + w > width && line.length && word.text.trim()) flush();
      if (!line.length && !word.text.trim()) continue;
      line.push({ ...word, w });
      lineWidth += w;
    }
    if (line.length) flush();
    y += after;
  }

  async function image(img, x = MARGIN) {
    let el;
    try {
      el = await loadImage(img.getAttribute('src'));
    } catch {
      return;
    }
    // Pictures come without their size in the document: drawn at a typical
    // on-page size, never wider than the text.
    const w = Math.min(MARGIN + WIDTH - x, el.naturalWidth * 0.45);
    const h = (w / el.naturalWidth) * el.naturalHeight;
    if (y + Math.min(h, 20) > BOTTOM) throw new PageFull();
    ctx.drawImage(el, x, y, w, h);
    y += h + BODY * 0.6;
  }

  function table(tableEl) {
    const rows = [...tableEl.querySelectorAll('tr')];
    const size = BODY * 0.9;
    const lineHeight = size * 1.3;
    for (const [r, tr] of rows.entries()) {
      const cells = [...tr.children];
      if (!cells.length) continue;
      const cw = WIDTH / cells.length;
      const h = lineHeight + 6;
      if (y + h > BOTTOM) throw new PageFull();
      cells.forEach((cell, c) => {
        const x = MARGIN + c * cw;
        ctx.strokeStyle = '#9a9a9a';
        ctx.lineWidth = 0.6;
        ctx.strokeRect(x, y, cw, h);
        ctx.font = `${r === 0 || cell.tagName === 'TH' ? '700' : '400'} ${size}px ${FONT}`;
        ctx.fillStyle = INK;
        // One line per cell, cut to fit.
        let t = cell.textContent.replace(/\s+/g, ' ').trim();
        while (t && ctx.measureText(t).width > cw - 6) t = t.slice(0, -1);
        ctx.fillText(t, x + 3, y + 3 + size);
      });
      y += h;
    }
    y += BODY * 0.6;
  }

  // Lays out one block element and what's inside it.
  async function block(el, indent = 0) {
    const x = MARGIN + indent;
    const tag = el.tagName;
    if (HEADINGS[tag]) {
      const size = BODY * HEADINGS[tag];
      y += size * 0.3;
      text(runsOf(el, { b: true }), { x, size, color: tag === 'H1' ? '#1f3864' : '#2f5496', after: size * 0.35 });
    } else if (tag === 'P') {
      for (const img of el.querySelectorAll('img')) await image(img, x);
      const runs = runsOf(el);
      if (runs.some((r) => r.text.trim())) text(runs, { x });
      else if (!el.querySelector('img')) y += BODY * 0.9;
    } else if (tag === 'UL' || tag === 'OL') {
      let n = 1;
      for (const li of el.children) {
        if (li.tagName !== 'LI') continue;
        ctx.font = `400 ${BODY}px ${FONT}`;
        ctx.fillStyle = INK;
        if (y + BODY * 1.3 > BOTTOM) throw new PageFull();
        ctx.fillText(tag === 'OL' ? `${n}.` : '•', x + 2, y + BODY);
        n += 1;
        // The item's own text, then any list nested inside it.
        const own = li.cloneNode(true);
        own.querySelectorAll('ul, ol').forEach((sub) => sub.remove());
        text(runsOf(own), { x: x + BODY * 1.6, after: BODY * 0.25 });
        for (const sub of li.querySelectorAll(':scope > ul, :scope > ol')) await block(sub, indent + BODY * 1.6);
      }
      y += BODY * 0.35;
    } else if (tag === 'TABLE') {
      table(el);
    } else if (tag === 'BLOCKQUOTE') {
      for (const child of el.children) await block(child, indent + BODY * 2);
    } else if (el.children.length) {
      for (const child of el.children) await block(child, indent);
    }
  }

  return { block };
}

export async function docxThumb(file) {
  const mammoth = await import('mammoth');
  const convert = mammoth.default?.convertToHtml ?? mammoth.convertToHtml;
  let html;
  try {
    // Pictures come back inline as data: URLs, which is what drawing them needs.
    ({ value: html } = await convert({ arrayBuffer: await file.arrayBuffer() }));
  } catch {
    throw new NoThumbnail('This isn\'t a Word document that can be read');
  }
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  const { canvas, ctx } = makeCanvas(THUMB_WIDTH, PAGE_HEIGHT);
  const layout = createLayout(ctx);
  try {
    for (const el of doc.body.children) await layout.block(el);
  } catch (err) {
    if (!(err instanceof PageFull)) throw err;
  }
  return canvasToThumb(canvas);
}
