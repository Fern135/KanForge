import { parse } from './parser';
import { FUNCTIONS } from './functions';
import { ERR, Range, isErr, toNumber, toText, compare, errorFor } from './values';
import { cellKey, usedExtent } from '../model';

// Works out formula values for one version of a workbook. Values are
// computed when first asked for and remembered; every edit makes a new
// workbook and so a fresh Engine. A formula that refers back to itself gives
// #CIRC!, and very long chains of formulas are worked out in steps so they
// can't overflow the call stack.

const trees = new Map();
function tree(formula) {
  let t = trees.get(formula);
  if (!t) {
    try {
      t = parse(formula);
    } catch {
      t = { t: 'err', v: '#ERROR!' };
    }
    if (trees.size > 20_000) trees.clear();
    trees.set(formula, t);
  }
  return t;
}

// Checks a formula's syntax: null when fine, or a message.
export function formulaProblem(formula) {
  try {
    parse(formula);
    return null;
  } catch (err) {
    return err.message || 'There\'s a problem with this formula';
  }
}

const DEEP = Symbol('deep');
const MAX_DEPTH = 250;

const unwrap = (v) => {
  if (v instanceof Range) return v.rows === 1 && v.cols === 1 ? v.get(0, 0) : ERR.VALUE;
  return v === undefined ? null : v;
};

export class Engine {
  constructor(wb) {
    this.wb = wb;
    this.cache = new Map();
    this.extents = new Map();
    this.visiting = new Set();
    this.depth = 0;
    this.deepest = null;
    this.names = new Map(wb.sheets.map((s, i) => [s.name.toLowerCase(), i]));
  }

  extent(si) {
    let e = this.extents.get(si);
    if (!e) {
      e = usedExtent(this.wb.sheets[si]);
      this.extents.set(si, e);
    }
    return e;
  }

  // A cell's value, for use inside a calculation.
  cellValue(si, r, c) {
    const sheet = this.wb.sheets[si];
    if (!sheet || r < 0 || c < 0 || r >= sheet.rows || c >= sheet.cols) return ERR.REF;
    const key = cellKey(r, c);
    const cell = sheet.cells[key];
    if (!cell) return null;
    if (cell.f === undefined) return cell.v ?? null;
    const id = `${si}!${key}`;
    if (this.cache.has(id)) return this.cache.get(id);
    if (this.visiting.has(id)) return ERR.CIRC;
    if (this.depth >= MAX_DEPTH) {
      this.deepest = { si, r, c, id };
      throw DEEP;
    }
    this.visiting.add(id);
    this.depth += 1;
    let v;
    try {
      v = this.formula(cell.f, si, r, c);
    } finally {
      this.visiting.delete(id);
      this.depth -= 1;
    }
    this.cache.set(id, v);
    return v;
  }

  // A cell's value, for showing it.
  value(si, r, c) {
    for (;;) {
      try {
        return this.cellValue(si, r, c);
      } catch (e) {
        if (e !== DEEP) throw e;
        this.settle();
      }
    }
  }

  // Works out a long chain from its far end, a step at a time.
  settle() {
    const work = [this.deepest];
    const seen = new Set([this.deepest.id]);
    while (work.length) {
      const t = work[work.length - 1];
      try {
        this.cellValue(t.si, t.r, t.c);
        work.pop();
      } catch (e) {
        if (e !== DEEP) throw e;
        if (seen.has(this.deepest.id)) {
          // A loop longer than one step: it can never finish.
          this.cache.set(this.deepest.id, ERR.CIRC);
        } else {
          seen.add(this.deepest.id);
          work.push(this.deepest);
        }
      }
    }
  }

  formula(f, si, r, c) {
    const ctx = { sheet: si, row: r, col: c };
    ctx.arg = (node) => this.node(node, ctx);
    const v = unwrap(this.node(tree(f), ctx));
    return v === null ? 0 : v;
  }

  sheetIndex(name, fallback) {
    if (!name) return fallback;
    return this.names.get(name.toLowerCase()) ?? -1;
  }

  ref(ref, ctx) {
    const si = this.sheetIndex(ref.sheet, ctx.sheet);
    const sheet = this.wb.sheets[si];
    if (!sheet) return ERR.REF;
    const { a, b } = ref;
    let r1;
    let c1;
    let r2;
    let c2;
    if (ref.kind === 'cell') [r1, c1, r2, c2] = [a.r, a.c, a.r, a.c];
    else if (ref.kind === 'area') [r1, c1, r2, c2] = [Math.min(a.r, b.r), Math.min(a.c, b.c), Math.max(a.r, b.r), Math.max(a.c, b.c)];
    else if (ref.kind === 'cols') [r1, c1, r2, c2] = [0, Math.min(a.c, b.c), sheet.rows - 1, Math.max(a.c, b.c)];
    else [r1, c1, r2, c2] = [Math.min(a.r, b.r), 0, Math.max(a.r, b.r), sheet.cols - 1];
    if (r2 >= sheet.rows || c2 >= sheet.cols) return ERR.REF;
    return new Range(this, si, r1, c1, r2, c2);
  }

  node(n, ctx) {
    switch (n.t) {
      case 'num': case 'str': case 'bool': return n.v;
      case 'err': return errorFor(n.v);
      case 'empty': return null;
      case 'name': return ERR.NAME;
      case 'ref': return this.ref(n.ref, ctx);
      case 'un': case 'pct': {
        const v = unwrap(this.node(n.a, ctx));
        if (isErr(v)) return v;
        try {
          const x = toNumber(v);
          return n.t === 'pct' ? x / 100 : n.op === '-' ? -x : x;
        } catch (e) {
          return isErr(e) ? e : ERR.VALUE;
        }
      }
      case 'bin': return this.binary(n, ctx);
      case 'fn': return this.call(n, ctx);
      default: return ERR.VALUE;
    }
  }

  binary(n, ctx) {
    const a = unwrap(this.node(n.a, ctx));
    if (isErr(a)) return a;
    const b = unwrap(this.node(n.b, ctx));
    if (isErr(b)) return b;
    switch (n.op) {
      case '&': return toText(a) + toText(b);
      case '=': return compare(a, b) === 0;
      case '<>': return compare(a, b) !== 0;
      case '<': return compare(a, b) < 0;
      case '>': return compare(a, b) > 0;
      case '<=': return compare(a, b) <= 0;
      case '>=': return compare(a, b) >= 0;
      default:
    }
    let x;
    let y;
    try {
      x = toNumber(a);
      y = toNumber(b);
    } catch (e) {
      return isErr(e) ? e : ERR.VALUE;
    }
    let v;
    switch (n.op) {
      case '+': v = x + y; break;
      case '-': v = x - y; break;
      case '*': v = x * y; break;
      case '/':
        if (y === 0) return ERR.DIV0;
        v = x / y;
        break;
      case '^':
        if (x === 0 && y < 0) return ERR.DIV0;
        v = x ** y;
        break;
      default: return ERR.VALUE;
    }
    return Number.isFinite(v) ? v : ERR.NUM;
  }

  call(n, ctx) {
    const spec = FUNCTIONS[n.name] ?? FUNCTIONS[n.name.replace(/^_XLFN\./, '')];
    if (!spec) return ERR.NAME;
    try {
      const v = spec.lazy
        ? spec.fn(n.args, ctx)
        : spec.fn(n.args.map((a) => (a.t === 'empty' ? null : this.node(a, ctx))), ctx);
      if (typeof v === 'number' && !Number.isFinite(v)) return ERR.NUM;
      return v === undefined ? null : v;
    } catch (e) {
      if (e === DEEP) throw e;
      return isErr(e) ? e : ERR.VALUE;
    }
  }
}
