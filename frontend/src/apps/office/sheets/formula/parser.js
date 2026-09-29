import { colIndex, colName } from '../model';

// Excel formula syntax: numbers, "text", TRUE/FALSE, #errors, references
// (A1, $B$2, A1:C3, A:A, 1:1, Sheet2!A1, 'My sheet'!A1:B2), functions, and the
// operators = <> < > <= >= & + - * / ^ and %.

export class FormulaSyntaxError extends Error {}

const REF = /(?:('(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.]*)!)?(?:(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?::(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7}))?|(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})|(\$?)(\d{1,7}):(\$?)(\d{1,7}))(?![A-Za-z0-9_(.!$])/y;
const NUMBER = /(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y;
const IDENT = /[A-Za-z_][A-Za-z0-9_.]*/y;
const ERROR = /#(?:DIV\/0!|N\/A|NAME\?|NULL!|NUM!|REF!|VALUE!|CIRC!|ERROR!)/y;
const OPS = ['<>', '<=', '>=', '+', '-', '*', '/', '^', '&', '=', '<', '>', '%'];

const sticky = (re, text, i) => {
  re.lastIndex = i;
  return re.exec(text);
};

const unquote = (name) => (name.startsWith("'") ? name.slice(1, -1).replace(/''/g, "'") : name);
const row = (digits) => Number(digits) - 1;

function refToken(m) {
  const sheet = m[1] ? unquote(m[1]) : null;
  if (m[3] !== undefined) {
    const a = { c: colIndex(m[3]), r: row(m[5]), ca: !!m[2], ra: !!m[4] };
    if (m[7] === undefined) return { kind: 'cell', sheet, a };
    return { kind: 'area', sheet, a, b: { c: colIndex(m[7]), r: row(m[9]), ca: !!m[6], ra: !!m[8] } };
  }
  if (m[11] !== undefined) return { kind: 'cols', sheet, a: { c: colIndex(m[11]), ca: !!m[10] }, b: { c: colIndex(m[13]), ca: !!m[12] } };
  return { kind: 'rows', sheet, a: { r: row(m[15]), ra: !!m[14] }, b: { r: row(m[17]), ra: !!m[16] } };
}

export function tokenize(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    const start = i;
    let m;
    if (ch === '"') {
      let j = i + 1;
      let value = '';
      for (;;) {
        if (j >= text.length) throw new FormulaSyntaxError('Missing closing quote');
        if (text[j] === '"') {
          if (text[j + 1] === '"') {
            value += '"';
            j += 2;
            continue;
          }
          break;
        }
        value += text[j];
        j += 1;
      }
      i = j + 1;
      out.push({ type: 'str', value, start, end: i });
      continue;
    }
    if ((m = sticky(REF, text, i))) {
      i += m[0].length;
      out.push({ type: 'ref', ref: refToken(m), start, end: i });
      continue;
    }
    if ((m = sticky(NUMBER, text, i))) {
      i += m[0].length;
      out.push({ type: 'num', value: Number(m[0]), start, end: i });
      continue;
    }
    if (ch === '#') {
      m = sticky(ERROR, text, i);
      if (!m) throw new FormulaSyntaxError('Unknown error value');
      i += m[0].length;
      out.push({ type: 'err', value: m[0], start, end: i });
      continue;
    }
    if ((m = sticky(IDENT, text, i))) {
      i += m[0].length;
      const upper = m[0].toUpperCase();
      let j = i;
      while (j < text.length && /\s/.test(text[j])) j += 1;
      if (text[j] === '(') out.push({ type: 'func', value: upper, start, end: i });
      else if (upper === 'TRUE' || upper === 'FALSE') out.push({ type: 'bool', value: upper === 'TRUE', start, end: i });
      else out.push({ type: 'name', value: m[0], start, end: i });
      continue;
    }
    if (ch === '(' || ch === ')') {
      i += 1;
      out.push({ type: ch, start, end: i });
      continue;
    }
    if (ch === ',' || ch === ';') {
      i += 1;
      out.push({ type: ',', start, end: i });
      continue;
    }
    const op = OPS.find((o) => text.startsWith(o, i));
    if (op) {
      i += op.length;
      out.push({ type: 'op', value: op, start, end: i });
      continue;
    }
    throw new FormulaSyntaxError(`Unexpected "${ch}"`);
  }
  return out;
}

const BINARY = { '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '&': 2, '+': 3, '-': 3, '*': 4, '/': 4, '^': 5 };
const UNARY = 6;

// Formula text (without the "=") → syntax tree.
export function parse(text) {
  const tokens = tokenize(text);
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const expect = (type) => {
    const t = next();
    if (!t || t.type !== type) throw new FormulaSyntaxError(`Expected ${type}`);
    return t;
  };

  function prefix() {
    const t = next();
    if (!t) throw new FormulaSyntaxError('Formula ends too early');
    switch (t.type) {
      case 'num': return { t: 'num', v: t.value };
      case 'str': return { t: 'str', v: t.value };
      case 'bool': return { t: 'bool', v: t.value };
      case 'err': return { t: 'err', v: t.value };
      case 'ref': return { t: 'ref', ref: t.ref };
      case 'name': return { t: 'name', v: t.value };
      case '(': {
        const e = expr(0);
        expect(')');
        return e;
      }
      case 'op':
        if (t.value === '-' || t.value === '+') return { t: 'un', op: t.value, a: expr(UNARY) };
        break;
      case 'func': {
        expect('(');
        const args = [];
        if (peek()?.type === ')') {
          next();
          return { t: 'fn', name: t.value, args };
        }
        for (;;) {
          const tk = peek();
          args.push(tk && (tk.type === ',' || tk.type === ')') ? { t: 'empty' } : expr(0));
          const sep = next();
          if (sep?.type === ')') break;
          if (sep?.type !== ',') throw new FormulaSyntaxError('Expected , or )');
        }
        return { t: 'fn', name: t.value, args };
      }
      default:
    }
    throw new FormulaSyntaxError('Unexpected symbol');
  }

  function expr(minPrec) {
    let left = prefix();
    for (;;) {
      const t = peek();
      if (!t || t.type !== 'op') break;
      if (t.value === '%') {
        next();
        left = { t: 'pct', a: left };
        continue;
      }
      const prec = BINARY[t.value];
      if (prec === undefined || prec < minPrec) break;
      next();
      left = { t: 'bin', op: t.value, a: left, b: expr(prec + 1) };
    }
    return left;
  }

  const tree = expr(0);
  if (pos < tokens.length) throw new FormulaSyntaxError('Unexpected symbol');
  return tree;
}

// Sheet names that need quotes in a formula: anything but a plain word, or one that looks like a reference.
export function quoteSheet(name) {
  if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) && !/^[A-Za-z]{1,3}\d+$/.test(name) && !/^(TRUE|FALSE)$/i.test(name)) return name;
  return `'${name.replace(/'/g, "''")}'`;
}

const part = (p) => `${p.ca ? '$' : ''}${p.c !== undefined ? colName(p.c) : ''}${p.ra ? '$' : ''}${p.r !== undefined ? p.r + 1 : ''}`;

export function refText(ref) {
  const prefix = ref.sheet ? `${quoteSheet(ref.sheet)}!` : '';
  if (ref.kind === 'cell') return prefix + part(ref.a);
  if (ref.kind === 'cols') return `${prefix}${ref.a.ca ? '$' : ''}${colName(ref.a.c)}:${ref.b.ca ? '$' : ''}${colName(ref.b.c)}`;
  if (ref.kind === 'rows') return `${prefix}${ref.a.ra ? '$' : ''}${ref.a.r + 1}:${ref.b.ra ? '$' : ''}${ref.b.r + 1}`;
  return `${prefix}${part(ref.a)}:${part(ref.b)}`;
}

// Rewrites every reference in a formula. `fn(ref)` returns a new ref, the
// string '#REF!' for a reference that no longer points anywhere, or undefined
// to keep it. A formula that doesn't parse is returned unchanged.
export function mapRefs(formula, fn) {
  let tokens;
  try {
    tokens = tokenize(formula);
  } catch {
    return formula;
  }
  let out = '';
  let last = 0;
  for (const t of tokens) {
    if (t.type !== 'ref') continue;
    const next = fn(t.ref);
    if (next === undefined) continue;
    out += formula.slice(last, t.start) + (typeof next === 'string' ? next : refText(next));
    last = t.end;
  }
  return last ? out + formula.slice(last) : formula;
}

// Tidies a typed formula the way Excel does: function names and references in capitals.
export function normalizeFormula(formula) {
  let tokens;
  try {
    tokens = tokenize(formula);
  } catch {
    return formula;
  }
  let out = '';
  let last = 0;
  for (const t of tokens) {
    let text = null;
    if (t.type === 'func') text = t.value;
    else if (t.type === 'ref') text = refText(t.ref);
    else if (t.type === 'bool') text = t.value ? 'TRUE' : 'FALSE';
    if (text === null) continue;
    out += formula.slice(last, t.start) + text;
    last = t.end;
  }
  return out + formula.slice(last);
}
