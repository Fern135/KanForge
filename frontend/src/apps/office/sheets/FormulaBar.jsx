import { useEffect, useState } from 'react';
import { parseKey } from './model';

// The name box (where the selection is, and a way to jump) and the formula bar
// (what the active cell holds, editable).
export default function FormulaBar({ barRef, label, text, readOnly, editing, sheet, onGoto, onFocusEdit, onChange, onKeyDown }) {
  const [name, setName] = useState(label);
  useEffect(() => setName(label), [label]);

  const go = () => {
    const [a, b] = name.trim().toUpperCase().split(':');
    const start = parseKey(a || '');
    const end = b ? parseKey(b) : start;
    if (!start || !end || Math.max(start.r, end.r) >= sheet.rows || Math.max(start.c, end.c) >= sheet.cols) {
      setName(label);
      return;
    }
    onGoto({ anchor: start, focus: end });
  };

  return (
    <div className="sheet-formula-bar">
      <input
        className="sheet-namebox"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            go();
          } else if (e.key === 'Escape') setName(label);
        }}
        onBlur={() => setName(label)}
        aria-label="Name box: type a cell like B4 to go there"
        title="Type a cell or range (like B4 or A1:C10) and press Enter"
        spellCheck={false}
      />
      <span className="sheet-fx" aria-hidden="true">fx</span>
      <textarea
        ref={barRef}
        className={`sheet-formula${editing ? ' editing' : ''}`}
        value={text}
        readOnly={readOnly}
        rows={1}
        spellCheck={false}
        aria-label="Cell contents"
        onFocus={onFocusEdit}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
