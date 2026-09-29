// The workbook, as the Sheets editor holds it in memory. It's saved in the shape
// the server's allow-list expects (backend apps/office/sheetContent.js), with
// cell formats deduplicated into a `styles` list. Change both together.
//
// In memory: { sheets: [{ id, name, rows, cols, widths, heights, freeze, cells }], active }
// where cells is { A1: { v, f, s } } and `s` is the format object itself.
// Workbooks are never changed in place: every edit makes a new one, which is
// what undo keeps.

export const LIMITS = { sheets: 50, rows: 10_000, cols: 200, cells: 100_000, text: 10_000, formula: 4_000 };
export const DEFAULT_ROWS = 1000;
export const DEFAULT_COLS = 26;

// Sizes in pixels at 100% zoom (Excel's defaults are close to these).
export const COL_W = 88;
export const ROW_H = 21;
export const HEADER_W = 46;
export const HEADER_H = 22;

export function colName(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export function colIndex(letters) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export const cellKey = (r, c) => `${colName(c)}${r + 1}`;

const KEY = /^([A-Z]{1,3})(\d+)$/;
export function parseKey(key) {
  const m = KEY.exec(key);
  return m ? { r: Number(m[2]) - 1, c: colIndex(m[1]) } : null;
}

// "A1" or "A1:C5" for a selection range.
export const rangeLabel = ({ r1, c1, r2, c2 }) => (r1 === r2 && c1 === c2 ? cellKey(r1, c1) : `${cellKey(r1, c1)}:${cellKey(r2, c2)}`);

export const normRange = (a, b) => ({
  r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c),
});

let idCounter = 0;
export const newSheetId = (sheets) => {
  const taken = new Set(sheets.map((s) => s.id));
  let id;
  do {
    idCounter += 1;
    id = `s${Date.now().toString(36).slice(-6)}${idCounter.toString(36)}`;
  } while (taken.has(id));
  return id;
};

export function blankSheet(name, id) {
  return { id, name, rows: DEFAULT_ROWS, cols: DEFAULT_COLS, widths: {}, heights: {}, freeze: { rows: 0, cols: 0 }, cells: {} };
}

// Characters Excel refuses in sheet names, and the length it allows.
export function sheetNameError(name, sheets, exceptId) {
  const n = name.trim();
  if (!n) return 'Enter a name';
  if (n.length > 31) return 'Sheet names can be up to 31 characters';
  if (/[[\]:*?/\\]/.test(n)) return 'Sheet names can\'t contain [ ] : * ? / \\';
  if (n.startsWith("'") || n.endsWith("'")) return 'Sheet names can\'t start or end with an apostrophe';
  if (sheets.some((s) => s.id !== exceptId && s.name.toLowerCase() === n.toLowerCase())) return 'Another sheet already has that name';
  return null;
}

export function uniqueSheetName(sheets, base = 'Sheet') {
  const names = new Set(sheets.map((s) => s.name.toLowerCase()));
  if (base !== 'Sheet' && !names.has(base.toLowerCase())) return base;
  for (let n = base === 'Sheet' ? sheets.length + 1 : 2; ; n += 1) {
    const name = base === 'Sheet' ? `Sheet${n}` : `${base.slice(0, 26)} (${n})`;
    if (!names.has(name.toLowerCase())) return name;
  }
}

// Styles are shared objects, so equal formats are the same object in memory
// and serialize to one entry.
const styleCache = new Map();
export function internStyle(style) {
  if (!style) return undefined;
  const clean = Object.fromEntries(Object.entries(style).filter(([, v]) => v !== undefined && v !== null && v !== false).sort(([a], [b]) => (a < b ? -1 : 1)));
  if (!Object.keys(clean).length) return undefined;
  const key = JSON.stringify(clean);
  let found = styleCache.get(key);
  if (!found) {
    found = Object.freeze(clean);
    styleCache.set(key, found);
  }
  return found;
}

export function fromContent(content) {
  const styles = (content.styles || []).map(internStyle);
  const sheets = content.sheets.map((s) => {
    const cells = {};
    for (const [key, cell] of Object.entries(s.cells || {})) {
      const next = {};
      if (cell.f !== undefined) next.f = cell.f;
      else if (cell.v !== undefined) next.v = cell.v;
      const st = cell.s !== undefined ? styles[cell.s] : undefined;
      if (st) next.s = st;
      cells[key] = next;
    }
    return {
      id: s.id,
      name: s.name,
      rows: s.rows || DEFAULT_ROWS,
      cols: s.cols || DEFAULT_COLS,
      widths: { ...(s.widths || {}) },
      heights: { ...(s.heights || {}) },
      freeze: { rows: s.freeze?.rows || 0, cols: s.freeze?.cols || 0 },
      cells,
    };
  });
  return { sheets, active: Math.min(content.active || 0, sheets.length - 1) };
}

export function toContent(wb) {
  const styles = [];
  const index = new Map();
  const sheets = wb.sheets.map((s) => {
    const cells = {};
    for (const [key, cell] of Object.entries(s.cells)) {
      const out = {};
      if (cell.f !== undefined) out.f = cell.f;
      else if (cell.v !== undefined && cell.v !== '') out.v = cell.v;
      if (cell.s) {
        if (!index.has(cell.s)) {
          index.set(cell.s, styles.length);
          styles.push(cell.s);
        }
        out.s = index.get(cell.s);
      }
      if (Object.keys(out).length) cells[key] = out;
    }
    return { id: s.id, name: s.name, rows: s.rows, cols: s.cols, widths: s.widths, heights: s.heights, freeze: s.freeze, cells };
  });
  return { sheets, styles, active: wb.active };
}

export const countCells = (wb) => wb.sheets.reduce((n, s) => n + Object.keys(s.cells).length, 0);

// The last row and column that hold anything, or -1 when the sheet is empty.
export function usedExtent(sheet) {
  let maxR = -1;
  let maxC = -1;
  for (const key of Object.keys(sheet.cells)) {
    const p = parseKey(key);
    if (p.r > maxR) maxR = p.r;
    if (p.c > maxC) maxC = p.c;
  }
  return { maxR, maxC };
}
