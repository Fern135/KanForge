import { unzipSync, strFromU8 } from 'fflate';
import { uploadBase64 } from '../docs/images';
import { FONTS } from '../docs/fonts';
import {
  SHAPES, LIMITS, newId, makeSlide,
} from './model';

// A PowerPoint file (.pptx) → a presentation. Keeps slide sizes, text (with its
// font, size, colour, bold/italic/underline, alignment and bullets), shapes,
// pictures, tables, groups, backgrounds and speaker notes. Charts, SmartArt,
// video and animations aren't brought across; the result lists what was skipped.

const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const EMU_PER_PT = 12700;
const FROM_PPT = Object.fromEntries(SHAPES.map((s) => [s.ppt, s.id]));
Object.assign(FROM_PPT, { homePlate: 'chevron', wedgeRectCallout: 'callout', wedgeEllipseCallout: 'callout', star4: 'star5', star7: 'star6', star8: 'star6', flowChartProcess: 'rect', flowChartAlternateProcess: 'roundRect', round2SameRect: 'roundRect', snip1Rect: 'rect', upArrow: 'downArrow', leftArrow: 'arrow' });
const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

// A crafted file can claim to unpack to gigabytes (a "zip bomb"), so each part's
// unpacked size is checked before it's unpacked. Only the XML and the pictures
// Kanforge can use are unpacked at all; pictures over the 5 MB upload limit are skipped.
const MAX_FILE = 100 * 1024 * 1024;
const MAX_XML_PART = 50 * 1024 * 1024;
const MAX_IMAGE = 5 * 1024 * 1024;
const MAX_TOTAL = 500 * 1024 * 1024;

const kids = (node, ns, name) => (node ? [...node.children].filter((c) => c.namespaceURI === ns && c.localName === name) : []);
const kid = (node, ns, name) => kids(node, ns, name)[0] ?? null;
const deep = (node, ns, name) => (node ? node.getElementsByTagNameNS(ns, name)[0] ?? null : null);
const num = (v) => (v == null ? null : Number(v));

function parse(files, path) {
  const bytes = files[path];
  return bytes ? new DOMParser().parseFromString(strFromU8(bytes), 'application/xml') : null;
}

// Relationship id → target path, resolved against the part's folder.
function rels(files, partPath) {
  const dir = partPath.slice(0, partPath.lastIndexOf('/'));
  const relPath = `${dir}/_rels/${partPath.slice(dir.length + 1)}.rels`;
  const xml = parse(files, relPath);
  const map = new Map();
  if (!xml) return map;
  for (const rel of xml.getElementsByTagName('Relationship')) {
    const target = rel.getAttribute('Target');
    const parts = (target.startsWith('/') ? target.slice(1) : `${dir}/${target}`).split('/');
    const out = [];
    for (const p of parts) {
      if (p === '..') out.pop();
      else if (p !== '.') out.push(p);
    }
    map.set(rel.getAttribute('Id'), { path: out.join('/'), type: rel.getAttribute('Type') });
  }
  return map;
}

const color = (node) => {
  const v = deep(kid(node, A, 'solidFill'), A, 'srgbClr')?.getAttribute('val');
  return v && /^[0-9a-f]{6}$/i.test(v) ? `#${v.toLowerCase()}` : null;
};

function fontFor(typeface) {
  if (!typeface) return undefined;
  const t = typeface.toLowerCase();
  return FONTS.find((f) => f.label.toLowerCase() === t)?.value;
}

// A shape's position: its own, or its placeholder's on the layout, then the master.
function xfrmOf(node) {
  const x = deep(kid(node, P, 'spPr') ?? kid(node, P, 'grpSpPr') ?? node, A, 'xfrm') ?? deep(node, P, 'xfrm');
  const off = kid(x, A, 'off');
  const ext = kid(x, A, 'ext');
  if (!off || !ext) return null;
  return {
    x: num(off.getAttribute('x')), y: num(off.getAttribute('y')),
    w: num(ext.getAttribute('cx')), h: num(ext.getAttribute('cy')),
    rot: num(x.getAttribute('rot')) / 60000 || 0,
    flipH: x.getAttribute('flipH') === '1', flipV: x.getAttribute('flipV') === '1',
    chOff: kid(x, A, 'chOff'), chExt: kid(x, A, 'chExt'),
  };
}

const placeholderOf = (node) => deep(node, P, 'ph');

function findPlaceholder(xml, ph) {
  if (!xml || !ph) return null;
  const type = ph.getAttribute('type') || 'body';
  const idx = ph.getAttribute('idx');
  const shapes = [...xml.getElementsByTagNameNS(P, 'sp')];
  const match = (s) => {
    const p = placeholderOf(s);
    if (!p) return false;
    const t = p.getAttribute('type') || 'body';
    return (idx && p.getAttribute('idx') === idx) || t === type || (type === 'ctrTitle' && t === 'title') || (type === 'subTitle' && t === 'body');
  };
  return shapes.find(match) ?? null;
}

function readText(txBody, k, fallbackSize) {
  const paras = kids(txBody, A, 'p');
  const lines = [];
  let style = null;
  let list = null;
  let align = null;
  for (const p of paras) {
    let line = '';
    for (const node of p.children) {
      if (node.localName === 'r' || node.localName === 'fld') {
        line += deep(node, A, 't')?.textContent ?? '';
        const rPr = kid(node, A, 'rPr');
        if (!style && rPr) {
          style = {
            size: num(rPr.getAttribute('sz')) ? Math.round((num(rPr.getAttribute('sz')) / 100) * k * 2) / 2 : undefined,
            b: rPr.getAttribute('b') === '1' || undefined,
            i: rPr.getAttribute('i') === '1' || undefined,
            u: (rPr.getAttribute('u') && rPr.getAttribute('u') !== 'none') || undefined,
            s: (rPr.getAttribute('strike') && rPr.getAttribute('strike') !== 'noStrike') || undefined,
            color: color(rPr) ?? undefined,
            font: fontFor(kid(rPr, A, 'latin')?.getAttribute('typeface')),
          };
        }
      } else if (node.localName === 'br') line += '\n';
    }
    const pPr = kid(p, A, 'pPr');
    if (pPr) {
      if (!align) align = { l: 'left', ctr: 'center', r: 'right', just: 'justify' }[pPr.getAttribute('algn')] ?? null;
      if (!list && line && kid(pPr, A, 'buChar')) list = 'bullet';
      if (!list && line && kid(pPr, A, 'buAutoNum')) list = 'number';
    }
    lines.push(line);
  }
  while (lines.length && !lines[lines.length - 1]) lines.pop();
  const anchor = kid(txBody, A, 'bodyPr')?.getAttribute('anchor');
  const out = {};
  for (const [key, v] of Object.entries(style ?? {})) if (v !== undefined) out[key] = v;
  if (!out.size && fallbackSize) out.size = fallbackSize;
  if (out.size) out.size = Math.min(200, Math.max(6, out.size));
  if (align && align !== 'left') out.align = align;
  if (list) out.list = list;
  const valign = { ctr: 'middle', b: 'bottom' }[anchor];
  if (valign) out.valign = valign;
  return { text: lines.join('\n').slice(0, LIMITS.text), style: out };
}

function unzipPptx(bytes) {
  const tooBig = new Set();
  let total = 0;
  const files = unzipSync(bytes, {
    filter: (f) => {
      const ext = f.name.split('.').pop().toLowerCase();
      const limit = ext === 'xml' || ext === 'rels' ? MAX_XML_PART : IMAGE_TYPES[ext] ? MAX_IMAGE : 0;
      if (!limit) return false;
      if (f.originalSize > limit || total + f.originalSize > MAX_TOTAL) {
        tooBig.add(f.name);
        return false;
      }
      total += f.originalSize;
      return true;
    },
  });
  return { files, tooBig };
}

export async function importPptx(file) {
  if (file.size > MAX_FILE) throw new Error('PowerPoint files can be up to 100 MB.');
  let unzipped;
  try {
    unzipped = unzipPptx(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new Error('That isn\'t a PowerPoint (.pptx) file.');
  }
  const { files, tooBig } = unzipped;
  // A slide or other part too big to unpack safely: the file can't be opened.
  if ([...tooBig].some((name) => /\.(xml|rels)$/i.test(name))) throw new Error('This PowerPoint file is too large to open.');
  const presPath = 'ppt/presentation.xml';
  const pres = parse(files, presPath);
  if (!pres) throw new Error('That isn\'t a PowerPoint (.pptx) file.');
  const warnings = new Set();

  const sz = deep(pres, P, 'sldSz');
  const cx = num(sz?.getAttribute('cx')) || 12192000;
  const cy = num(sz?.getAttribute('cy')) || 6858000;
  const size = cx / cy > 1.55 ? '16:9' : '4:3';
  const W = size === '16:9' ? 960 : 720;
  // Slide sizes that aren't PowerPoint's standard ones are scaled to fit.
  const k = W / (cx / EMU_PER_PT);
  const pt = (emu) => Math.round((emu / EMU_PER_PT) * k * 10) / 10;

  const presRels = rels(files, presPath);
  const slidePaths = kids(kid(pres.documentElement, P, 'sldIdLst'), P, 'sldId')
    .map((s) => presRels.get(s.getAttributeNS(R, 'id'))?.path)
    .filter(Boolean);
  if (!slidePaths.length) throw new Error('This presentation has no slides.');
  if (slidePaths.length > LIMITS.slides) warnings.add(`Only the first ${LIMITS.slides} slides were opened.`);

  const slides = [];
  for (const slidePath of slidePaths.slice(0, LIMITS.slides)) {
    const xml = parse(files, slidePath);
    const slideRels = rels(files, slidePath);
    const layoutPath = [...slideRels.values()].find((r) => r.type.endsWith('/slideLayout'))?.path;
    const layout = layoutPath ? parse(files, layoutPath) : null;
    const masterPath = layoutPath ? [...rels(files, layoutPath).values()].find((r) => r.type.endsWith('/slideMaster'))?.path : null;
    const master = masterPath ? parse(files, masterPath) : null;
    const elements = [];

    // Group transforms map child coordinates onto the slide.
    const walk = async (tree, map) => {
      for (const node of tree.children) {
        if (elements.length >= LIMITS.elements) {
          warnings.add(`Slides can have up to ${LIMITS.elements} items; extra items were left out.`);
          return;
        }
        const name = node.localName;
        if (name === 'grpSp') {
          const g = xfrmOf(node);
          if (!g?.chOff || !g.chExt) {
            await walk(node, map);
            continue;
          }
          const [ox, oy] = [num(g.chOff.getAttribute('x')), num(g.chOff.getAttribute('y'))];
          const sx = g.w / (num(g.chExt.getAttribute('cx')) || g.w || 1);
          const sy = g.h / (num(g.chExt.getAttribute('cy')) || g.h || 1);
          await walk(node, (b) => map({ ...b, x: g.x + (b.x - ox) * sx, y: g.y + (b.y - oy) * sy, w: b.w * sx, h: b.h * sy }));
          continue;
        }
        if (!['sp', 'pic', 'cxnSp', 'graphicFrame'].includes(name)) continue;

        const ph = placeholderOf(node);
        let box = xfrmOf(node);
        if (!box && ph) box = xfrmOf(findPlaceholder(layout, ph)) ?? xfrmOf(findPlaceholder(master, ph));
        if (!box) continue;
        const b = map(box);
        const el = {
          id: newId('e'), x: pt(b.x), y: pt(b.y), w: Math.max(1, pt(b.w)), h: Math.max(1, pt(b.h)), style: {},
          ...(box.rot ? { rotation: Math.round(((box.rot % 360) + 360) % 360) } : {}),
          ...(box.flipH ? { flipH: true } : {}),
          ...(box.flipV ? { flipV: true } : {}),
        };

        if (name === 'pic') {
          const embed = deep(node, A, 'blip')?.getAttributeNS(R, 'embed');
          const media = embed && slideRels.get(embed)?.path;
          const ext = media?.split('.').pop().toLowerCase();
          if (media && tooBig.has(media)) {
            warnings.add('Some pictures are larger than 5 MB and were left out.');
            continue;
          }
          if (!media || !IMAGE_TYPES[ext] || !files[media]) {
            warnings.add('Some pictures use a format that can\'t be shown (such as EMF or SVG) and were left out.');
            continue;
          }
          try {
            let bin = '';
            const bytes = files[media];
            for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
            const { imageId } = await uploadBase64(btoa(bin), IMAGE_TYPES[ext]);
            elements.push({ ...el, type: 'image', imageId });
          } catch {
            warnings.add('Some pictures couldn\'t be uploaded (too large, or over your image storage limit).');
          }
          continue;
        }

        if (name === 'graphicFrame') {
          const tbl = deep(node, A, 'tbl');
          if (!tbl) {
            warnings.add('Charts, SmartArt and other embedded objects aren\'t supported and were left out.');
            continue;
          }
          const rows = kids(tbl, A, 'tr').slice(0, LIMITS.tableRows).map((tr) => kids(tr, A, 'tc').slice(0, LIMITS.tableCols)
            .map((tc) => readText(kid(tc, A, 'txBody'), k).text.slice(0, LIMITS.cell)));
          const cols = Math.max(1, ...rows.map((r) => r.length));
          const firstCell = deep(tbl, A, 'rPr');
          const fontSize = num(firstCell?.getAttribute('sz'));
          elements.push({
            ...el, type: 'table', rows: rows.length || 1, cols, header: deep(tbl, A, 'tblPr')?.getAttribute('firstRow') === '1',
            headerFill: null, fill: null, border: null,
            cells: (rows.length ? rows : [['']]).map((r) => Array.from({ length: cols }, (_, c) => r[c] ?? '')),
            style: fontSize ? { size: Math.round((fontSize / 100) * k) } : { size: 16 },
          });
          continue;
        }

        const spPr = kid(node, P, 'spPr');
        const prst = kid(spPr, A, 'prstGeom')?.getAttribute('prst') ?? (name === 'cxnSp' ? 'line' : 'rect');
        const txBody = kid(node, P, 'txBody');
        const phType = ph ? ph.getAttribute('type') || 'body' : null;
        const role = { title: 'title', ctrTitle: 'title', subTitle: 'subtitle', body: 'body', obj: 'body' }[phType];
        if (phType && ['dt', 'ftr', 'sldNum'].includes(phType)) continue;
        const fallbackSize = role === 'title' ? 40 : role ? 20 : 18;
        const text = txBody ? readText(txBody, k, fallbackSize) : { text: '', style: {} };
        const fill = kid(spPr, A, 'noFill') ? 'none' : color(spPr);
        const ln = kid(spPr, A, 'ln');
        const stroke = ln ? (kid(ln, A, 'noFill') ? 'none' : color(ln)) : null;
        const strokeWidth = ln?.getAttribute('w') ? Math.min(20, Math.round((num(ln.getAttribute('w')) / EMU_PER_PT) * 10) / 10) : 0;

        // A plain rectangle with text and no fill is a text box.
        const textBox = (prst === 'rect' && (!fill || fill === 'none') && (!stroke || stroke === 'none')) || role;
        if (textBox && name !== 'cxnSp') {
          if (!text.text && !role) continue;
          elements.push({ ...el, type: 'text', ...(role ? { ph: role } : {}), text: text.text, style: text.style });
        } else {
          const shape = name === 'cxnSp' || prst === 'line' || prst.startsWith('straightConnector') ? 'line' : FROM_PPT[prst];
          if (!shape) warnings.add('Some shapes aren\'t available and were drawn as rectangles.');
          elements.push({
            ...el, type: 'shape', shape: shape ?? 'rect', fill: fill ?? null, stroke: stroke ?? null, strokeWidth,
            text: shape === 'line' ? '' : text.text, style: text.style,
          });
        }
      }
    };
    const tree = deep(xml, P, 'spTree');
    if (tree) await walk(tree, (b) => b);

    const background = color(deep(deep(xml, P, 'bg'), P, 'bgPr'));
    const notesPath = [...slideRels.values()].find((r) => r.type.endsWith('/notesSlide'))?.path;
    const notesXml = notesPath ? parse(files, notesPath) : null;
    const notesBody = notesXml && [...notesXml.getElementsByTagNameNS(P, 'sp')].find((s) => (placeholderOf(s)?.getAttribute('type') || '') === 'body');
    const notes = notesBody ? readText(kid(notesBody, P, 'txBody'), 1).text.slice(0, LIMITS.notes) : '';
    const hidden = xml.documentElement.getAttribute('show') === '0';

    slides.push({ ...makeSlide('blank', size), background, ...(hidden ? { hidden: true } : {}), notes, elements });
  }

  const core = parse(files, 'docProps/core.xml');
  const title = (core?.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', 'title')[0]?.textContent || file.name.replace(/\.pptx$/i, '')).slice(0, 200);
  return {
    title,
    content: { size, theme: 'light', footer: { number: false, text: '', skipFirst: true }, active: 0, slides },
    warnings: [...warnings],
  };
}
