import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// The right-click menu on cells and headers.
export default function ContextMenu({ x, y, area, a, range, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Keep the menu on screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({ left: Math.max(4, Math.min(x, window.innerWidth - width - 4)), top: Math.max(4, Math.min(y, window.innerHeight - height - 4)) });
  }, [x, y]);

  useEffect(() => {
    const close = (e) => {
      if (!ref.current?.contains(e.target)) onClose();
    };
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    window.addEventListener('blur', onClose);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  const rows = range.r2 - range.r1 + 1;
  const cols = range.c2 - range.c1 + 1;
  const plural = (n, word) => (n === 1 ? word : `${n} ${word}s`);
  const items = [
    ['Cut', a.cut],
    ['Copy', a.copy],
    ['Paste', a.paste],
    ['Paste values only', a.pasteValues],
    'divider',
    area !== 'col' && [`Insert ${plural(rows, 'row')} above`, () => a.insertRows('above')],
    area !== 'col' && [`Insert ${plural(rows, 'row')} below`, () => a.insertRows('below')],
    area !== 'row' && [`Insert ${plural(cols, 'column')} left`, () => a.insertCols('left')],
    area !== 'row' && [`Insert ${plural(cols, 'column')} right`, () => a.insertCols('right')],
    'divider',
    area !== 'col' && [`Delete ${plural(rows, 'row')}`, a.deleteRows],
    area !== 'row' && [`Delete ${plural(cols, 'column')}`, a.deleteCols],
    ['Clear contents', () => a.clear('contents')],
    'divider',
    ['Sort A → Z', () => a.sort(true)],
    ['Sort Z → A', () => a.sort(false)],
    area === 'col' && ['Column width…', a.colWidth],
    area === 'col' && ['Fit column width to contents', a.autoFitCols],
    area === 'row' && ['Row height…', a.rowHeight],
  ].filter(Boolean);

  return (
    <ul ref={ref} className="dropdown-menu show shadow doc-menu sheet-context" style={{ position: 'fixed', ...pos }} role="menu">
      {items.map((it, i) => (it === 'divider'
        ? <li key={`d${i}`}><hr className="dropdown-divider" /></li>
        : (
          <li key={it[0]}>
            <button type="button" className="dropdown-item" onMouseDown={(e) => e.preventDefault()} onClick={() => { onClose(); it[1](); }}>{it[0]}</button>
          </li>
        )))}
    </ul>
  );
}
