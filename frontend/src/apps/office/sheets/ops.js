import { cellKey, parseKey, internStyle, usedExtent, blankSheet, newSheetId, uniqueSheetName, LIMITS } from './model';
import { offsetFormula, shiftFormula, renameSheetInFormula, dropSheetFromFormula } from './formula/refs';

// Edits to a workbook. Each returns a new workbook and leaves the old one alone.

export const withSheet = (wb, si, fn) => ({ ...wb, sheets: wb.sheets.map((s, i) => (i === si ? fn(s) : s)) });

const hasContent = (cell) => cell && (cell.v !== undefined || cell.f !== undefined || cell.s);

// changes: [[key, cell or null], ...]
export function setCells(wb, si, changes) {
  return withSheet(wb, si, (s) => {
    const cells = { ...s.cells };
    for (const [key, cell] of changes) {
      if (hasContent(cell)) cells[key] = cell;
      else delete cells[key];
    }
    return { ...s, cells };
  });
}

function mapFormulas(wb, fn) {
  return {
    ...wb,
    sheets: wb.sheets.map((s) => {
      let changed = false;
      const cells = {};
      for (const [key, cell] of Object.entries(s.cells)) {
        if (cell.f !== undefined) {
          const f = fn(cell.f, s);
          if (f !== cell.f) {
            changed = true;
            cells[key] = { ...cell, f };
            continue;
          }
        }
        cells[key] = cell;
      }
      return changed ? { ...s, cells } : s;
    }),
  };
}

// Cells of a sheet inside a range, as [key, cell, row, col].
export function cellsIn(sheet, { r1, c1, r2, c2 }) {
  const out = [];
  for (const [key, cell] of Object.entries(sheet.cells)) {
    const p = parseKey(key);
    if (p.r >= r1 && p.r <= r2 && p.c >= c1 && p.c <= c2) out.push([key, cell, p.r, p.c]);
  }
  return out;
}

// Formatting a whole column or the whole sheet stops a little past the data,
// so it doesn't fill the sheet with empty formatted cells.
function clampForFormat(sheet, range) {
  const { maxR, maxC } = usedExtent(sheet);
  return {
    ...range,
    r2: Math.min(range.r2, Math.max(maxR, range.r1 + 99)),
    c2: Math.min(range.c2, Math.max(maxC, range.c1 + 25)),
  };
}

// `patch(style)` returns the new format for each cell.
export function formatRange(wb, si, range, patch) {
  return withSheet(wb, si, (s) => {
    const cells = { ...s.cells };
    const { r1, c1, r2, c2 } = clampForFormat(s, range);
    for (let r = r1; r <= r2; r += 1) {
      for (let c = c1; c <= c2; c += 1) {
        const key = cellKey(r, c);
        const cell = cells[key];
        const style = internStyle(patch(cell?.s ? { ...cell.s } : {}, r, c));
        if (style === cell?.s) continue;
        const next = { ...cell, s: style };
        if (!style) delete next.s;
        if (hasContent(next)) cells[key] = next;
        else delete cells[key];
      }
    }
    return { ...s, cells };
  });
}

// Borders on a range: 'all', 'outer', 'top', 'bottom', 'left', 'right', 'inner' or 'none'.
export function setBorders(wb, si, range, kind) {
  const { r1, c1, r2, c2 } = range;
  return formatRange(wb, si, range, (st, r, c) => {
    const s = st;
    if (kind === 'none') {
      delete s.bt; delete s.br; delete s.bb; delete s.bl;
      return s;
    }
    const edges = {
      all: { bt: true, br: true, bb: true, bl: true },
      outer: { bt: r === r1, bb: r === r2, bl: c === c1, br: c === c2 },
      inner: { bb: r < r2, br: c < c2 },
      top: { bt: r === r1 },
      bottom: { bb: r === r2 },
      left: { bl: c === c1 },
      right: { br: c === c2 },
    }[kind];
    for (const [k, on] of Object.entries(edges)) if (on) s[k] = true;
    return s;
  });
}

// what: 'contents' (keep formats), 'formats' or 'all'.
export function clearRange(wb, si, range, what = 'contents') {
  return withSheet(wb, si, (s) => {
    const cells = { ...s.cells };
    for (const [key, cell] of cellsIn(s, range)) {
      if (what === 'all') delete cells[key];
      else if (what === 'formats') {
        if (cell.v !== undefined || cell.f !== undefined) cells[key] = cell.f !== undefined ? { f: cell.f } : { v: cell.v };
        else delete cells[key];
      } else if (cell.s) cells[key] = { s: cell.s };
      else delete cells[key];
    }
    return { ...s, cells };
  });
}

// ---- Copy and paste ----

// A block of cells: { rows, cols, cells: [[cell or null]], origin: { r, c } }.
export function readBlock(sheet, range) {
  const rows = range.r2 - range.r1 + 1;
  const cols = range.c2 - range.c1 + 1;
  const cells = Array.from({ length: rows }, () => Array(cols).fill(null));
  for (const [, cell, r, c] of cellsIn(sheet, range)) cells[r - range.r1][c - range.c1] = cell;
  return { rows, cols, cells, origin: { r: range.r1, c: range.c1 } };
}

// Pastes a block at `target` (the selection). A selection that's a whole
// multiple of the block's size is tiled with it, as in Excel. Formulas are
// moved with the cells unless `valuesOnly` is set. Returns { wb, range }.
export function writeBlock(wb, si, target, block, { valuesOnly = false, values = null, formatsOnly = false } = {}) {
  const tr = target.r2 - target.r1 + 1;
  const tc = target.c2 - target.c1 + 1;
  const tileR = tr % block.rows === 0 ? tr / block.rows : 1;
  const tileC = tc % block.cols === 0 ? tc / block.cols : 1;
  const sheet = wb.sheets[si];
  const needRows = Math.min(LIMITS.rows, Math.max(sheet.rows, target.r1 + block.rows * tileR));
  const needCols = Math.min(LIMITS.cols, Math.max(sheet.cols, target.c1 + block.cols * tileC));
  const changes = [];
  for (let ti = 0; ti < tileR; ti += 1) {
    for (let tj = 0; tj < tileC; tj += 1) {
      for (let i = 0; i < block.rows; i += 1) {
        for (let j = 0; j < block.cols; j += 1) {
          const r = target.r1 + ti * block.rows + i;
          const c = target.c1 + tj * block.cols + j;
          if (r >= needRows || c >= needCols) continue;
          const src = block.cells[i][j];
          const key = cellKey(r, c);
          const existing = sheet.cells[key];
          let next;
          if (formatsOnly) next = { ...existing, s: src?.s };
          else if (!src) next = null;
          else if (src.f !== undefined && valuesOnly) {
            const v = values?.[i]?.[j];
            next = { v: v === null || typeof v === 'object' ? undefined : v, s: src.s };
          } else if (src.f !== undefined) next = { f: offsetFormula(src.f, r - (block.origin.r + i), c - (block.origin.c + j)), s: src.s };
          else next = { ...src };
          if (next) {
            if (next.s === undefined) delete next.s;
            if (next.v === undefined) delete next.v;
          }
          changes.push([key, next]);
        }
      }
    }
  }
  const grown = withSheet(wb, si, (s) => ({ ...s, rows: needRows, cols: needCols }));
  return {
    wb: setCells(grown, si, changes),
    range: {
      r1: target.r1, c1: target.c1,
      r2: Math.min(needRows - 1, target.r1 + block.rows * tileR - 1),
      c2: Math.min(needCols - 1, target.c1 + block.cols * tileC - 1),
    },
  };
}

// ---- Fill (the fill handle, Ctrl+D, Ctrl+R) ----

const TRAILING_NUMBER = /^(.*?)(\d+)$/;
const isDateStyle = (s) => s?.fmt === 'date' || s?.fmt === 'datetime';

// The value `k` steps past the end of a run of cells, continuing a series where there is one.
function continueSeries(run, k) {
  const n = run.length;
  const last = run[n - 1];
  const pattern = run[((n - 1 + k) % n + n) % n];
  if (!last || last.f !== undefined || !run.every((c) => c && c.f === undefined)) return null;
  if (run.every((c) => typeof c.v === 'number')) {
    if (n === 1) return isDateStyle(last.s) ? { ...last, v: last.v + k } : { ...last };
    const step = (run[n - 1].v - run[0].v) / (n - 1);
    return { ...pattern, v: Number((last.v + step * k).toPrecision(15)) };
  }
  const parts = run.map((c) => (typeof c.v === 'string' ? TRAILING_NUMBER.exec(c.v) : null));
  if (parts.every((p) => p && p[1] === parts[0][1])) {
    const nums = parts.map((p) => Number(p[2]));
    const step = n === 1 ? 1 : (nums[n - 1] - nums[0]) / (n - 1);
    if (Number.isInteger(step)) {
      const next = nums[n - 1] + step * k;
      if (next >= 0) return { ...pattern, v: `${parts[0][1]}${String(next).padStart(parts[n - 1][2].length, '0')}` };
    }
  }
  return null;
}

// Fills `dest` (which contains `src` and extends it in one direction) from `src`.
export function fillRange(wb, si, src, dest) {
  const sheet = wb.sheets[si];
  const vertical = dest.c1 === src.c1 && dest.c2 === src.c2;
  const forward = vertical ? dest.r2 > src.r2 : dest.c2 > src.c2;
  const changes = [];
  const lines = vertical ? [src.c1, src.c2] : [src.r1, src.r2];
  for (let line = lines[0]; line <= lines[1]; line += 1) {
    const run = [];
    const len = vertical ? src.r2 - src.r1 + 1 : src.c2 - src.c1 + 1;
    for (let i = 0; i < len; i += 1) {
      const r = vertical ? src.r1 + i : line;
      const c = vertical ? line : src.c1 + i;
      run.push(sheet.cells[cellKey(r, c)] || null);
    }
    const seq = forward ? run : [...run].reverse();
    const count = vertical ? (forward ? dest.r2 - src.r2 : src.r1 - dest.r1) : (forward ? dest.c2 - src.c2 : src.c1 - dest.c1);
    for (let k = 1; k <= count; k += 1) {
      const r = vertical ? (forward ? src.r2 + k : src.r1 - k) : line;
      const c = vertical ? line : (forward ? src.c2 + k : src.c1 - k);
      const srcIndex = (k - 1) % len;
      const from = seq[srcIndex];
      let next = continueSeries(seq, k);
      if (!next) {
        if (!from) next = null;
        else if (from.f !== undefined) {
          const fr = vertical ? (forward ? src.r1 + srcIndex : src.r2 - srcIndex) : line;
          const fc = vertical ? line : (forward ? src.c1 + srcIndex : src.c2 - srcIndex);
          next = { ...from, f: offsetFormula(from.f, r - fr, c - fc) };
        } else next = { ...from };
      }
      changes.push([cellKey(r, c), next]);
    }
  }
  return setCells(wb, si, changes);
}

// ---- Sort ----

// Sorts the rows of `range` by column `byCol`, keeping each row together.
// Blank cells go last either way. Formulas move with their rows.
export function sortRange(wb, si, range, byCol, ascending, engine, compareValues) {
  const sheet = wb.sheets[si];
  const rows = [];
  for (let r = range.r1; r <= range.r2; r += 1) rows.push(r);
  const key = (r) => {
    const v = engine.value(si, r, byCol);
    return v === null || v === '' ? null : v;
  };
  const keys = new Map(rows.map((r) => [r, key(r)]));
  const sorted = [...rows].sort((a, b) => {
    const x = keys.get(a);
    const y = keys.get(b);
    if (x === null || y === null) return (x === null) - (y === null);
    const d = compareValues(x, y);
    return ascending ? d : -d;
  });
  const changes = [];
  sorted.forEach((fromRow, i) => {
    const toRow = range.r1 + i;
    for (let c = range.c1; c <= range.c2; c += 1) {
      const cell = sheet.cells[cellKey(fromRow, c)];
      const next = cell?.f !== undefined ? { ...cell, f: offsetFormula(cell.f, toRow - fromRow, 0) } : cell || null;
      changes.push([cellKey(toRow, c), next]);
    }
  });
  return setCells(wb, si, changes);
}

// ---- Rows and columns ----

function shiftSizes(sizes, at, count, limit) {
  const out = {};
  for (const [k, v] of Object.entries(sizes)) {
    const i = Number(k);
    if (i < at) out[i] = v;
    else if (count > 0) {
      if (i + count < limit) out[i + count] = v;
    } else if (i >= at - count) out[i + count] = v;
  }
  return out;
}

// Inserts (count > 0) or deletes (count < 0) rows (axis 'r') or columns (axis 'c') at `at`.
export function shiftGrid(wb, si, axis, at, count) {
  const sheet = wb.sheets[si];
  const isRow = axis === 'r';
  const limit = isRow ? LIMITS.rows : LIMITS.cols;
  const size = isRow ? sheet.rows : sheet.cols;
  const newSize = count > 0 ? Math.min(limit, size + count) : Math.max(1, size + count);

  const cells = {};
  for (const [key, cell] of Object.entries(sheet.cells)) {
    const p = parseKey(key);
    const i = isRow ? p.r : p.c;
    let ni = i;
    if (i >= at) {
      if (count < 0 && i < at - count) continue;
      ni = i + count;
    }
    if (ni >= newSize) continue;
    cells[isRow ? cellKey(ni, p.c) : cellKey(p.r, ni)] = cell;
  }
  const updated = {
    ...sheet,
    cells,
    [isRow ? 'rows' : 'cols']: newSize,
    [isRow ? 'heights' : 'widths']: shiftSizes(isRow ? sheet.heights : sheet.widths, at, count, newSize),
  };
  const next = { ...wb, sheets: wb.sheets.map((s, i) => (i === si ? updated : s)) };
  return mapFormulas(next, (f, s) => shiftFormula(f, { axis, at, count, targetSheet: sheet.name, formulaSheet: s.name }));
}

export const resize = (wb, si, axis, indexes, px) => withSheet(wb, si, (s) => {
  const key = axis === 'r' ? 'heights' : 'widths';
  const sizes = { ...s[key] };
  for (const i of indexes) {
    if (px === null) delete sizes[i];
    else sizes[i] = Math.max(2, Math.min(2000, Math.round(px)));
  }
  return { ...s, [key]: sizes };
});

// ---- Sheets ----

export function addSheet(wb, at = wb.sheets.length) {
  if (wb.sheets.length >= LIMITS.sheets) return wb;
  const sheet = blankSheet(uniqueSheetName(wb.sheets), newSheetId(wb.sheets));
  const sheets = [...wb.sheets];
  sheets.splice(at, 0, sheet);
  return { ...wb, sheets, active: at };
}

export function renameSheet(wb, si, name) {
  const old = wb.sheets[si].name;
  const renamed = withSheet(wb, si, (s) => ({ ...s, name }));
  return mapFormulas(renamed, (f) => renameSheetInFormula(f, old, name));
}

export function deleteSheet(wb, si) {
  if (wb.sheets.length <= 1) return wb;
  const { name } = wb.sheets[si];
  const sheets = wb.sheets.filter((_, i) => i !== si);
  return mapFormulas({ ...wb, sheets, active: Math.min(si, sheets.length - 1) }, (f) => dropSheetFromFormula(f, name));
}

export function duplicateSheet(wb, si) {
  if (wb.sheets.length >= LIMITS.sheets) return wb;
  const src = wb.sheets[si];
  const copy = { ...src, id: newSheetId(wb.sheets), name: uniqueSheetName(wb.sheets, src.name), cells: { ...src.cells } };
  const sheets = [...wb.sheets];
  sheets.splice(si + 1, 0, copy);
  return { ...wb, sheets, active: si + 1 };
}

export function moveSheet(wb, from, to) {
  if (to < 0 || to >= wb.sheets.length || from === to) return wb;
  const sheets = [...wb.sheets];
  const [s] = sheets.splice(from, 1);
  sheets.splice(to, 0, s);
  return { ...wb, sheets, active: to };
}

export const setFreeze = (wb, si, rows, cols) => withSheet(wb, si, (s) => ({ ...s, freeze: { rows, cols } }));
