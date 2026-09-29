// Reading what people type into cells, and showing values in a cell's number format.
// Dates are stored as Excel does: days since 30 Dec 1899, with the time of day as the fraction.

const DAY_MS = 86_400_000;
const EPOCH = Date.UTC(1899, 11, 30);

export const dateSerial = (y, m, d) => (Date.UTC(y, m - 1, d) - EPOCH) / DAY_MS;
export const timeSerial = (h, mi, s) => (h * 3600 + mi * 60 + s) / 86_400;

export function serialParts(serial) {
  const d = new Date(Math.round(serial * 86_400) * 1000 + EPOCH);
  return {
    y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(),
    H: d.getUTCHours(), M: d.getUTCMinutes(), S: d.getUTCSeconds(), weekday: d.getUTCDay(), date: d,
  };
}

export const nowSerial = () => {
  const n = new Date();
  return (Date.UTC(n.getFullYear(), n.getMonth(), n.getDate(), n.getHours(), n.getMinutes(), n.getSeconds()) - EPOCH) / DAY_MS;
};

// Does this browser's locale write the day before the month (28/9/2026)?
const DAY_FIRST = (() => {
  try {
    const parts = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date(2000, 10, 22));
    return parts.findIndex((p) => p.type === 'day') < parts.findIndex((p) => p.type === 'month');
  } catch {
    return false;
  }
})();

const NUMBER = /^([+-])?(\$)?\s*([+-])?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+)(?:[eE]([+-]?\d{1,3}))?\s*(%)?$/;

// "1,200.50", "$5", "-12%", "1e6" → { value, fmt, dp } or null.
export function parseNumberText(text) {
  const m = NUMBER.exec(text.trim());
  if (!m) return null;
  const [, sign1, dollar, sign2, digits, exp, percent] = m;
  if (dollar && percent) return null;
  let value = parseFloat(digits.replace(/,/g, '') + (exp ? `e${exp}` : ''));
  if (!Number.isFinite(value)) return null;
  if ((sign1 === '-') !== (sign2 === '-')) value = -value;
  const decimals = digits.includes('.') ? digits.split('.')[1].length : 0;
  if (percent) return { value: value / 100, fmt: 'percent', dp: decimals };
  if (dollar) return { value, fmt: 'currency', dp: decimals || 2 };
  if (exp) return { value, fmt: 'scientific', dp: 2 };
  if (digits.includes(',')) return { value, fmt: 'number', dp: decimals };
  return { value, fmt: null };
}

const ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;
const SLASH_DATE = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4}|\d{2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?$/;
const TIME = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?$/;

const validDate = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate() && y >= 1900 && y <= 9999;
function hours(h, ampm) {
  if (!ampm) return h;
  const pm = ampm.toLowerCase() === 'pm';
  return (h % 12) + (pm ? 12 : 0);
}

// "2026-09-28", "9/28/2026", "14:30", "2:30 PM" → { value, fmt } or null.
export function parseDateText(text) {
  const s = text.trim();
  let m = ISO_DATE.exec(s);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (!validDate(y, mo, d)) return null;
    if (m[4] === undefined) return { value: dateSerial(y, mo, d), fmt: 'date' };
    const h = Number(m[4]);
    const mi = Number(m[5]);
    const sec = Number(m[6] || 0);
    if (h > 23 || mi > 59 || sec > 59) return null;
    return { value: dateSerial(y, mo, d) + timeSerial(h, mi, sec), fmt: 'datetime' };
  }
  m = SLASH_DATE.exec(s);
  if (m) {
    let [a, b, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (m[3].length === 2) y += y < 30 ? 2000 : 1900;
    const [mo, d] = DAY_FIRST ? [b, a] : [a, b];
    if (!validDate(y, mo, d)) return null;
    if (m[4] === undefined) return { value: dateSerial(y, mo, d), fmt: 'date' };
    a = Number(m[4]);
    const h = hours(a, m[7]);
    const mi = Number(m[5]);
    const sec = Number(m[6] || 0);
    if (h > 23 || mi > 59 || sec > 59 || (m[7] && (a < 1 || a > 12))) return null;
    return { value: dateSerial(y, mo, d) + timeSerial(h, mi, sec), fmt: 'datetime' };
  }
  m = TIME.exec(s);
  if (m) {
    const raw = Number(m[1]);
    const h = hours(raw, m[4]);
    const mi = Number(m[2]);
    const sec = Number(m[3] || 0);
    if (h > 23 || mi > 59 || sec > 59 || (m[4] && (raw < 1 || raw > 12))) return null;
    return { value: timeSerial(h, mi, sec), fmt: 'time' };
  }
  return null;
}

// What typing `text` into a cell means: { cell, fmt, dp }. `cell` is null to clear it.
// A leading apostrophe keeps the rest as text, as in Excel.
export function parseInput(text) {
  if (text === '') return { cell: null };
  if (text[0] === '=' && text.length > 1) return { cell: { f: text.slice(1) } };
  if (text[0] === "'") return { cell: text.length > 1 ? { v: text.slice(1) } : null };
  const upper = text.trim().toUpperCase();
  if (upper === 'TRUE' || upper === 'FALSE') return { cell: { v: upper === 'TRUE' } };
  const num = parseNumberText(text);
  if (num) return { cell: { v: num.value }, fmt: num.fmt, dp: num.dp };
  const date = parseDateText(text);
  if (date) return { cell: { v: date.value }, fmt: date.fmt };
  return { cell: { v: text } };
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
const isoDate = (p) => `${p.y}-${pad(p.m)}-${pad(p.d)}`;

// What the formula bar shows for a cell: something that reads back the same when typed.
export function toEditText(cell) {
  if (!cell) return '';
  if (cell.f !== undefined) return `=${cell.f}`;
  const v = cell.v;
  if (v === undefined || v === null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') {
    const fmt = cell.s?.fmt;
    if (fmt === 'date' || fmt === 'datetime' || fmt === 'time') {
      const p = serialParts(v);
      const time = `${pad(p.H)}:${pad(p.M)}${p.S ? `:${pad(p.S)}` : ''}`;
      if (fmt === 'time') return time;
      return fmt === 'date' && !p.H && !p.M && !p.S ? isoDate(p) : `${isoDate(p)} ${time}`;
    }
    if (fmt === 'percent') return `${Number((v * 100).toPrecision(15))}%`;
    return String(v);
  }
  const back = parseInput(v).cell;
  return back && back.v === v ? v : `'${v}`;
}

const formatters = new Map();
function numberFormat(dp, grouping) {
  const key = `${dp}:${grouping}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp, useGrouping: grouping });
    formatters.set(key, f);
  }
  return f;
}

function exponential(n, dp) {
  const [mant, exp] = n.toExponential(dp).split('e');
  const e = Number(exp);
  return `${mant}E${e < 0 ? '-' : '+'}${pad(Math.abs(e))}`;
}

// Excel's "General" format: up to 11 characters of number, switching to E notation.
export function generalNumber(n) {
  if (Object.is(n, -0)) return '0';
  if (Number.isInteger(n) && Math.abs(n) < 1e11) return String(n);
  const abs = Math.abs(n);
  if (abs >= 1e11 || abs < 1e-5) {
    const [mant, e] = exponential(n, 5).split('E');
    return `${mant.includes('.') ? mant.replace(/\.?0+$/, '') : mant}E${e}`;
  }
  const digits = Math.max(1, 10 - Math.max(0, Math.floor(Math.log10(abs)) + 1));
  return String(Number(n.toFixed(Math.min(digits, 10))));
}

function dateText(v, fmt) {
  const p = serialParts(v);
  const opts = { timeZone: 'UTC' };
  if (fmt === 'date') return p.date.toLocaleDateString(undefined, opts);
  const time = p.date.toLocaleTimeString(undefined, { ...opts, hour: 'numeric', minute: '2-digit', second: p.S ? '2-digit' : undefined });
  if (fmt === 'time') return time;
  return `${p.date.toLocaleDateString(undefined, opts)} ${time}`;
}

export const isError = (v) => v !== null && typeof v === 'object' && typeof v.error === 'string';

// How a value shows in a cell with this format. `kind` sets the default alignment:
// numbers go right, text left, TRUE/FALSE and errors in the middle.
export function formatValue(v, style) {
  if (v === null || v === undefined || v === '') return { text: '', kind: 'empty' };
  if (isError(v)) return { text: v.error, kind: 'err' };
  if (typeof v === 'boolean') return { text: v ? 'TRUE' : 'FALSE', kind: 'bool' };
  if (typeof v === 'string') return { text: v, kind: 'text' };
  const fmt = style?.fmt || 'general';
  const dp = style?.dp;
  let text;
  switch (fmt) {
    case 'number': text = numberFormat(dp ?? 2, true).format(v); break;
    case 'currency': text = `${v < 0 ? '-' : ''}$${numberFormat(dp ?? 2, true).format(Math.abs(v))}`; break;
    case 'percent': text = `${numberFormat(dp ?? 0, true).format(v * 100)}%`; break;
    case 'scientific': text = exponential(v, dp ?? 2); break;
    case 'date': case 'time': case 'datetime': text = v >= 0 && v < 2_958_466 ? dateText(v, fmt) : '#####'; break;
    case 'text': text = generalNumber(v); break;
    default: text = dp !== undefined ? numberFormat(dp, false).format(v) : generalNumber(v);
  }
  return { text, kind: fmt === 'text' ? 'text' : 'num' };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// The TEXT() function's format codes: the common ones ("0.00", "#,##0", "0%",
// "$#,##0.00", "yyyy-mm-dd", "mmm d, yyyy", "dddd", "h:mm AM/PM").
export function formatWithPattern(v, pattern) {
  if (typeof v !== 'number') return String(v);
  if (/[yd]|m{3,}|h|s/i.test(pattern.replace(/"[^"]*"/g, ''))) {
    const p = serialParts(v);
    const ampm = /AM\/PM/i.test(pattern);
    const h12 = p.H % 12 || 12;
    return pattern.replace(/"([^"]*)"|yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d|hh|h|ss|s|AM\/PM/gi, (tok, lit, offset, str) => {
      if (lit !== undefined) return lit;
      const t = tok.toLowerCase();
      // "m" right after an hour or before seconds means minutes.
      const minute = (t === 'm' || t === 'mm') && (/h+[^a-z]*$/i.test(str.slice(0, offset)) || /^[^a-z]*s/i.test(str.slice(offset + tok.length)));
      switch (t) {
        case 'yyyy': return String(p.y);
        case 'yy': return pad(p.y % 100);
        case 'mmmm': return MONTHS[p.m - 1];
        case 'mmm': return MONTHS[p.m - 1].slice(0, 3);
        case 'mm': return minute ? pad(p.M) : pad(p.m);
        case 'm': return minute ? String(p.M) : String(p.m);
        case 'dddd': return DAYS[p.weekday];
        case 'ddd': return DAYS[p.weekday].slice(0, 3);
        case 'dd': return pad(p.d);
        case 'd': return String(p.d);
        case 'hh': return pad(ampm ? h12 : p.H);
        case 'h': return String(ampm ? h12 : p.H);
        case 'ss': return pad(p.S);
        case 's': return String(p.S);
        case 'am/pm': return p.H < 12 ? 'AM' : 'PM';
        default: return tok;
      }
    });
  }
  const m = /^([^0#]*)([#0,]*0?)(?:\.([0#]+))?([^0#]*)$/.exec(pattern);
  if (!m) return generalNumber(v);
  const [, prefix, whole, frac = '', suffix] = m;
  let n = v;
  if (suffix.includes('%')) n *= 100;
  // "0" places always show; "#" places only when they're not trailing zeros.
  const minDp = (frac.match(/0/g) || []).length;
  let [int, dec = ''] = numberFormat(frac.length, whole.includes(',')).format(Math.abs(n)).split('.');
  dec = dec.replace(/0+$/, '').padEnd(minDp, '0');
  if (!whole.includes('0') && int === '0' && dec) int = '';
  const body = dec ? `${int}.${dec}` : int;
  return `${n < 0 ? '-' : ''}${prefix.replace(/"/g, '')}${body}${suffix.replace(/"/g, '')}`;
}
