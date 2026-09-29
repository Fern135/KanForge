import { parseNumberText, parseDateText, generalNumber } from '../format';

// Values in formulas: numbers, text, TRUE/FALSE, null (an empty cell), error
// values like { error: '#DIV/0!' }, and Range (a block of cells, read lazily).

const make = (code) => Object.freeze({ error: code });
export const ERR = {
  DIV0: make('#DIV/0!'),
  NA: make('#N/A'),
  NAME: make('#NAME?'),
  NUM: make('#NUM!'),
  REF: make('#REF!'),
  VALUE: make('#VALUE!'),
  NULL: make('#NULL!'),
  CIRC: make('#CIRC!'),
  SYNTAX: make('#ERROR!'),
};
const BY_CODE = Object.fromEntries(Object.values(ERR).map((e) => [e.error, e]));
export const errorFor = (code) => BY_CODE[code] ?? ERR.VALUE;
export const isErr = (v) => v !== null && typeof v === 'object' && typeof v.error === 'string';

export class Range {
  constructor(engine, sheet, r1, c1, r2, c2) {
    Object.assign(this, { engine, sheet, r1, c1, r2, c2 });
  }

  get rows() {
    return this.r2 - this.r1 + 1;
  }

  get cols() {
    return this.c2 - this.c1 + 1;
  }

  get(i, j) {
    return this.engine.cellValue(this.sheet, this.r1 + i, this.c1 + j);
  }

  // Row by row, skipping the empty rows and columns past the end of the sheet's data.
  *values() {
    const { maxR, maxC } = this.engine.extent(this.sheet);
    const r2 = Math.min(this.r2, maxR);
    const c2 = Math.min(this.c2, maxC);
    for (let r = this.r1; r <= r2; r += 1) {
      for (let c = this.c1; c <= c2; c += 1) yield this.engine.cellValue(this.sheet, r, c);
    }
  }

  // Every cell, blanks included, as rows of values.
  matrix() {
    const out = [];
    for (let i = 0; i < this.rows; i += 1) {
      const row = [];
      for (let j = 0; j < this.cols; j += 1) row.push(this.get(i, j));
      out.push(row);
    }
    return out;
  }
}

// A single value from an argument: a one-cell range becomes its value, and an error is thrown.
export function scalar(v) {
  let x = v;
  if (x instanceof Range) {
    if (x.rows !== 1 || x.cols !== 1) throw ERR.VALUE;
    x = x.get(0, 0);
  }
  if (isErr(x)) throw x;
  return x;
}

export function toNumber(v) {
  const x = scalar(v);
  if (typeof x === 'number') return x;
  if (x === null || x === undefined) return 0;
  if (typeof x === 'boolean') return x ? 1 : 0;
  const s = String(x).trim();
  if (s === '') return 0;
  const n = parseNumberText(s) ?? parseDateText(s);
  if (!n) throw ERR.VALUE;
  return n.value;
}

export function toText(v) {
  const x = scalar(v);
  if (x === null || x === undefined) return '';
  if (typeof x === 'boolean') return x ? 'TRUE' : 'FALSE';
  if (typeof x === 'number') return generalNumber(x);
  return String(x);
}

export function toBool(v) {
  const x = scalar(v);
  if (typeof x === 'boolean') return x;
  if (typeof x === 'number') return x !== 0;
  if (x === null || x === undefined) return false;
  const s = String(x).toUpperCase();
  if (s === 'TRUE') return true;
  if (s === 'FALSE') return false;
  throw ERR.VALUE;
}

// Orders values the way Excel does: numbers, then text (ignoring case), then TRUE/FALSE.
const rank = (v) => (typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : typeof v === 'boolean' ? 2 : 3);
export function compare(a, b) {
  let x = a;
  let y = b;
  if (x === null || x === undefined) x = typeof y === 'string' ? '' : typeof y === 'boolean' ? false : 0;
  if (y === null || y === undefined) y = typeof x === 'string' ? '' : typeof x === 'boolean' ? false : 0;
  const rx = rank(x);
  const ry = rank(y);
  if (rx !== ry) return rx - ry;
  if (rx === 1) {
    const s = x.toLowerCase();
    const t = y.toLowerCase();
    return s < t ? -1 : s > t ? 1 : 0;
  }
  if (rx === 2) return Number(x) - Number(y);
  return x < y ? -1 : x > y ? 1 : 0;
}
