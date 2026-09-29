import { useEffect, useMemo, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronUp, faChevronDown, faXmark } from '@fortawesome/free-solid-svg-icons';
import { parseKey } from './model';
import { formatValue, toEditText } from './format';
import { formulaProblem } from './formula/engine';

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Find and replace across the cells of this sheet or all sheets. Finds what
// cells show (or, optionally, their formulas); replaces in what was typed.
export default function SheetFind({ wb, engine, showReplace, onGoto, onReplace, cellFromText, onClose }) {
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [wholeCell, setWholeCell] = useState(false);
  const [allSheets, setAllSheets] = useState(false);
  const [formulas, setFormulas] = useState(false);
  const [index, setIndex] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => inputRef.current?.focus(), []);

  const test = useMemo(() => {
    if (!query) return null;
    const flags = matchCase ? '' : 'i';
    const re = new RegExp(wholeCell ? `^${escapeRegex(query)}$` : escapeRegex(query), flags);
    return (s) => re.test(s);
  }, [query, matchCase, wholeCell]);

  const matches = useMemo(() => {
    if (!test) return [];
    const out = [];
    const order = allSheets ? wb.sheets.map((_, i) => i) : [wb.active];
    for (const si of order) {
      const s = wb.sheets[si];
      const found = [];
      for (const [key, cell] of Object.entries(s.cells)) {
        if (cell.v === undefined && cell.f === undefined) continue;
        const p = parseKey(key);
        const text = formulas && cell.f !== undefined ? `=${cell.f}` : formatValue(engine.value(si, p.r, p.c), cell.s).text;
        if (test(text)) found.push({ si, r: p.r, c: p.c, key });
      }
      found.sort((a, b) => a.r - b.r || a.c - b.c);
      out.push(...found);
    }
    return out;
  }, [test, wb, engine, allSheets, formulas]);

  useEffect(() => setIndex(0), [query, matchCase, wholeCell, allSheets, formulas]);

  const go = (i) => {
    if (!matches.length) return;
    const n = (i + matches.length) % matches.length;
    setIndex(n);
    const m = matches[n];
    onGoto(m.si, m.r, m.c);
  };

  const replaceIn = (list) => {
    const flags = matchCase ? 'g' : 'gi';
    const re = new RegExp(wholeCell ? `^${escapeRegex(query)}$` : escapeRegex(query), flags);
    const bySheet = new Map();
    let count = 0;
    for (const m of list) {
      const cell = wb.sheets[m.si].cells[m.key];
      const raw = toEditText(cell);
      re.lastIndex = 0;
      if (!re.test(raw)) continue;
      const text = raw.replace(re, () => replacement);
      if (text[0] === '=' && text.length > 1 && formulaProblem(text.slice(1))) continue;
      if (!bySheet.has(m.si)) bySheet.set(m.si, []);
      bySheet.get(m.si).push([m.key, cellFromText(text, cell)]);
      count += 1;
    }
    if (count) onReplace([...bySheet]);
    return count;
  };

  const [note, setNote] = useState('');
  const current = matches[Math.min(index, matches.length - 1)];

  return (
    <div className="doc-find sheet-find shadow" role="dialog" aria-label="Find and replace">
      <div className="d-flex align-items-center gap-1">
        <input ref={inputRef} className="form-control form-control-sm" placeholder="Find" value={query}
          onChange={(e) => { setQuery(e.target.value); setNote(''); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              go(e.shiftKey ? index - 1 : current ? index + 1 : 0);
            }
            if (e.key === 'Escape') onClose();
          }} aria-label="Find" />
        <span className="small text-muted text-nowrap px-1" aria-live="polite">{query ? `${matches.length ? index + 1 : 0} of ${matches.length}` : ''}</span>
        <button type="button" className="icon-btn" onClick={() => go(index - 1)} aria-label="Previous match" disabled={!matches.length}><FontAwesomeIcon icon={faChevronUp} /></button>
        <button type="button" className="icon-btn" onClick={() => go(index + 1)} aria-label="Next match" disabled={!matches.length}><FontAwesomeIcon icon={faChevronDown} /></button>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><FontAwesomeIcon icon={faXmark} /></button>
      </div>
      {showReplace && (
        <div className="d-flex align-items-center gap-1 mt-2">
          <input className="form-control form-control-sm" placeholder="Replace with" value={replacement} onChange={(e) => setReplacement(e.target.value)} aria-label="Replace with" />
          <button type="button" className="btn btn-sm btn-light text-nowrap" disabled={!current}
            onClick={() => {
              const n = replaceIn([current]);
              setNote(n ? '' : 'That cell\'s text doesn\'t match exactly; nothing replaced.');
            }}>Replace</button>
          <button type="button" className="btn btn-sm btn-light text-nowrap" disabled={!matches.length}
            onClick={() => {
              const n = replaceIn(matches);
              setNote(`Replaced in ${n} cell${n === 1 ? '' : 's'}.`);
            }}>All</button>
        </div>
      )}
      <div className="d-flex flex-wrap gap-3 mt-2 small">
        {[['Match case', matchCase, setMatchCase], ['Entire cell', wholeCell, setWholeCell], ['All sheets', allSheets, setAllSheets], ['Search formulas', formulas, setFormulas]].map(([label, on, set]) => (
          <label key={label} className="form-check mb-0">
            <input type="checkbox" className="form-check-input" checked={on} onChange={(e) => set(e.target.checked)} />
            <span className="form-check-label">{label}</span>
          </label>
        ))}
      </div>
      {note && <div className="small text-muted mt-1">{note}</div>}
    </div>
  );
}
