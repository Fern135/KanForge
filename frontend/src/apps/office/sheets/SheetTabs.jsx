import { useEffect, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus } from '@fortawesome/free-solid-svg-icons';
import { sheetNameError } from './model';
import { useToast } from '../../../core/context/ToastContext';
import ConfirmModal from '../../../core/components/ConfirmModal';

// Sheet tabs along the bottom, as in Excel and Calc. Double-click to rename;
// right-click (or long-press) for more.
export default function SheetTabs({ sheets, active, readOnly, onSelect, onAdd, onRename, onDuplicate, onDelete, onMove }) {
  const toast = useToast();
  const [renaming, setRenaming] = useState(null);
  const [menu, setMenu] = useState(null);
  const [name, setName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const activeTab = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    activeTab.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);

  useEffect(() => {
    if (!menu) return undefined;
    const close = (e) => {
      if (!menuRef.current?.contains(e.target)) setMenu(null);
    };
    const onKey = (e) => e.key === 'Escape' && setMenu(null);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const startRename = (i) => {
    if (readOnly) return;
    setMenu(null);
    setName(sheets[i].name);
    setRenaming(i);
  };

  const finishRename = () => {
    const i = renaming;
    setRenaming(null);
    if (i === null || name.trim() === sheets[i].name) return;
    const problem = sheetNameError(name, sheets, sheets[i].id);
    if (problem) toast.error(problem);
    else onRename(i, name.trim());
  };

  const item = (label, onClick, disabled = false) => (
    <li><button type="button" className="dropdown-item" disabled={disabled} onClick={() => { setMenu(null); onClick(); }}>{label}</button></li>
  );

  return (
    <div className="sheet-tabs">
      {!readOnly && (
        <button type="button" className="sheet-tab-add" onClick={onAdd} title="Add sheet" aria-label="Add sheet">
          <FontAwesomeIcon icon={faPlus} />
        </button>
      )}
      <div className="sheet-tab-list" role="tablist" aria-label="Sheets">
        {sheets.map((s, i) => (renaming === i ? (
          <input
            key={s.id}
            className="sheet-tab-rename"
            value={name}
            maxLength={31}
            onChange={(e) => setName(e.target.value)}
            onBlur={finishRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') setRenaming(null);
            }}
            ref={(el) => el?.focus()}
            aria-label="Sheet name"
          />
        ) : (
          <button
            key={s.id}
            ref={i === active ? activeTab : undefined}
            type="button"
            role="tab"
            aria-selected={i === active}
            className={`sheet-tab${i === active ? ' active' : ''}`}
            onClick={() => onSelect(i)}
            onDoubleClick={() => startRename(i)}
            onContextMenu={(e) => {
              e.preventDefault();
              if (readOnly) return;
              onSelect(i);
              const rect = e.currentTarget.getBoundingClientRect();
              setMenu({ index: i, left: rect.left, bottom: window.innerHeight - rect.top + 4 });
            }}
          >
            {s.name}
          </button>
        )))}
      </div>
      {menu && (
        <ul ref={menuRef} className="dropdown-menu show shadow doc-menu sheet-tab-menu" style={{ left: menu.left, bottom: menu.bottom }} role="menu">
          {item('Rename', () => startRename(menu.index))}
          {item('Duplicate', () => onDuplicate(menu.index), sheets.length >= 50)}
          {item('Move left', () => onMove(menu.index, menu.index - 1), menu.index === 0)}
          {item('Move right', () => onMove(menu.index, menu.index + 1), menu.index === sheets.length - 1)}
          <li><hr className="dropdown-divider" /></li>
          {item('Delete', () => setConfirmDelete(menu.index), sheets.length <= 1)}
        </ul>
      )}
      {confirmDelete !== null && (
        <ConfirmModal
          title="Delete sheet?"
          message={`"${sheets[confirmDelete]?.name}" and everything on it will be deleted. Formulas that use it will show #REF!. You can undo this with Ctrl+Z.`}
          onConfirm={() => onDelete(confirmDelete)}
          onClose={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
