import { mapRefs } from './parser';

// Keeping formulas pointing at the right cells when cells move.

const same = (a, b) => a.toLowerCase() === b.toLowerCase();

// Copying or filling a formula (dr, dc) cells away moves its relative
// references by the same amount; $-locked parts stay put.
export function offsetFormula(formula, dr, dc) {
  if (!dr && !dc) return formula;
  return mapRefs(formula, (ref) => {
    const move = (p) => ({
      ...p,
      r: p.r === undefined || p.ra ? p.r : p.r + dr,
      c: p.c === undefined || p.ca ? p.c : p.c + dc,
    });
    const a = move(ref.a);
    const b = ref.b && move(ref.b);
    const off = (p) => p && ((p.r !== undefined && p.r < 0) || (p.c !== undefined && p.c < 0));
    return off(a) || off(b) ? '#REF!' : { ...ref, a, b };
  });
}

// Inserting (count > 0) or deleting (count < 0) rows (axis 'r') or columns
// (axis 'c') at index `at` of `targetSheet`. `formulaSheet` is the sheet the
// formula lives on, which references without a sheet name point to.
export function shiftFormula(formula, { axis, at, count, targetSheet, formulaSheet }) {
  return mapRefs(formula, (ref) => {
    if (!same(ref.sheet ?? formulaSheet, targetSheet)) return undefined;
    if (ref.kind === (axis === 'r' ? 'cols' : 'rows')) return undefined;
    const removed = -count;
    const end = at + removed;

    if (ref.kind === 'cell') {
      const i = ref.a[axis];
      if (count > 0) return i >= at ? { ...ref, a: { ...ref.a, [axis]: i + count } } : undefined;
      if (i < at) return undefined;
      if (i < end) return '#REF!';
      return { ...ref, a: { ...ref.a, [axis]: i - removed } };
    }

    let [lo, hi] = [ref.a[axis], ref.b[axis]];
    let [loP, hiP] = [ref.a, ref.b];
    if (lo > hi) {
      [lo, hi] = [hi, lo];
      [loP, hiP] = [hiP, loP];
    }
    let nlo = lo;
    let nhi = hi;
    if (count > 0) {
      if (lo >= at) nlo += count;
      if (hi >= at) nhi += count;
    } else {
      if (lo >= at && hi < end) return '#REF!';
      nlo = lo >= end ? lo - removed : lo >= at ? at : lo;
      nhi = hi >= end ? hi - removed : hi >= at ? at - 1 : hi;
    }
    if (nlo === lo && nhi === hi) return undefined;
    return { ...ref, a: { ...loP, [axis]: nlo }, b: { ...hiP, [axis]: nhi } };
  });
}

export const renameSheetInFormula = (formula, from, to) => mapRefs(formula, (ref) => (ref.sheet && same(ref.sheet, from) ? { ...ref, sheet: to } : undefined));

export const dropSheetFromFormula = (formula, name) => mapRefs(formula, (ref) => (ref.sheet && same(ref.sheet, name) ? '#REF!' : undefined));
