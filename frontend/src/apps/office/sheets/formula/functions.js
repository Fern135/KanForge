import { ERR, Range, isErr, scalar, toNumber, toText, toBool, compare } from './values';
import { dateSerial, timeSerial, serialParts, nowSerial, parseNumberText, parseDateText, formatWithPattern } from '../format';

// Excel's worksheet functions. Most take their arguments already worked out
// (ranges stay as Range); `lazy` ones get the argument trees and work out only
// what they need, like IF. A function signals an error by throwing an error value.

const FNS = {};
const def = (names, fn, opts = {}) => {
  for (const n of names.split(' ')) FNS[n] = { fn, ...opts };
};
const lazy = (names, fn) => def(names, fn, { lazy: true });

const arity = (args, min, max = min) => {
  if (args.length < min || args.length > max) throw ERR.VALUE;
};
const opt = (args, i, fallback, conv = toNumber) => (args[i] === undefined || args[i] === null ? fallback : conv(args[i]));

// Every value in the arguments, ranges flattened.
function* flat(args) {
  for (const a of args) {
    if (a instanceof Range) yield* a.values();
    else yield a;
  }
}

// Numbers for SUM, AVERAGE and friends: in ranges only real numbers count;
// typed-in arguments are converted ("5", TRUE). Errors stop the calculation.
function numbers(args) {
  const out = [];
  for (const a of args) {
    if (a instanceof Range) {
      for (const v of a.values()) {
        if (isErr(v)) throw v;
        if (typeof v === 'number') out.push(v);
      }
    } else if (a !== null && a !== undefined) {
      out.push(toNumber(a));
    }
  }
  return out;
}

const sum = (xs) => xs.reduce((s, x) => s + x, 0);
const mean = (xs) => {
  if (!xs.length) throw ERR.DIV0;
  return sum(xs) / xs.length;
};
const variance = (xs, sample) => {
  if (xs.length < (sample ? 2 : 1)) throw ERR.DIV0;
  const m = mean(xs);
  return sum(xs.map((x) => (x - m) ** 2)) / (xs.length - (sample ? 1 : 0));
};
const checkNum = (n) => {
  if (!Number.isFinite(n)) throw ERR.NUM;
  return n;
};

// Excel rounds halves away from zero.
export function roundTo(n, digits, mode = 'nearest') {
  const f = 10 ** digits;
  const x = Math.abs(n) * f;
  const fixed = Number(x.toPrecision(15));
  const r = mode === 'up' ? Math.ceil(fixed) : mode === 'down' ? Math.floor(fixed) : Math.round(fixed);
  return (Math.sign(n) * r) / f;
}

// A range argument (or a single value, as a 1×1 block) as rows of values.
const matrixOf = (a) => (a instanceof Range ? a.matrix() : [[scalar(a)]]);

// ---- Criteria (COUNTIF, SUMIF, ...): 5, ">5", "<>done", "a*", "" ----

const wildcard = (s) => new RegExp(`^${s.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/~\*/g, '\u0001').replace(/~\?/g, '\u0002')
  .replace(/\*/g, '.*').replace(/\?/g, '.').replace(/\u0001/g, '\\*').replace(/\u0002/g, '\\?')}$`, 'is');

export function criterion(c) {
  const x = scalar(c);
  if (typeof x === 'number') return (v) => typeof v === 'number' && v === x;
  if (typeof x === 'boolean') return (v) => v === x;
  const s = x === null || x === undefined ? '' : String(x);
  const op = /^(<=|>=|<>|<|>|=)/.exec(s)?.[1] ?? '';
  const rest = s.slice(op.length);
  const num = rest.trim() === '' ? null : parseNumberText(rest) ?? parseDateText(rest);
  if (num) {
    const n = num.value;
    const test = { '': (v) => v === n, '=': (v) => v === n, '<>': (v) => v !== n, '<': (v) => v < n, '>': (v) => v > n, '<=': (v) => v <= n, '>=': (v) => v >= n }[op];
    return op === '<>' ? (v) => typeof v !== 'number' || test(v) : (v) => typeof v === 'number' && test(v);
  }
  if (rest === '') {
    if (op === '<>') return (v) => v !== null && v !== '';
    return (v) => v === null || v === '';
  }
  const upper = rest.toUpperCase();
  if (upper === 'TRUE' || upper === 'FALSE') {
    const b = upper === 'TRUE';
    return op === '<>' ? (v) => v !== b : (v) => v === b;
  }
  if (op === '' || op === '=' || op === '<>') {
    const re = wildcard(rest);
    const match = (v) => typeof v === 'string' && re.test(v);
    return op === '<>' ? (v) => !match(v) : match;
  }
  return (v) => {
    if (typeof v !== 'string') return false;
    const d = compare(v, rest);
    return { '<': d < 0, '>': d > 0, '<=': d <= 0, '>=': d >= 0 }[op];
  };
}

// Cells of `ranges[0]` (and the same positions in the other criteria ranges)
// that meet every criterion, as [row, col] offsets.
function matching(pairs) {
  const [first] = pairs;
  const out = [];
  if (!(first.range instanceof Range)) throw ERR.VALUE;
  const { rows, cols } = first.range;
  for (const p of pairs) {
    if (!(p.range instanceof Range) || p.range.rows !== rows || p.range.cols !== cols) throw ERR.VALUE;
    p.test = criterion(p.crit);
  }
  const { maxR } = first.range.engine.extent(first.range.sheet);
  const lastRow = Math.min(rows - 1, maxR - first.range.r1);
  for (let i = 0; i <= lastRow; i += 1) {
    for (let j = 0; j < cols; j += 1) {
      if (pairs.every((p) => {
        const v = p.range.get(i, j);
        return !isErr(v) && p.test(v);
      })) out.push([i, j]);
    }
  }
  return out;
}

function ifsArgs(args, withTarget) {
  const target = withTarget ? args[0] : null;
  const rest = withTarget ? args.slice(1) : args;
  if (!rest.length || rest.length % 2) throw ERR.VALUE;
  const pairs = [];
  for (let i = 0; i < rest.length; i += 2) pairs.push({ range: rest[i], crit: rest[i + 1] });
  return { target, pairs };
}

function valuesAt(range, cells) {
  const out = [];
  for (const [i, j] of cells) {
    const v = range.get(i, j);
    if (isErr(v)) throw v;
    if (typeof v === 'number') out.push(v);
  }
  return out;
}

// ---- Math ----

def('SUM', (a) => sum(numbers(a)));
def('PRODUCT', (a) => numbers(a).reduce((p, x) => p * x, 1));
def('SUMSQ', (a) => sum(numbers(a).map((x) => x * x)));
def('AVERAGE', (a) => mean(numbers(a)));
def('AVERAGEA', (a) => mean([...flat(a)].filter((v) => v !== null).map((v) => (typeof v === 'number' ? v : typeof v === 'boolean' ? Number(v) : isErr(v) ? (() => { throw v; })() : 0))));
def('MIN', (a) => {
  const xs = numbers(a);
  return xs.length ? Math.min(...xs) : 0;
});
def('MAX', (a) => {
  const xs = numbers(a);
  return xs.length ? Math.max(...xs) : 0;
});
def('COUNT', (a) => {
  let n = 0;
  for (const x of a) {
    if (x instanceof Range) {
      for (const v of x.values()) if (typeof v === 'number') n += 1;
    } else if (typeof x === 'number' || (typeof x === 'string' && parseNumberText(x))) n += 1;
  }
  return n;
});
def('COUNTA', (a) => {
  let n = 0;
  for (const v of flat(a)) if (v !== null && v !== undefined && v !== '') n += 1;
  return n;
});
def('COUNTBLANK', (a) => {
  arity(a, 1);
  const r = a[0];
  if (!(r instanceof Range)) throw ERR.VALUE;
  let filled = 0;
  for (const v of r.values()) if (v !== null && v !== '') filled += 1;
  return r.rows * r.cols - filled;
});
def('ABS', (a) => (arity(a, 1), Math.abs(toNumber(a[0]))));
def('ROUND', (a) => (arity(a, 1, 2), roundTo(toNumber(a[0]), Math.trunc(opt(a, 1, 0)))));
def('ROUNDUP', (a) => (arity(a, 1, 2), roundTo(toNumber(a[0]), Math.trunc(opt(a, 1, 0)), 'up')));
def('ROUNDDOWN', (a) => (arity(a, 1, 2), roundTo(toNumber(a[0]), Math.trunc(opt(a, 1, 0)), 'down')));
def('INT', (a) => (arity(a, 1), Math.floor(toNumber(a[0]))));
def('TRUNC', (a) => (arity(a, 1, 2), roundTo(toNumber(a[0]), Math.trunc(opt(a, 1, 0)), 'down')));
def('MOD', (a) => {
  arity(a, 2);
  const n = toNumber(a[0]);
  const d = toNumber(a[1]);
  if (d === 0) throw ERR.DIV0;
  return n - d * Math.floor(n / d);
});
def('QUOTIENT', (a) => {
  arity(a, 2);
  const d = toNumber(a[1]);
  if (d === 0) throw ERR.DIV0;
  return Math.trunc(toNumber(a[0]) / d);
});
def('POWER', (a) => (arity(a, 2), checkNum(toNumber(a[0]) ** toNumber(a[1]))));
def('SQRT', (a) => {
  arity(a, 1);
  const n = toNumber(a[0]);
  if (n < 0) throw ERR.NUM;
  return Math.sqrt(n);
});
def('EXP', (a) => (arity(a, 1), checkNum(Math.exp(toNumber(a[0])))));
def('LN', (a) => {
  arity(a, 1);
  const n = toNumber(a[0]);
  if (n <= 0) throw ERR.NUM;
  return Math.log(n);
});
def('LOG', (a) => {
  arity(a, 1, 2);
  const n = toNumber(a[0]);
  const base = opt(a, 1, 10);
  if (n <= 0 || base <= 0 || base === 1) throw ERR.NUM;
  return Math.log(n) / Math.log(base);
});
def('LOG10', (a) => {
  arity(a, 1);
  const n = toNumber(a[0]);
  if (n <= 0) throw ERR.NUM;
  return Math.log10(n);
});
def('PI', (a) => (arity(a, 0), Math.PI));
def('RAND', (a) => (arity(a, 0), Math.random()), { volatile: true });
def('RANDBETWEEN', (a) => {
  arity(a, 2);
  const lo = Math.ceil(toNumber(a[0]));
  const hi = Math.floor(toNumber(a[1]));
  if (hi < lo) throw ERR.NUM;
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}, { volatile: true });
def('SIGN', (a) => (arity(a, 1), Math.sign(toNumber(a[0]))));
def('CEILING CEILING.MATH', (a) => {
  arity(a, 1, 3);
  const n = toNumber(a[0]);
  const s = Math.abs(opt(a, 1, 1));
  return s === 0 ? 0 : Math.ceil(Number((n / s).toPrecision(15))) * s;
});
def('FLOOR FLOOR.MATH', (a) => {
  arity(a, 1, 3);
  const n = toNumber(a[0]);
  const s = Math.abs(opt(a, 1, 1));
  return s === 0 ? 0 : Math.floor(Number((n / s).toPrecision(15))) * s;
});
def('MROUND', (a) => {
  arity(a, 2);
  const m = toNumber(a[1]);
  return m === 0 ? 0 : roundTo(toNumber(a[0]) / m, 0) * m;
});
def('EVEN', (a) => {
  const n = toNumber(a[0]);
  const up = Math.ceil(Math.abs(n) / 2) * 2;
  return n < 0 ? -up : up;
});
def('ODD', (a) => {
  const n = toNumber(a[0]);
  let up = Math.ceil(Math.abs(n));
  if (up % 2 === 0) up += 1;
  return n < 0 ? -up : up;
});
def('FACT', (a) => {
  const n = Math.floor(toNumber(a[0]));
  if (n < 0 || n > 170) throw ERR.NUM;
  let f = 1;
  for (let i = 2; i <= n; i += 1) f *= i;
  return f;
});
const gcd2 = (x, y) => (y ? gcd2(y, x % y) : x);
def('GCD', (a) => numbers(a).map((x) => Math.floor(Math.abs(x))).reduce(gcd2, 0));
def('LCM', (a) => numbers(a).map((x) => Math.floor(Math.abs(x))).reduce((l, x) => (l && x ? (l * x) / gcd2(l, x) : 0), 1));
def('SUMPRODUCT', (a) => {
  if (!a.length) throw ERR.VALUE;
  const ms = a.map(matrixOf);
  const [rows, cols] = [ms[0].length, ms[0][0].length];
  if (ms.some((m) => m.length !== rows || m[0].length !== cols)) throw ERR.VALUE;
  let total = 0;
  for (let i = 0; i < rows; i += 1) {
    for (let j = 0; j < cols; j += 1) {
      let p = 1;
      for (const m of ms) {
        const v = m[i][j];
        if (isErr(v)) throw v;
        p *= typeof v === 'number' ? v : 0;
      }
      total += p;
    }
  }
  return total;
});

// ---- Statistics ----

def('MEDIAN', (a) => {
  const xs = numbers(a).sort((x, y) => x - y);
  if (!xs.length) throw ERR.NUM;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
});
def('MODE MODE.SNGL', (a) => {
  const counts = new Map();
  let best = null;
  let bestN = 1;
  for (const x of numbers(a)) {
    const n = (counts.get(x) || 0) + 1;
    counts.set(x, n);
    if (n > bestN) {
      best = x;
      bestN = n;
    }
  }
  if (best === null) throw ERR.NA;
  return best;
});
def('STDEV STDEV.S', (a) => Math.sqrt(variance(numbers(a), true)));
def('STDEVP STDEV.P', (a) => Math.sqrt(variance(numbers(a), false)));
def('VAR VAR.S', (a) => variance(numbers(a), true));
def('VARP VAR.P', (a) => variance(numbers(a), false));
def('LARGE', (a) => {
  arity(a, 2);
  const xs = numbers([a[0]]).sort((x, y) => y - x);
  const k = Math.ceil(toNumber(a[1]));
  if (k < 1 || k > xs.length) throw ERR.NUM;
  return xs[k - 1];
});
def('SMALL', (a) => {
  arity(a, 2);
  const xs = numbers([a[0]]).sort((x, y) => x - y);
  const k = Math.ceil(toNumber(a[1]));
  if (k < 1 || k > xs.length) throw ERR.NUM;
  return xs[k - 1];
});
def('RANK RANK.EQ', (a) => {
  arity(a, 2, 3);
  const n = toNumber(a[0]);
  const xs = numbers([a[1]]);
  const asc = opt(a, 2, 0) !== 0;
  if (!xs.includes(n)) throw ERR.NA;
  return 1 + xs.filter((x) => (asc ? x < n : x > n)).length;
});
def('COUNTIF', (a) => (arity(a, 2), matching([{ range: a[0], crit: a[1] }]).length));
def('COUNTIFS', (a) => matching(ifsArgs(a, false).pairs).length);
def('SUMIF', (a) => {
  arity(a, 2, 3);
  const cells = matching([{ range: a[0], crit: a[1] }]);
  return sum(valuesAt(a[2] instanceof Range ? a[2] : a[0], cells));
});
def('SUMIFS', (a) => {
  const { target, pairs } = ifsArgs(a, true);
  if (!(target instanceof Range)) throw ERR.VALUE;
  return sum(valuesAt(target, matching(pairs)));
});
def('AVERAGEIF', (a) => {
  arity(a, 2, 3);
  const cells = matching([{ range: a[0], crit: a[1] }]);
  return mean(valuesAt(a[2] instanceof Range ? a[2] : a[0], cells));
});
def('AVERAGEIFS', (a) => {
  const { target, pairs } = ifsArgs(a, true);
  if (!(target instanceof Range)) throw ERR.VALUE;
  return mean(valuesAt(target, matching(pairs)));
});
def('MAXIFS', (a) => {
  const { target, pairs } = ifsArgs(a, true);
  const xs = valuesAt(target, matching(pairs));
  return xs.length ? Math.max(...xs) : 0;
});
def('MINIFS', (a) => {
  const { target, pairs } = ifsArgs(a, true);
  const xs = valuesAt(target, matching(pairs));
  return xs.length ? Math.min(...xs) : 0;
});

// ---- Logic ----

lazy('IF', (nodes, ctx) => {
  if (nodes.length < 1 || nodes.length > 3) throw ERR.VALUE;
  const test = toBool(ctx.arg(nodes[0]));
  const branch = nodes[test ? 1 : 2];
  if (!branch) return test;
  return branch.t === 'empty' ? 0 : ctx.arg(branch);
});
lazy('IFS', (nodes, ctx) => {
  if (!nodes.length || nodes.length % 2) throw ERR.VALUE;
  for (let i = 0; i < nodes.length; i += 2) if (toBool(ctx.arg(nodes[i]))) return ctx.arg(nodes[i + 1]);
  throw ERR.NA;
});
lazy('IFERROR', (nodes, ctx) => {
  if (nodes.length !== 2) throw ERR.VALUE;
  const v = ctx.arg(nodes[0]);
  const x = v instanceof Range && v.rows === 1 && v.cols === 1 ? v.get(0, 0) : v;
  return isErr(x) ? ctx.arg(nodes[1]) : v;
});
lazy('IFNA', (nodes, ctx) => {
  if (nodes.length !== 2) throw ERR.VALUE;
  const v = ctx.arg(nodes[0]);
  const x = v instanceof Range && v.rows === 1 && v.cols === 1 ? v.get(0, 0) : v;
  return isErr(x) && x.error === '#N/A' ? ctx.arg(nodes[1]) : v;
});
lazy('SWITCH', (nodes, ctx) => {
  if (nodes.length < 3) throw ERR.VALUE;
  const v = scalar(ctx.arg(nodes[0]));
  let i = 1;
  for (; i + 1 < nodes.length; i += 2) if (compare(v, scalar(ctx.arg(nodes[i]))) === 0) return ctx.arg(nodes[i + 1]);
  if (i < nodes.length) return ctx.arg(nodes[i]);
  throw ERR.NA;
});
lazy('CHOOSE', (nodes, ctx) => {
  if (nodes.length < 2) throw ERR.VALUE;
  const i = Math.trunc(toNumber(ctx.arg(nodes[0])));
  if (i < 1 || i >= nodes.length) throw ERR.VALUE;
  return ctx.arg(nodes[i]);
});
function logicals(args) {
  const out = [];
  for (const a of args) {
    if (a instanceof Range) {
      for (const v of a.values()) {
        if (isErr(v)) throw v;
        if (typeof v === 'boolean' || typeof v === 'number') out.push(Boolean(v));
      }
    } else out.push(toBool(a));
  }
  if (!out.length) throw ERR.VALUE;
  return out;
}
def('AND', (a) => logicals(a).every(Boolean));
def('OR', (a) => logicals(a).some(Boolean));
def('XOR', (a) => logicals(a).filter(Boolean).length % 2 === 1);
def('NOT', (a) => (arity(a, 1), !toBool(a[0])));
def('TRUE', () => true);
def('FALSE', () => false);
def('NA', () => {
  throw ERR.NA;
});

// ---- Information ----

const one = (a) => {
  arity(a, 1);
  const v = a[0];
  return v instanceof Range ? v.get(0, 0) : v;
};
def('ISBLANK', (a) => {
  const v = one(a);
  return v === null || v === undefined;
});
def('ISNUMBER', (a) => typeof one(a) === 'number');
def('ISTEXT', (a) => typeof one(a) === 'string');
def('ISNONTEXT', (a) => typeof one(a) !== 'string');
def('ISLOGICAL', (a) => typeof one(a) === 'boolean');
def('ISERROR', (a) => isErr(one(a)));
def('ISERR', (a) => {
  const v = one(a);
  return isErr(v) && v.error !== '#N/A';
});
def('ISNA', (a) => {
  const v = one(a);
  return isErr(v) && v.error === '#N/A';
});
def('ISEVEN', (a) => Math.floor(Math.abs(toNumber(a[0]))) % 2 === 0);
def('ISODD', (a) => Math.floor(Math.abs(toNumber(a[0]))) % 2 === 1);
def('N', (a) => {
  const v = one(a);
  if (isErr(v)) throw v;
  return typeof v === 'number' ? v : typeof v === 'boolean' ? Number(v) : 0;
});
def('T', (a) => {
  const v = one(a);
  if (isErr(v)) throw v;
  return typeof v === 'string' ? v : '';
});
lazy('ROW', (nodes, ctx) => {
  if (!nodes.length) return ctx.row + 1;
  const n = nodes[0];
  if (n.t !== 'ref') throw ERR.VALUE;
  return n.ref.kind === 'cols' ? 1 : Math.min(n.ref.a.r, n.ref.b?.r ?? n.ref.a.r) + 1;
});
lazy('COLUMN', (nodes, ctx) => {
  if (!nodes.length) return ctx.col + 1;
  const n = nodes[0];
  if (n.t !== 'ref') throw ERR.VALUE;
  return n.ref.kind === 'rows' ? 1 : Math.min(n.ref.a.c, n.ref.b?.c ?? n.ref.a.c) + 1;
});
def('ROWS', (a) => (a[0] instanceof Range ? a[0].rows : 1));
def('COLUMNS', (a) => (a[0] instanceof Range ? a[0].cols : 1));

// ---- Text ----

def('CONCAT', (a) => {
  let s = '';
  for (const v of flat(a)) s += toText(v);
  return s;
});
def('CONCATENATE', (a) => a.map(toText).join(''));
def('TEXTJOIN', (a) => {
  if (a.length < 3) throw ERR.VALUE;
  const sep = toText(a[0]);
  const skip = toBool(a[1]);
  const parts = [];
  for (const v of flat(a.slice(2))) {
    const t = toText(v);
    if (!skip || t !== '') parts.push(t);
  }
  return parts.join(sep);
});
def('LEN', (a) => (arity(a, 1), toText(a[0]).length));
def('LEFT', (a) => {
  arity(a, 1, 2);
  const n = opt(a, 1, 1);
  if (n < 0) throw ERR.VALUE;
  return toText(a[0]).slice(0, n);
});
def('RIGHT', (a) => {
  arity(a, 1, 2);
  const n = opt(a, 1, 1);
  if (n < 0) throw ERR.VALUE;
  const s = toText(a[0]);
  return n === 0 ? '' : s.slice(-n);
});
def('MID', (a) => {
  arity(a, 3);
  const start = Math.trunc(toNumber(a[1]));
  const n = Math.trunc(toNumber(a[2]));
  if (start < 1 || n < 0) throw ERR.VALUE;
  return toText(a[0]).substr(start - 1, n);
});
def('UPPER', (a) => toText(a[0]).toUpperCase());
def('LOWER', (a) => toText(a[0]).toLowerCase());
def('PROPER', (a) => toText(a[0]).toLowerCase().replace(/(^|[^a-z\u00c0-\u024f])([a-z\u00c0-\u024f])/g, (_, p, c) => p + c.toUpperCase()));
def('TRIM', (a) => toText(a[0]).trim().replace(/ {2,}/g, ' '));
def('CLEAN', (a) => toText(a[0]).replace(/[\u0000-\u001f]/g, ''));
def('SUBSTITUTE', (a) => {
  arity(a, 3, 4);
  const s = toText(a[0]);
  const from = toText(a[1]);
  const to = toText(a[2]);
  if (!from) return s;
  if (a[3] === undefined) return s.split(from).join(to);
  const nth = Math.trunc(toNumber(a[3]));
  if (nth < 1) throw ERR.VALUE;
  let idx = -1;
  for (let i = 0; i < nth; i += 1) {
    idx = s.indexOf(from, idx + 1);
    if (idx < 0) return s;
  }
  return s.slice(0, idx) + to + s.slice(idx + from.length);
});
def('REPLACE', (a) => {
  arity(a, 4);
  const s = toText(a[0]);
  const start = Math.trunc(toNumber(a[1]));
  const n = Math.trunc(toNumber(a[2]));
  if (start < 1 || n < 0) throw ERR.VALUE;
  return s.slice(0, start - 1) + toText(a[3]) + s.slice(start - 1 + n);
});
def('FIND', (a) => {
  arity(a, 2, 3);
  const start = opt(a, 2, 1);
  const i = toText(a[1]).indexOf(toText(a[0]), start - 1);
  if (start < 1 || i < 0) throw ERR.VALUE;
  return i + 1;
});
def('SEARCH', (a) => {
  arity(a, 2, 3);
  const within = toText(a[1]);
  const start = opt(a, 2, 1);
  if (start < 1) throw ERR.VALUE;
  const pattern = wildcard(toText(a[0])).source.slice(1, -1);
  const m = new RegExp(pattern, 'is').exec(within.slice(start - 1));
  if (!m) throw ERR.VALUE;
  return m.index + start;
});
def('REPT', (a) => {
  const n = Math.trunc(toNumber(a[1]));
  const s = toText(a[0]);
  if (n < 0 || s.length * n > 32_767) throw ERR.VALUE;
  return s.repeat(n);
});
def('EXACT', (a) => toText(a[0]) === toText(a[1]));
def('CHAR', (a) => {
  const n = Math.trunc(toNumber(a[0]));
  if (n < 1 || n > 65_535) throw ERR.VALUE;
  return String.fromCharCode(n);
});
def('CODE UNICODE', (a) => {
  const s = toText(a[0]);
  if (!s) throw ERR.VALUE;
  return s.codePointAt(0);
});
def('TEXT', (a) => {
  arity(a, 2);
  const v = scalar(a[0]);
  const pattern = toText(a[1]);
  if (typeof v !== 'number') {
    const n = typeof v === 'string' ? parseNumberText(v) ?? parseDateText(v) : null;
    return n ? formatWithPattern(n.value, pattern) : toText(v);
  }
  return formatWithPattern(v, pattern);
});
def('VALUE', (a) => {
  const v = scalar(a[0]);
  if (typeof v === 'number') return v;
  const n = parseNumberText(toText(v)) ?? parseDateText(toText(v));
  if (!n) throw ERR.VALUE;
  return n.value;
});

// ---- Dates and times ----

const today = () => Math.floor(nowSerial());
def('TODAY', () => today(), { volatile: true });
def('NOW', () => nowSerial(), { volatile: true });
def('DATE', (a) => {
  arity(a, 3);
  let y = Math.trunc(toNumber(a[0]));
  if (y < 1900) y += 1900;
  const s = dateSerial(y, Math.trunc(toNumber(a[1])), Math.trunc(toNumber(a[2])));
  if (s < 0) throw ERR.NUM;
  return s;
});
def('TIME', (a) => {
  arity(a, 3);
  const t = timeSerial(toNumber(a[0]), toNumber(a[1]), toNumber(a[2]));
  if (t < 0) throw ERR.NUM;
  return t - Math.floor(t);
});
const parts = (v) => {
  const n = toNumber(v);
  if (n < 0) throw ERR.NUM;
  return serialParts(n);
};
def('YEAR', (a) => parts(a[0]).y);
def('MONTH', (a) => parts(a[0]).m);
def('DAY', (a) => parts(a[0]).d);
def('HOUR', (a) => parts(a[0]).H);
def('MINUTE', (a) => parts(a[0]).M);
def('SECOND', (a) => parts(a[0]).S);
def('WEEKDAY', (a) => {
  const wd = parts(a[0]).weekday;
  const type = opt(a, 1, 1);
  if (type === 1) return wd + 1;
  if (type === 2) return ((wd + 6) % 7) + 1;
  if (type === 3) return (wd + 6) % 7;
  throw ERR.NUM;
});
def('EDATE', (a) => {
  const p = parts(a[0]);
  const m = p.m + Math.trunc(toNumber(a[1]));
  const last = new Date(Date.UTC(p.y, m, 0)).getUTCDate();
  return dateSerial(p.y, m, Math.min(p.d, last));
});
def('EOMONTH', (a) => {
  const p = parts(a[0]);
  return dateSerial(p.y, p.m + Math.trunc(toNumber(a[1])) + 1, 0);
});
def('DAYS', (a) => Math.floor(toNumber(a[0])) - Math.floor(toNumber(a[1])));
def('DATEVALUE', (a) => {
  const d = parseDateText(toText(a[0]));
  if (!d) throw ERR.VALUE;
  return Math.floor(d.value);
});
def('TIMEVALUE', (a) => {
  const d = parseDateText(toText(a[0]));
  if (!d) throw ERR.VALUE;
  return d.value - Math.floor(d.value);
});
def('DATEDIF', (a) => {
  arity(a, 3);
  const s = parts(a[0]);
  const e = parts(a[1]);
  const start = Math.floor(toNumber(a[0]));
  const end = Math.floor(toNumber(a[1]));
  if (end < start) throw ERR.NUM;
  let months = (e.y - s.y) * 12 + (e.m - s.m);
  if (e.d < s.d) months -= 1;
  switch (toText(a[2]).toUpperCase()) {
    case 'Y': return Math.floor(months / 12);
    case 'M': return months;
    case 'D': return end - start;
    case 'YM': return months % 12;
    case 'MD': return e.d >= s.d ? e.d - s.d : end - dateSerial(e.y, e.m - 1, s.d);
    case 'YD': {
      let anniversary = dateSerial(e.y, s.m, s.d);
      if (anniversary > end) anniversary = dateSerial(e.y - 1, s.m, s.d);
      return end - anniversary;
    }
    default: throw ERR.NUM;
  }
});
def('NETWORKDAYS', (a) => {
  arity(a, 2, 3);
  let start = Math.floor(toNumber(a[0]));
  let end = Math.floor(toNumber(a[1]));
  const sign = end < start ? -1 : 1;
  if (sign < 0) [start, end] = [end, start];
  const holidays = new Set(a[2] ? numbers([a[2]]).map(Math.floor) : []);
  let n = 0;
  for (let d = start; d <= end; d += 1) {
    const wd = serialParts(d).weekday;
    if (wd !== 0 && wd !== 6 && !holidays.has(d)) n += 1;
  }
  return n * sign;
});
def('WEEKNUM', (a) => {
  const p = parts(a[0]);
  const jan1 = dateSerial(p.y, 1, 1);
  const offset = serialParts(jan1).weekday;
  return Math.floor((Math.floor(toNumber(a[0])) - jan1 + offset) / 7) + 1;
});

// ---- Lookup ----

const eq = (a, b) => compare(a, b) === 0 && (typeof a === typeof b || a === null || b === null);
function exactIndex(list, value) {
  if (typeof value === 'string' && /[*?]/.test(value)) {
    const re = wildcard(value);
    return list.findIndex((v) => typeof v === 'string' && re.test(v));
  }
  return list.findIndex((v) => !isErr(v) && eq(v, value));
}
// Sorted search: the last item <= value (or >= for descending lists).
function sortedIndex(list, value, descending = false) {
  let found = -1;
  for (let i = 0; i < list.length; i += 1) {
    const v = list[i];
    if (v === null || isErr(v) || typeof v !== typeof value) continue;
    const d = compare(v, value);
    if (descending ? d >= 0 : d <= 0) found = i;
    else break;
  }
  return found;
}
const column = (range, j) => {
  const { maxR } = range.engine.extent(range.sheet);
  const out = [];
  for (let i = 0; i < Math.min(range.rows, maxR - range.r1 + 1); i += 1) out.push(range.get(i, j));
  return out;
};
const rowOf = (range, i) => {
  const { maxC } = range.engine.extent(range.sheet);
  const out = [];
  for (let j = 0; j < Math.min(range.cols, maxC - range.c1 + 1); j += 1) out.push(range.get(i, j));
  return out;
};
const vector = (range) => (range.cols === 1 ? column(range, 0) : range.rows === 1 ? rowOf(range, 0) : null);

def('VLOOKUP', (a) => {
  arity(a, 3, 4);
  const value = scalar(a[0]);
  const table = a[1];
  if (!(table instanceof Range)) throw ERR.VALUE;
  const col = Math.trunc(toNumber(a[2]));
  if (col < 1) throw ERR.VALUE;
  if (col > table.cols) throw ERR.REF;
  const approx = a[3] === undefined || a[3] === null ? true : toBool(a[3]);
  const keys = column(table, 0);
  const i = approx ? sortedIndex(keys, value) : exactIndex(keys, value);
  if (i < 0) throw ERR.NA;
  return table.get(i, col - 1);
});
def('HLOOKUP', (a) => {
  arity(a, 3, 4);
  const value = scalar(a[0]);
  const table = a[1];
  if (!(table instanceof Range)) throw ERR.VALUE;
  const row = Math.trunc(toNumber(a[2]));
  if (row < 1) throw ERR.VALUE;
  if (row > table.rows) throw ERR.REF;
  const approx = a[3] === undefined || a[3] === null ? true : toBool(a[3]);
  const keys = rowOf(table, 0);
  const j = approx ? sortedIndex(keys, value) : exactIndex(keys, value);
  if (j < 0) throw ERR.NA;
  return table.get(row - 1, j);
});
def('MATCH', (a) => {
  arity(a, 2, 3);
  const value = scalar(a[0]);
  if (!(a[1] instanceof Range)) throw ERR.NA;
  const list = vector(a[1]);
  if (!list) throw ERR.NA;
  const type = opt(a, 2, 1);
  const i = type === 0 ? exactIndex(list, value) : sortedIndex(list, value, type < 0);
  if (i < 0) throw ERR.NA;
  return i + 1;
});
def('XLOOKUP', (a) => {
  if (a.length < 3 || a.length > 6) throw ERR.VALUE;
  const value = scalar(a[0]);
  const [look, ret] = [a[1], a[2]];
  if (!(look instanceof Range) || !(ret instanceof Range)) throw ERR.VALUE;
  const list = vector(look);
  if (!list) throw ERR.VALUE;
  const mode = opt(a, 4, 0);
  const reverse = opt(a, 5, 1) < 0;
  const order = reverse ? list.map((_, i) => list.length - 1 - i) : list.map((_, i) => i);
  let found = -1;
  if (mode === 2 && typeof value === 'string') {
    const re = wildcard(value);
    found = order.find((i) => typeof list[i] === 'string' && re.test(list[i])) ?? -1;
  } else {
    found = order.find((i) => !isErr(list[i]) && eq(list[i], value)) ?? -1;
    if (found < 0 && (mode === -1 || mode === 1)) {
      let best = -1;
      for (const i of order) {
        const v = list[i];
        if (v === null || isErr(v) || typeof v !== typeof value) continue;
        const d = compare(v, value);
        if ((mode === -1 && d < 0 && (best < 0 || compare(v, list[best]) > 0)) || (mode === 1 && d > 0 && (best < 0 || compare(v, list[best]) < 0))) best = i;
      }
      found = best;
    }
  }
  if (found < 0) {
    if (a[3] !== undefined && a[3] !== null) return a[3];
    throw ERR.NA;
  }
  if (look.cols === 1) return ret.cols === 1 ? ret.get(found, 0) : new Range(ret.engine, ret.sheet, ret.r1 + found, ret.c1, ret.r1 + found, ret.c2);
  return ret.rows === 1 ? ret.get(0, found) : new Range(ret.engine, ret.sheet, ret.r1, ret.c1 + found, ret.r2, ret.c1 + found);
});
def('INDEX', (a) => {
  arity(a, 2, 3);
  const r = a[0];
  if (!(r instanceof Range)) {
    if (toNumber(a[1]) <= 1) return scalar(r);
    throw ERR.REF;
  }
  let row = Math.trunc(toNumber(a[1]));
  let col = a[2] === undefined || a[2] === null ? null : Math.trunc(toNumber(a[2]));
  if (col === null) {
    if (r.rows === 1) [row, col] = [1, row];
    else col = r.cols === 1 ? 1 : 0;
  }
  if (row < 0 || col < 0 || row > r.rows || col > r.cols) throw ERR.REF;
  if (row === 0 && col === 0) return r;
  if (row === 0) return new Range(r.engine, r.sheet, r.r1, r.c1 + col - 1, r.r2, r.c1 + col - 1);
  if (col === 0) return new Range(r.engine, r.sheet, r.r1 + row - 1, r.c1, r.r1 + row - 1, r.c2);
  return r.get(row - 1, col - 1);
});

// ---- Finance ----

function pmt(rate, nper, pv, fv = 0, type = 0) {
  if (nper === 0) throw ERR.NUM;
  if (rate === 0) return -(pv + fv) / nper;
  const f = (1 + rate) ** nper;
  return (-(pv * f + fv) * rate) / ((1 + rate * type) * (f - 1));
}
def('PMT', (a) => (arity(a, 3, 5), pmt(toNumber(a[0]), toNumber(a[1]), toNumber(a[2]), opt(a, 3, 0), opt(a, 4, 0))));
def('FV', (a) => {
  arity(a, 3, 5);
  const [rate, nper, p, pv, type] = [toNumber(a[0]), toNumber(a[1]), toNumber(a[2]), opt(a, 3, 0), opt(a, 4, 0)];
  if (rate === 0) return -(pv + p * nper);
  const f = (1 + rate) ** nper;
  return -(pv * f + (p * (1 + rate * type) * (f - 1)) / rate);
});
def('PV', (a) => {
  arity(a, 3, 5);
  const [rate, nper, p, fv, type] = [toNumber(a[0]), toNumber(a[1]), toNumber(a[2]), opt(a, 3, 0), opt(a, 4, 0)];
  if (rate === 0) return -(fv + p * nper);
  const f = (1 + rate) ** nper;
  return -(fv + (p * (1 + rate * type) * (f - 1)) / rate) / f;
});
def('NPV', (a) => {
  if (a.length < 2) throw ERR.VALUE;
  const rate = toNumber(a[0]);
  return numbers(a.slice(1)).reduce((s, v, i) => s + v / (1 + rate) ** (i + 1), 0);
});

export const FUNCTIONS = FNS;
export const FUNCTION_NAMES = Object.keys(FNS).sort();
export { isErr };
