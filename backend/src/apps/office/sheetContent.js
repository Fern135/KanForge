'use strict';

const AppError = require('../../core/utils/AppError');
const { int, oneOf, isObject } = require('../../core/services/richText');
const { FONTS } = require('./docContent');

// A Sheets workbook, as the editor saves it (frontend apps/office/sheets/model.js).
// Change both together.
//
// {
//   sheets: [{ id, name, rows, cols, widths: { col: px }, heights: { row: px },
//              freeze: { rows, cols }, cells: { A1: { v, f, s } } }],
//   styles: [{ b, i, u, s, font, size, color, fill, h, v, wrap, fmt, dp, bt, br, bb, bl }],
//   active: sheet index,
// }
//
// A cell holds a value `v` (number, text or true/false) or a formula `f`
// (without the leading "="), plus `s`, an index into `styles`. Formulas are
// only text here: they're worked out in the browser and never run on the server.

const LIMITS = {
  sheets: 50,
  rows: 10_000,
  cols: 200,
  cells: 100_000,
  styles: 2_000,
  text: 10_000,
  formula: 4_000,
  jsonBytes: 3_000_000,
  searchText: 1_000_000,
};
const DEFAULT_ROWS = 1000;
const DEFAULT_COLS = 26;

const COLOR = /^#[0-9a-f]{6}$/i;
const CELL = /^([A-Z]{1,2})([1-9]\d{0,4})$/;
const SHEET_ID = /^[a-z0-9]{1,16}$/;
// Characters Excel doesn't allow in sheet names.
const BAD_NAME = /[[\]:*?/\\\u0000-\u001f]/;
const FORMATS = ['general', 'number', 'currency', 'percent', 'scientific', 'date', 'time', 'datetime', 'text'];

const bad = (msg) => AppError.badRequest(msg, 'INVALID_CONTENT');

// "A" → 0, "Z" → 25, "AA" → 26.
function colIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function cleanStyle(raw) {
  const s = isObject(raw) ? raw : {};
  const out = {};
  for (const flag of ['b', 'i', 'u', 's', 'wrap', 'bt', 'br', 'bb', 'bl']) if (s[flag] === true) out[flag] = true;
  if (FONTS.includes(s.font)) out.font = s.font;
  if (typeof s.size === 'number' && s.size >= 6 && s.size <= 96) out.size = Math.round(s.size * 2) / 2;
  if (typeof s.color === 'string' && COLOR.test(s.color)) out.color = s.color.toLowerCase();
  if (typeof s.fill === 'string' && COLOR.test(s.fill)) out.fill = s.fill.toLowerCase();
  const h = oneOf(s.h, ['left', 'center', 'right']);
  if (h) out.h = h;
  const v = oneOf(s.v, ['top', 'middle', 'bottom']);
  if (v) out.v = v;
  const fmt = oneOf(s.fmt, FORMATS);
  if (fmt && fmt !== 'general') out.fmt = fmt;
  if (Number.isInteger(s.dp) && s.dp >= 0 && s.dp <= 10) out.dp = s.dp;
  return out;
}

// { "3": 120 } with whole-number keys below `count` and sizes in range.
function cleanSizes(raw, count, min, max) {
  const out = {};
  if (!isObject(raw)) return out;
  for (const [k, v] of Object.entries(raw).slice(0, count)) {
    const i = Number(k);
    if (Number.isInteger(i) && i >= 0 && i < count && Number.isInteger(v) && v >= min && v <= max) out[i] = v;
  }
  return out;
}

function uniqueName(name, taken) {
  let candidate = name;
  for (let n = 2; taken.has(candidate.toLowerCase()); n += 1) candidate = `${name.slice(0, 26)} (${n})`;
  taken.add(candidate.toLowerCase());
  return candidate;
}

function sanitizeSheetContent(input) {
  if (!isObject(input) || !Array.isArray(input.sheets)) throw bad('Spreadsheet content must be a workbook');
  if (!input.sheets.length) throw bad('A spreadsheet needs at least one sheet');
  if (input.sheets.length > LIMITS.sheets) throw bad(`A spreadsheet can have up to ${LIMITS.sheets} sheets`);
  if (JSON.stringify(input).length > LIMITS.jsonBytes) throw bad('This spreadsheet is too large to save');

  const rawStyles = Array.isArray(input.styles) ? input.styles : [];
  if (rawStyles.length > LIMITS.styles) throw bad('This spreadsheet uses too many different formats');
  const styles = rawStyles.map(cleanStyle);

  const ids = new Set();
  const names = new Set();
  const text = [];
  let textLength = 0;
  let cellCount = 0;
  const addText = (t) => {
    if (textLength >= LIMITS.searchText) return;
    text.push(t);
    textLength += t.length + 1;
  };

  const sheets = input.sheets.map((raw, index) => {
    const sheet = isObject(raw) ? raw : {};
    let id = typeof sheet.id === 'string' && SHEET_ID.test(sheet.id) && !ids.has(sheet.id) ? sheet.id : null;
    for (let n = index + 1; !id; n += 1) if (!ids.has(`s${n}`)) id = `s${n}`;
    ids.add(id);

    let name = typeof sheet.name === 'string' ? sheet.name.trim().slice(0, 31) : '';
    if (!name || BAD_NAME.test(name) || name.startsWith("'") || name.endsWith("'")) name = `Sheet${index + 1}`;
    name = uniqueName(name, names);
    addText(name);

    const rows = int(sheet.rows, 1, LIMITS.rows, DEFAULT_ROWS);
    const cols = int(sheet.cols, 1, LIMITS.cols, DEFAULT_COLS);
    const freeze = isObject(sheet.freeze) ? sheet.freeze : {};

    const cells = {};
    if (isObject(sheet.cells)) {
      for (const [key, rawCell] of Object.entries(sheet.cells)) {
        const m = CELL.exec(key);
        if (!m || colIndex(m[1]) >= cols || Number(m[2]) > rows || !isObject(rawCell)) continue;
        const cell = {};
        if (typeof rawCell.f === 'string' && rawCell.f.trim()) {
          if (rawCell.f.length > LIMITS.formula) throw bad(`Formulas can be up to ${LIMITS.formula} characters`);
          cell.f = rawCell.f;
        } else if (typeof rawCell.v === 'number' && Number.isFinite(rawCell.v)) {
          cell.v = rawCell.v;
          addText(String(rawCell.v));
        } else if (typeof rawCell.v === 'boolean') {
          cell.v = rawCell.v;
        } else if (typeof rawCell.v === 'string' && rawCell.v) {
          if (rawCell.v.length > LIMITS.text) throw bad(`A cell can hold up to ${LIMITS.text.toLocaleString('en-US')} characters`);
          cell.v = rawCell.v;
          addText(rawCell.v);
        }
        if (Number.isInteger(rawCell.s) && rawCell.s >= 0 && rawCell.s < styles.length && Object.keys(styles[rawCell.s]).length) cell.s = rawCell.s;
        if (!Object.keys(cell).length) continue;
        cellCount += 1;
        if (cellCount > LIMITS.cells) throw bad(`A spreadsheet can have up to ${LIMITS.cells.toLocaleString('en-US')} filled cells`);
        cells[key] = cell;
      }
    }

    return {
      id,
      name,
      rows,
      cols,
      widths: cleanSizes(sheet.widths, cols, 2, 2000),
      heights: cleanSizes(sheet.heights, rows, 2, 2000),
      freeze: { rows: int(freeze.rows, 0, 50, 0), cols: int(freeze.cols, 0, 20, 0) },
      cells,
    };
  });

  const doc = { sheets, styles, active: int(input.active, 0, sheets.length - 1, 0) };
  return { doc, text: text.join('\n').slice(0, LIMITS.searchText), imageIds: [] };
}

const emptyWorkbook = () => ({
  sheets: [{ id: 's1', name: 'Sheet1', rows: DEFAULT_ROWS, cols: DEFAULT_COLS, widths: {}, heights: {}, freeze: { rows: 0, cols: 0 }, cells: {} }],
  styles: [],
  active: 0,
});

// Printing: Excel's "Normal" margins (0.75" top and bottom, 0.7" at the sides).
const SHEET_SETTINGS = Object.freeze({
  pageSize: 'letter',
  orientation: 'portrait',
  margins: { top: 19.1, right: 17.8, bottom: 19.1, left: 17.8 },
});

module.exports = { sanitizeSheetContent, emptyWorkbook, SHEET_SETTINGS, SHEET_LIMITS: LIMITS };
