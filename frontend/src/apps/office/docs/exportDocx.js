import { imageBlob } from './images';
import { pageBox } from './fonts';

// Builds a .docx from the editor's JSON. Loaded only when someone exports.

const TWIPS_PER_MM = 1440 / 25.4;
const twips = (mm) => Math.round(mm * TWIPS_PER_MM);

// "#abc", "#aabbcc" or "rgb(1, 2, 3)" → "AABBCC".
function hex(color) {
  if (!color) return undefined;
  const c = color.trim();
  const rgb = c.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (rgb) return rgb.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase();
  const h = c.replace('#', '');
  if (h.length === 3 || h.length === 4) return h.slice(0, 3).split('').map((x) => x + x).join('').toUpperCase();
  return h.slice(0, 6).toUpperCase();
}

// The first family in a CSS stack: '"Times New Roman", serif' → 'Times New Roman'.
const firstFont = (stack) => stack?.split(',')[0].replace(/["']/g, '').trim();

async function imageData(imageId) {
  const blob = await imageBlob(imageId);
  const bmp = await createImageBitmap(blob);
  // Word files can't hold WebP, so it becomes PNG.
  if (blob.type === 'image/webp') {
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    canvas.getContext('2d').drawImage(bmp, 0, 0);
    const png = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    return { data: await png.arrayBuffer(), type: 'png', width: bmp.width, height: bmp.height };
  }
  const type = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif' }[blob.type] || 'png';
  return { data: await blob.arrayBuffer(), type, width: bmp.width, height: bmp.height };
}

export async function exportDocx({ content, settings, title }) {
  const d = await import('docx');
  const {
    Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, ExternalHyperlink, PageBreak, Table, TableRow,
    TableCell, WidthType, ImageRun, LevelFormat, BorderStyle, PageOrientation, ShadingType, LineRuleType,
  } = d;

  const ALIGN = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED };
  const HEADING = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3, 4: HeadingLevel.HEADING_4 };
  const box = pageBox(settings);
  const contentWidthPx = ((box.width - settings.margins.left - settings.margins.right) * 96) / 25.4;
  let numberedLists = 0;

  function runs(nodes = [], extra = {}) {
    const out = [];
    for (const n of nodes) {
      if (n.type === 'hardBreak') {
        out.push(new TextRun({ break: 1 }));
        continue;
      }
      if (n.type !== 'text') continue;
      const marks = Object.fromEntries((n.marks || []).map((m) => [m.type, m.attrs || {}]));
      const style = marks.textStyle || {};
      const fill = hex(marks.highlight?.color || (marks.highlight ? '#ffff00' : null) || style.backgroundColor);
      const run = new TextRun({
        text: n.text,
        bold: 'bold' in marks || extra.bold,
        italics: 'italic' in marks || extra.italics,
        underline: 'underline' in marks ? {} : undefined,
        strike: 'strike' in marks,
        superScript: 'superscript' in marks,
        subScript: 'subscript' in marks,
        color: hex(style.color),
        size: style.fontSize ? Math.round(parseFloat(style.fontSize) * 2) : undefined,
        font: firstFont(style.fontFamily),
        shading: fill ? { type: ShadingType.CLEAR, color: 'auto', fill } : undefined,
        style: marks.link ? 'Hyperlink' : undefined,
      });
      out.push(marks.link ? new ExternalHyperlink({ link: marks.link.href, children: [run] }) : run);
    }
    return out;
  }

  const lineSpacing = (nodes = []) => {
    const lh = nodes.map((n) => n.marks?.find((m) => m.type === 'textStyle')?.attrs?.lineHeight).find(Boolean);
    return lh ? { line: Math.round(parseFloat(lh) * 240), lineRule: LineRuleType.AUTO } : undefined;
  };

  async function blocks(nodes = [], ctx = {}) {
    const out = [];
    for (const n of nodes) out.push(...(await block(n, ctx)));
    return out;
  }

  async function block(n, ctx) {
    switch (n.type) {
      case 'paragraph':
      case 'heading':
        return [new Paragraph({
          children: runs(n.content, ctx.quote ? { italics: true } : {}),
          heading: n.type === 'heading' ? HEADING[n.attrs.level] : undefined,
          alignment: ALIGN[n.attrs?.textAlign],
          spacing: lineSpacing(n.content),
          ...(ctx.list || {}),
          ...(ctx.quote ? { indent: { left: 720 }, border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'BFBFBF', space: 8 } } } : {}),
        })];
      case 'blockquote':
        return blocks(n.content, { ...ctx, quote: true });
      case 'bulletList':
      case 'orderedList': {
        const level = ctx.level ?? 0;
        const instance = n.type === 'orderedList' ? (numberedLists += 1) : 0;
        const out = [];
        for (const item of n.content || []) {
          let first = true;
          for (const child of item.content || []) {
            if (child.type === 'bulletList' || child.type === 'orderedList') {
              out.push(...(await block(child, { ...ctx, level: level + 1, list: undefined })));
              continue;
            }
            // The item's first paragraph carries the bullet or number; later ones line up under it.
            const list = first
              ? n.type === 'bulletList' ? { bullet: { level } } : { numbering: { reference: 'kf-numbers', level, instance } }
              : { indent: { left: 720 * (level + 1) } };
            out.push(...(await block(child, { ...ctx, list })));
            first = false;
          }
        }
        return out;
      }
      case 'horizontalRule':
        return [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'auto', space: 1 } } })];
      case 'pageBreak':
        return [new Paragraph({ children: [new PageBreak()] })];
      case 'docImage': {
        try {
          const img = await imageData(n.attrs.imageId);
          const width = Math.min(n.attrs.width || img.width, contentWidthPx);
          const height = Math.round((width * img.height) / img.width);
          return [new Paragraph({
            alignment: ALIGN[n.attrs.align] ?? AlignmentType.CENTER,
            children: [new ImageRun({ type: img.type, data: img.data, transformation: { width: Math.round(width), height } })],
          })];
        } catch {
          return [new Paragraph({ children: [new TextRun({ text: '[image unavailable]', italics: true })] })];
        }
      }
      case 'table': {
        const rows = [];
        for (const row of n.content || []) {
          const cells = [];
          for (const cell of row.content || []) {
            const children = await blocks(cell.content, { ...ctx, list: undefined });
            cells.push(new TableCell({
              children: children.length ? children : [new Paragraph({})],
              columnSpan: cell.attrs?.colspan > 1 ? cell.attrs.colspan : undefined,
              rowSpan: cell.attrs?.rowspan > 1 ? cell.attrs.rowspan : undefined,
            }));
          }
          rows.push(new TableRow({ children: cells, tableHeader: row.content?.every((c) => c.type === 'tableHeader') }));
        }
        return [new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }), new Paragraph({})];
      }
      default:
        return [];
    }
  }

  const children = await blocks(content.content);
  const numberFormats = [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN];
  const doc = new Document({
    title: title || 'Untitled document',
    creator: 'Kanforge',
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 22 }, paragraph: { spacing: { after: 160, line: 276 } } },
      },
    },
    numbering: {
      config: [{
        reference: 'kf-numbers',
        levels: Array.from({ length: 9 }, (_, level) => ({
          level,
          format: numberFormats[level % 3],
          text: `%${level + 1}.`,
          alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
        })),
      }],
    },
    sections: [{
      properties: {
        page: {
          // Word expects portrait dimensions plus an orientation flag.
          size: {
            width: twips(Math.min(box.width, box.height)),
            height: twips(Math.max(box.width, box.height)),
            orientation: settings.orientation === 'landscape' ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
          },
          margin: {
            top: twips(settings.margins.top),
            right: twips(settings.margins.right),
            bottom: twips(settings.margins.bottom),
            left: twips(settings.margins.left),
          },
        },
      },
      children: children.length ? children : [new Paragraph({})],
    }],
  });
  return Packer.toBlob(doc);
}
