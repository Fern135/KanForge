import { parseInput } from './format';
import { internStyle, LIMITS } from './model';

// CSV files and tab-separated clipboard text (what Excel and Google Sheets copy).

// Picks the separator used most in the first line: comma, semicolon or tab.
function guessDelimiter(text) {
  const firstLine = text.slice(0, 5000).split(/\r?\n/, 1)[0];
  const outside = firstLine.replace(/"[^"]*"/g, '');
  const counts = [',', ';', '\t'].map((d) => [d, outside.split(d).length - 1]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] ? counts[0][0] : ',';
}

// Rows of fields. Quoted fields may hold separators, quotes ("") and line breaks.
export function parseDelimited(input, delimiter = guessDelimiter(input)) {
  const text = input.replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// Rows of text → a block of cells, reading each field as if typed.
// Returns { block, truncated }.
export function blockFromRows(rows, { maxRows = LIMITS.rows, maxCols = LIMITS.cols } = {}) {
  const truncated = rows.length > maxRows || rows.some((r) => r.length > maxCols);
  const used = rows.slice(0, maxRows);
  const cols = Math.max(1, ...used.map((r) => Math.min(r.length, maxCols)));
  const cells = used.map((r) => {
    const out = Array(cols).fill(null);
    r.slice(0, maxCols).forEach((text, j) => {
      const { cell, fmt, dp } = parseInput(text);
      if (!cell) return;
      if (typeof cell.v === 'string' && cell.v.length > LIMITS.text) cell.v = cell.v.slice(0, LIMITS.text);
      if (fmt) cell.s = internStyle({ fmt, dp });
      out[j] = cell;
    });
    return out;
  });
  return { block: { rows: Math.max(1, used.length), cols, cells: cells.length ? cells : [[null]], origin: { r: 0, c: 0 } }, truncated };
}

// Spreadsheet programs run text starting with = + - @ as a formula when
// opening a CSV, so such text gets a leading apostrophe (OWASP's advice).
const risky = (s) => /^[=+\-@\t\r]/.test(s);

function field(v, delimiter, guard) {
  let s = v;
  if (guard && risky(s) && Number.isNaN(Number(s))) s = `'${s}`;
  return /["\r\n]/.test(s) || s.includes(delimiter) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Rows of display text → CSV, or TSV for the clipboard (no apostrophes there:
// it's pasted into a spreadsheet, not opened as a file).
export function toDelimited(rows, delimiter = ',', { guard = delimiter !== '\t' } = {}) {
  return rows.map((r) => r.map((v) => field(v, delimiter, guard)).join(delimiter)).join('\r\n');
}
