import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { cellKey, parseKey, internStyle, blankSheet, LIMITS, DEFAULT_ROWS, DEFAULT_COLS, COL_W, ROW_H } from './model';
import { FONTS } from './styles';
import { offsetFormula } from './formula/refs';
import { isError } from './format';

// Excel files (.xlsx): reading and writing the parts Sheets supports —
// values, formulas, number formats, fonts, colours, fills, borders, alignment,
// column widths, row heights and frozen panes. Merged cells, charts,
// comments and conditional formatting are not kept. Loaded only when needed.

const MAX_FILE = 25 * 1024 * 1024;
const MAX_PART = 200 * 1024 * 1024;

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

// ---- Shared ----

const firstFont = (stack) => stack.split(',')[0].replace(/["']/g, '').trim();
const fontByName = new Map(FONTS.map((f) => [firstFont(f.value).toLowerCase(), f.value]));

// Excel measures column widths in characters and row heights in points.
const pxToChars = (px) => Math.max(0, Math.round(((px - 5) / 7) * 100) / 100);
const charsToPx = (w) => Math.round(w * 7 + 5);
const pxToPt = (px) => Math.round(px * 0.75 * 100) / 100;
const ptToPx = (pt) => Math.round(pt / 0.75);

// ---- Writing ----

const XML_BAD = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;
const esc = (s) => String(s).replace(XML_BAD, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const argb = (hex) => `FF${hex.slice(1).toUpperCase()}`;

function numFmtCode(style) {
  const dp = style?.dp;
  const decimals = (n) => (n ? `.${'0'.repeat(n)}` : '');
  switch (style?.fmt) {
    case 'number': return `#,##0${decimals(dp ?? 2)}`;
    case 'currency': return `"$"#,##0${decimals(dp ?? 2)};-"$"#,##0${decimals(dp ?? 2)}`;
    case 'percent': return `0${decimals(dp ?? 0)}%`;
    case 'scientific': return `0${decimals(dp ?? 2)}E+00`;
    case 'date': return 'm/d/yyyy';
    case 'time': return 'h:mm AM/PM';
    case 'datetime': return 'm/d/yyyy h:mm';
    case 'text': return '@';
    default: return dp !== undefined ? `0${decimals(dp)}` : null;
  }
}
const BUILTIN_FORMATS = { 'm/d/yyyy': 14, 'h:mm AM/PM': 18, 'm/d/yyyy h:mm': 22, '@': 49, '0': 1, '0.00': 2, '#,##0': 3, '#,##0.00': 4, '0%': 9, '0.00%': 10, '0.00E+00': 11 };

function stylesXml(styles) {
  const numFmts = new Map();
  const fonts = ['<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>'];
  const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  const borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
  const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  const index = new Map();
  const intern = (list, xml) => {
    let i = list.indexOf(xml);
    if (i < 0) {
      list.push(xml);
      i = list.length - 1;
    }
    return i;
  };

  for (const s of styles) {
    const code = numFmtCode(s);
    let numFmtId = 0;
    if (code) {
      numFmtId = BUILTIN_FORMATS[code] ?? numFmts.get(code);
      if (numFmtId === undefined) {
        numFmtId = 164 + numFmts.size;
        numFmts.set(code, numFmtId);
      }
    }
    const font = `<font>${s.b ? '<b/>' : ''}${s.i ? '<i/>' : ''}${s.s ? '<strike/>' : ''}${s.u ? '<u/>' : ''}<sz val="${s.size ?? 11}"/>${
      s.color ? `<color rgb="${argb(s.color)}"/>` : '<color theme="1"/>'}<name val="${esc(s.font ? firstFont(s.font) : 'Calibri')}"/><family val="2"/></font>`;
    const fill = s.fill ? `<fill><patternFill patternType="solid"><fgColor rgb="${argb(s.fill)}"/><bgColor indexed="64"/></patternFill></fill>` : null;
    const side = (on, tag) => (on ? `<${tag} style="thin"><color auto="1"/></${tag}>` : `<${tag}/>`);
    const border = s.bl || s.br || s.bt || s.bb ? `<border>${side(s.bl, 'left')}${side(s.br, 'right')}${side(s.bt, 'top')}${side(s.bb, 'bottom')}<diagonal/></border>` : null;
    const align = s.h || s.v || s.wrap
      ? `<alignment${s.h ? ` horizontal="${s.h}"` : ''}${s.v ? ` vertical="${s.v === 'middle' ? 'center' : s.v}"` : ''}${s.wrap ? ' wrapText="1"' : ''}/>`
      : '';
    const fontId = intern(fonts, font);
    const fillId = fill ? intern(fills, fill) : 0;
    const borderId = border ? intern(borders, border) : 0;
    index.set(s, xfs.length);
    xfs.push(`<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"${
      numFmtId ? ' applyNumberFormat="1"' : ''}${fontId ? ' applyFont="1"' : ''}${fillId ? ' applyFill="1"' : ''}${borderId ? ' applyBorder="1"' : ''}${
      align ? ` applyAlignment="1">${align}</xf>` : '/>'}`);
  }

  const xml = `${HEAD}<styleSheet xmlns="${NS_MAIN}">${
    numFmts.size ? `<numFmts count="${numFmts.size}">${[...numFmts].map(([code, id]) => `<numFmt numFmtId="${id}" formatCode="${esc(code)}"/>`).join('')}</numFmts>` : ''
  }<fonts count="${fonts.length}">${fonts.join('')}</fonts><fills count="${fills.length}">${fills.join('')}</fills><borders count="${borders.length}">${borders.join('')}</borders>`
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  return { xml, index };
}

function sheetXml(sheet, si, active, engine, styleIndex) {
  const rows = new Map();
  for (const [key, cell] of Object.entries(sheet.cells)) {
    const { r } = parseKey(key);
    if (!rows.has(r)) rows.set(r, []);
    rows.get(r).push([key, cell]);
  }
  const rowNums = new Set([...rows.keys(), ...Object.keys(sheet.heights).map(Number)]);
  const body = [...rowNums].sort((a, b) => a - b).map((r) => {
    const cells = (rows.get(r) || []).map(([key, cell]) => ({ key, cell, c: parseKey(key).c })).sort((a, b) => a.c - b.c);
    const h = sheet.heights[r];
    const xml = cells.map(({ key, cell }) => {
      const s = cell.s ? ` s="${styleIndex.get(cell.s)}"` : '';
      if (cell.f !== undefined) {
        const v = engine.value(si, parseKey(key).r, parseKey(key).c);
        const f = `<f>${esc(cell.f)}</f>`;
        if (typeof v === 'number') return `<c r="${key}"${s}>${f}<v>${v}</v></c>`;
        if (typeof v === 'boolean') return `<c r="${key}"${s} t="b">${f}<v>${v ? 1 : 0}</v></c>`;
        if (isError(v)) return `<c r="${key}"${s} t="e">${f}<v>${esc(v.error === '#CIRC!' || v.error === '#ERROR!' ? '#VALUE!' : v.error)}</v></c>`;
        return `<c r="${key}"${s} t="str">${f}<v>${esc(v ?? '')}</v></c>`;
      }
      if (typeof cell.v === 'number') return `<c r="${key}"${s}><v>${cell.v}</v></c>`;
      if (typeof cell.v === 'boolean') return `<c r="${key}"${s} t="b"><v>${cell.v ? 1 : 0}</v></c>`;
      if (typeof cell.v === 'string') return `<c r="${key}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(cell.v)}</t></is></c>`;
      return `<c r="${key}"${s}/>`;
    }).join('');
    return `<row r="${r + 1}"${h ? ` ht="${pxToPt(h)}" customHeight="1"` : ''}>${xml}</row>`;
  }).join('');

  const widths = Object.entries(sheet.widths).map(([c, px]) => [Number(c), px]).sort((a, b) => a[0] - b[0]);
  const cols = widths.length ? `<cols>${widths.map(([c, px]) => `<col min="${c + 1}" max="${c + 1}" width="${pxToChars(px)}" customWidth="1"/>`).join('')}</cols>` : '';
  const { rows: fr, cols: fc } = sheet.freeze;
  const pane = fr || fc
    ? `<pane${fc ? ` xSplit="${fc}"` : ''}${fr ? ` ySplit="${fr}"` : ''} topLeftCell="${cellKey(fr, fc)}" activePane="${fr && fc ? 'bottomRight' : fr ? 'bottomLeft' : 'topRight'}" state="frozen"/>`
    : '';
  return `${HEAD}<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><sheetViews><sheetView workbookViewId="0"${active ? ' tabSelected="1"' : ''}>${pane}</sheetView></sheetViews>`
    + `<sheetFormatPr defaultRowHeight="${pxToPt(ROW_H)}" defaultColWidth="${pxToChars(COL_W)}"/>${cols}<sheetData>${body}</sheetData></worksheet>`;
}

export function exportXlsx(wb, engine, title) {
  const styles = [...new Set(wb.sheets.flatMap((s) => Object.values(s.cells).map((c) => c.s).filter(Boolean)))];
  const { xml: stylesPart, index } = stylesXml(styles);
  const files = {
    '[Content_Types].xml': `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
      + wb.sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
      + '</Types>',
    '_rels/.rels': `${HEAD}<Relationships xmlns="${NS_PKG_REL}"><Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/>`
      + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
    'docProps/core.xml': `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">`
      + `<dc:title>${esc(title || 'Untitled spreadsheet')}</dc:title><dc:creator>Kanforge</dc:creator></cp:coreProperties>`,
    'xl/workbook.xml': `${HEAD}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><bookViews><workbookView activeTab="${wb.active}"/></bookViews><sheets>`
      + wb.sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
      + '</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>',
    'xl/_rels/workbook.xml.rels': `${HEAD}<Relationships xmlns="${NS_PKG_REL}">`
      + wb.sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS_REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
      + `<Relationship Id="rId${wb.sheets.length + 1}" Type="${NS_REL}/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': stylesPart,
  };
  wb.sheets.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(s, i, i === wb.active, engine, index);
  });
  const zipped = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])), { level: 6 });
  return new Blob([zipped], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// ---- Reading ----

const parseXml = (text) => {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('This Excel file is damaged');
  return doc;
};
const all = (node, name) => [...node.getElementsByTagNameNS('*', name)];
const first = (node, name) => node.getElementsByTagNameNS('*', name)[0] || null;
const kids = (node, name) => [...node.children].filter((n) => n.localName === name);
const attr = (node, name) => node?.getAttribute(name) ?? null;
const relAttr = (node, name) => node.getAttributeNS(NS_REL, name) || node.getAttribute(`r:${name}`);

// The default Office theme, used when a file's colours refer to its theme without one.
const DEFAULT_THEME = ['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47'];
const INDEXED = ['000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF'];

function readTheme(xml) {
  if (!xml) return DEFAULT_THEME;
  const scheme = first(parseXml(xml), 'clrScheme');
  if (!scheme) return DEFAULT_THEME;
  const colors = [...scheme.children].map((c) => {
    const v = c.firstElementChild;
    return (attr(v, 'lastClr') || attr(v, 'val') || '000000').toUpperCase();
  });
  // Excel numbers them light 1, dark 1, light 2, dark 2, then the accents.
  if (colors.length < 10) return DEFAULT_THEME;
  return [colors[1], colors[0], colors[3], colors[2], ...colors.slice(4, 10)];
}

function readColor(node, theme) {
  if (!node || attr(node, 'auto') === '1') return null;
  let hex = null;
  const rgb = attr(node, 'rgb');
  if (rgb) hex = rgb.slice(-6);
  else if (attr(node, 'theme') !== null) hex = theme[Number(attr(node, 'theme'))];
  else if (attr(node, 'indexed') !== null) {
    const i = Number(attr(node, 'indexed'));
    hex = i < 8 ? INDEXED[i] : i >= 8 && i < 16 ? INDEXED[i - 8] : null;
  }
  if (!hex || !/^[0-9a-f]{6}$/i.test(hex)) return null;
  const tint = Number(attr(node, 'tint') || 0);
  const channels = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).map((ch) => Math.round(tint > 0 ? ch + (255 - ch) * tint : ch * (1 + tint)));
  return `#${channels.map((ch) => Math.max(0, Math.min(255, ch)).toString(16).padStart(2, '0')).join('')}`;
}

// A number format → one of Sheets' formats.
function readNumFmt(id, code) {
  const n = Number(id);
  if (!n) return {};
  if (n === 1) return { dp: 0 };
  if (n === 2) return { dp: 2 };
  if (n === 3) return { fmt: 'number', dp: 0 };
  if (n === 4) return { fmt: 'number', dp: 2 };
  if (n >= 5 && n <= 8) return { fmt: 'currency', dp: n <= 6 ? 0 : 2 };
  if (n === 9) return { fmt: 'percent', dp: 0 };
  if (n === 10) return { fmt: 'percent', dp: 2 };
  if (n === 11 || n === 48) return { fmt: 'scientific', dp: 2 };
  if ((n >= 14 && n <= 17) || (n >= 27 && n <= 36) || (n >= 50 && n <= 58)) return { fmt: 'date' };
  if ((n >= 18 && n <= 21) || (n >= 45 && n <= 47)) return { fmt: 'time' };
  if (n === 22) return { fmt: 'datetime' };
  if (n >= 37 && n <= 44) return { fmt: 'number', dp: n % 2 ? 0 : 2 };
  if (n === 49) return { fmt: 'text' };
  if (!code) return {};
  const section = code.split(';')[0].replace(/"[^"]*"|\\.|\[(?!\$)[^\]]*\]/g, '');
  const dp = (/\.(0+)/.exec(section)?.[1] || '').length;
  if (section.includes('@')) return { fmt: 'text' };
  const date = /[yd]/i.test(section) || (/m/i.test(section) && !/[hs]/i.test(section));
  const time = /[hs]/i.test(section);
  if (date && time) return { fmt: 'datetime' };
  if (date) return { fmt: 'date' };
  if (time) return { fmt: 'time' };
  if (section.includes('%')) return { fmt: 'percent', dp };
  if (/E[+-]/i.test(section)) return { fmt: 'scientific', dp };
  if (/[$€£¥]|\[\$/.test(code.split(';')[0])) return { fmt: 'currency', dp };
  if (section.includes(',')) return { fmt: 'number', dp };
  if (/0/.test(section)) return { dp };
  return {};
}

function readStyles(xml, theme) {
  if (!xml) return [];
  const doc = parseXml(xml);
  const codes = new Map(all(doc, 'numFmt').map((n) => [attr(n, 'numFmtId'), attr(n, 'formatCode')]));
  const fonts = kids(first(doc, 'fonts') || doc, 'font').map((f) => {
    const out = {};
    const flag = (name) => {
      const n = first(f, name);
      return n && attr(n, 'val') !== '0' && attr(n, 'val') !== 'false' && attr(n, 'val') !== 'none';
    };
    if (flag('b')) out.b = true;
    if (flag('i')) out.i = true;
    if (flag('u')) out.u = true;
    if (flag('strike')) out.s = true;
    const size = Number(attr(first(f, 'sz'), 'val'));
    if (size && size !== 11) out.size = Math.max(6, Math.min(96, Math.round(size * 2) / 2));
    const color = readColor(first(f, 'color'), theme);
    if (color && color !== '#000000') out.color = color;
    const name = attr(first(f, 'name'), 'val');
    const stack = name && fontByName.get(name.toLowerCase());
    if (stack && stack !== FONTS[0].value) out.font = stack;
    return out;
  });
  const fills = kids(first(doc, 'fills') || doc, 'fill').map((f) => {
    const p = first(f, 'patternFill');
    if (!p || attr(p, 'patternType') !== 'solid') return null;
    return readColor(first(p, 'fgColor'), theme);
  });
  const borders = kids(first(doc, 'borders') || doc, 'border').map((b) => {
    const out = {};
    for (const [tag, key] of [['top', 'bt'], ['bottom', 'bb'], ['left', 'bl'], ['right', 'br']]) {
      const side = kids(b, tag)[0];
      if (side && attr(side, 'style') && attr(side, 'style') !== 'none') out[key] = true;
    }
    return out;
  });
  const xfs = first(doc, 'cellXfs');
  if (!xfs) return [];
  return kids(xfs, 'xf').map((xf) => {
    const style = {
      ...readNumFmt(attr(xf, 'numFmtId') ?? 0, codes.get(attr(xf, 'numFmtId'))),
      ...fonts[Number(attr(xf, 'fontId') || 0)],
      ...borders[Number(attr(xf, 'borderId') || 0)],
    };
    const fill = fills[Number(attr(xf, 'fillId') || 0)];
    if (fill) style.fill = fill;
    const align = kids(xf, 'alignment')[0];
    if (align) {
      const h = attr(align, 'horizontal');
      if (['left', 'center', 'right'].includes(h)) style.h = h;
      else if (h === 'centerContinuous') style.h = 'center';
      const v = attr(align, 'vertical');
      if (v === 'top') style.v = 'top';
      else if (v === 'center') style.v = 'middle';
      if (attr(align, 'wrapText') === '1' || attr(align, 'wrapText') === 'true') style.wrap = true;
    }
    return internStyle(style);
  });
}

const cleanFormula = (f) => f.replace(/_xlfn\.|_xlws\./g, '');

function readSheet(xml, name, id, { strings, styles, date1904 }) {
  const doc = parseXml(xml);
  const sheet = blankSheet(name, id);
  const cells = {};
  let maxR = -1;
  let maxC = -1;
  let dropped = false;
  const shared = new Map();

  for (const row of all(doc, 'row')) {
    const rIndex = Number(attr(row, 'r')) - 1;
    if (rIndex >= 0 && rIndex < LIMITS.rows && attr(row, 'customHeight') === '1' && attr(row, 'ht')) sheet.heights[rIndex] = Math.max(2, ptToPx(Number(attr(row, 'ht'))));
    for (const c of kids(row, 'c')) {
      const ref = attr(c, 'r');
      const pos = ref ? parseKey(ref.toUpperCase()) : null;
      if (!pos) continue;
      if (pos.r >= LIMITS.rows || pos.c >= LIMITS.cols) {
        dropped = true;
        continue;
      }
      const cell = {};
      const s = styles[Number(attr(c, 's') || 0)];
      if (s) cell.s = s;
      const t = attr(c, 't') || 'n';
      const fNode = kids(c, 'f')[0];
      const vNode = kids(c, 'v')[0];
      if (fNode) {
        const si = attr(fNode, 'si');
        let f = fNode.textContent;
        if (attr(fNode, 't') === 'shared' && si !== null) {
          if (f) shared.set(si, { f, r: pos.r, c: pos.c });
          else if (shared.has(si)) {
            const master = shared.get(si);
            f = offsetFormula(master.f, pos.r - master.r, pos.c - master.c);
          }
        }
        if (f) cell.f = cleanFormula(f).slice(0, LIMITS.formula);
      }
      if (cell.f === undefined) {
        const raw = vNode?.textContent;
        if (t === 's' && raw !== undefined) cell.v = strings[Number(raw)] ?? '';
        else if (t === 'inlineStr') cell.v = all(c, 't').map((n) => n.textContent).join('');
        else if (t === 'b' && raw !== undefined) cell.v = raw === '1' || raw === 'true';
        else if (t === 'str' || t === 'e') {
          if (raw) cell.v = raw;
        } else if (raw !== undefined && raw !== '') {
          const n = Number(raw);
          if (Number.isFinite(n)) cell.v = date1904 && s?.fmt && ['date', 'datetime'].includes(s.fmt) ? n + 1462 : n;
        }
        if (typeof cell.v === 'string') {
          if (!cell.v) delete cell.v;
          else cell.v = cell.v.slice(0, LIMITS.text);
        }
      }
      if (cell.v === undefined && cell.f === undefined && !cell.s) continue;
      cells[cellKey(pos.r, pos.c)] = cell;
      if (pos.r > maxR) maxR = pos.r;
      if (pos.c > maxC) maxC = pos.c;
    }
  }

  for (const col of all(doc, 'col')) {
    const min = Number(attr(col, 'min')) - 1;
    const max = Math.min(Number(attr(col, 'max')) - 1, LIMITS.cols - 1, min + LIMITS.cols);
    const width = Number(attr(col, 'width'));
    if (attr(col, 'customWidth') !== '1' || !width || min < 0) continue;
    for (let c = min; c <= max; c += 1) sheet.widths[c] = Math.max(2, Math.min(2000, charsToPx(width)));
  }

  const pane = first(doc, 'pane');
  if (pane && (attr(pane, 'state') === 'frozen' || attr(pane, 'state') === 'frozenSplit')) {
    sheet.freeze = {
      rows: Math.min(50, Math.max(0, Math.round(Number(attr(pane, 'ySplit') || 0)))),
      cols: Math.min(20, Math.max(0, Math.round(Number(attr(pane, 'xSplit') || 0)))),
    };
  }

  sheet.cells = cells;
  sheet.rows = Math.min(LIMITS.rows, Math.max(DEFAULT_ROWS, maxR + 1, ...Object.keys(sheet.heights).map((r) => Number(r) + 1)));
  sheet.cols = Math.min(LIMITS.cols, Math.max(DEFAULT_COLS, maxC + 1));
  for (const c of Object.keys(sheet.widths)) if (Number(c) >= sheet.cols) delete sheet.widths[c];
  return { sheet, dropped, merged: all(doc, 'mergeCell').length > 0 };
}

// Relationship targets are relative to the part's folder.
function resolvePath(base, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/').slice(0, -1);
  for (const p of target.split('/')) {
    if (p === '..') parts.pop();
    else if (p !== '.') parts.push(p);
  }
  return parts.join('/');
}

// .xlsx file → { wb, warnings }.
export async function importXlsx(file) {
  if (file.size > MAX_FILE) throw new Error('Excel files can be up to 25 MB');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let zip;
  try {
    zip = unzipSync(bytes, { filter: (f) => f.originalSize <= MAX_PART && !/\.(png|jpe?g|gif|emf|wmf|bin|tiff?)$/i.test(f.name) });
  } catch {
    throw new Error('This isn\'t an Excel (.xlsx) file');
  }
  const text = (path) => (zip[path] ? strFromU8(zip[path]) : null);
  const workbookXml = text('xl/workbook.xml');
  if (!workbookXml) throw new Error('This isn\'t an Excel (.xlsx) file');

  const wbDoc = parseXml(workbookXml);
  const rels = new Map();
  const relsXml = text('xl/_rels/workbook.xml.rels');
  if (relsXml) for (const r of all(parseXml(relsXml), 'Relationship')) rels.set(attr(r, 'Id'), resolvePath('xl/workbook.xml', attr(r, 'Target')));

  const theme = readTheme(text('xl/theme/theme1.xml'));
  const styles = readStyles(text('xl/styles.xml'), theme);
  const sstXml = text('xl/sharedStrings.xml');
  const strings = sstXml ? kids(parseXml(sstXml).documentElement, 'si').map((si) => all(si, 't').filter((t) => t.parentNode.localName !== 'rPh').map((t) => t.textContent).join('')) : [];
  const date1904 = ['1', 'true'].includes(attr(first(wbDoc, 'workbookPr'), 'date1904'));

  const sheets = [];
  const warnings = new Set();
  const used = new Set();
  for (const s of all(wbDoc, 'sheet').slice(0, LIMITS.sheets)) {
    const path = rels.get(relAttr(s, 'id'));
    const xml = path && text(path);
    if (!xml) continue;
    let name = (attr(s, 'name') || `Sheet${sheets.length + 1}`).slice(0, 31).replace(/[[\]:*?/\\]/g, ' ').trim() || `Sheet${sheets.length + 1}`;
    while (used.has(name.toLowerCase())) name = `${name.slice(0, 27)} (${sheets.length + 1})`;
    used.add(name.toLowerCase());
    const { sheet, dropped, merged } = readSheet(xml, name, `s${sheets.length + 1}`, { strings, styles, date1904 });
    if (dropped) warnings.add(`Only the first ${LIMITS.rows.toLocaleString()} rows and ${LIMITS.cols} columns were kept.`);
    if (merged) warnings.add('Merged cells were unmerged.');
    sheets.push(sheet);
  }
  if (all(wbDoc, 'sheet').length > LIMITS.sheets) warnings.add(`Only the first ${LIMITS.sheets} sheets were kept.`);
  if (!sheets.length) throw new Error('This Excel file has no sheets Sheets can open');
  const activeTab = Number(attr(first(wbDoc, 'workbookView'), 'activeTab') || 0);
  const cellTotal = sheets.reduce((n, s) => n + Object.keys(s.cells).length, 0);
  if (cellTotal > LIMITS.cells) throw new Error(`This file has more than ${LIMITS.cells.toLocaleString()} filled cells, which is more than Sheets can hold`);
  return { wb: { sheets, active: Math.min(activeTab, sheets.length - 1) }, warnings: [...warnings] };
}

