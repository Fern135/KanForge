import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCaretDown, faCheck, faChevronRight } from '@fortawesome/free-solid-svg-icons';
import useDropdown from '../../../core/hooks/useDropdown';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
// Shows shortcuts the way the platform does: "Ctrl+B" or "⌘B".
export const keys = (combo) => (isMac ? combo.replace(/Ctrl\+/g, '⌘').replace(/Shift\+/g, '⇧').replace(/Alt\+/g, '⌥') : combo);

// items: { label, icon, shortcut, onClick, disabled, checked, items (submenu) } or 'divider'.
function Items({ items, close }) {
  const [openSub, setOpenSub] = useState(null);
  return items.map((item, i) => {
    if (item === 'divider') return <li key={`d${i}`}><hr className="dropdown-divider" /></li>;
    if (!item || item.hidden) return null;
    const hasSub = Array.isArray(item.items);
    return (
      <li key={item.label} className={hasSub ? 'doc-submenu' : undefined}
        onMouseEnter={() => setOpenSub(hasSub ? item.label : null)}>
        <button
          type="button"
          className="dropdown-item d-flex align-items-center"
          disabled={item.disabled}
          aria-haspopup={hasSub ? 'menu' : undefined}
          aria-expanded={hasSub ? openSub === item.label : undefined}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (hasSub) {
              setOpenSub(openSub === item.label ? null : item.label);
              return;
            }
            close();
            item.onClick?.();
          }}
        >
          <span className="doc-menu-icon">
            {item.checked ? <FontAwesomeIcon icon={faCheck} /> : item.icon && <FontAwesomeIcon icon={item.icon} />}
          </span>
          <span className="me-auto" style={item.style}>{item.label}</span>
          {item.shortcut && <span className="doc-menu-shortcut">{keys(item.shortcut)}</span>}
          {hasSub && <FontAwesomeIcon icon={faChevronRight} className="ms-3 small text-muted" />}
        </button>
        {hasSub && openSub === item.label && (
          <ul className="dropdown-menu show shadow doc-menu doc-submenu-list" role="menu">
            <Items items={item.items} close={close} />
          </ul>
        )}
      </li>
    );
  });
}

// A button that opens a menu. `children` replaces the default label if given.
export function DropMenu({ label, icon, items, title, className = '', buttonClass = 'doc-menu-btn', caret = false, children, render }) {
  const menu = useDropdown();
  const close = () => menu.setOpen(false);
  return (
    <div className={`dropdown ${className}`} ref={menu.ref}>
      <button
        type="button"
        className={`${buttonClass} ${menu.open ? 'open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={menu.open}
        title={title}
        aria-label={title}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => menu.setOpen((o) => !o)}
      >
        {icon && <FontAwesomeIcon icon={icon} className={label ? 'me-1' : undefined} />}
        {children ?? label}
        {caret && <FontAwesomeIcon icon={faCaretDown} className="ms-1 small" />}
      </button>
      {menu.open && (
        <div className="dropdown-menu show shadow doc-menu" role="menu">
          {render ? render(close) : <ul className="list-unstyled m-0"><Items items={items} close={close} /></ul>}
        </div>
      )}
    </div>
  );
}

export function ToolButton({ label, shortcut, active, disabled, onClick, children, className = '' }) {
  const tip = shortcut ? `${label} (${keys(shortcut)})` : label;
  return (
    <button
      type="button"
      className={`doc-tool ${active ? 'active' : ''} ${className}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={tip}
    >
      {children}
    </button>
  );
}

// Word-style colour grid: theme colours in shades, then standard colours.
const THEME = ['#000000', '#ffffff', '#44546a', '#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47', '#264478'];
const SHADES = [
  ['#7f7f7f', '#f2f2f2', '#d6dce4', '#d9e2f3', '#fbe5d5', '#ededed', '#fff2cc', '#deebf6', '#e2efd9', '#b4c6e7'],
  ['#595959', '#d8d8d8', '#adb9ca', '#b4c6e7', '#f7cbac', '#dbdbdb', '#fee599', '#bdd7ee', '#c5e0b3', '#8eaadb'],
  ['#3f3f3f', '#bfbfbf', '#8496b0', '#8eaadb', '#f4b183', '#c9c9c9', '#ffd965', '#9cc3e5', '#a8d08d', '#2f5496'],
  ['#262626', '#a5a5a5', '#323f4f', '#2f5496', '#c55a11', '#7b7b7b', '#bf9000', '#2e75b5', '#538135', '#1f3864'],
];
const STANDARD = ['#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050', '#00b0f0', '#0070c0', '#002060', '#7030a0'];

export function ColorGrid({ onPick, resetLabel, close }) {
  const swatch = (c) => (
    <button key={c} type="button" className="doc-swatch" style={{ background: c }} title={c} aria-label={c}
      onMouseDown={(e) => e.preventDefault()} onClick={() => { close(); onPick(c); }} />
  );
  return (
    <div className="doc-colors">
      <button type="button" className="dropdown-item small px-2 mb-1" onMouseDown={(e) => e.preventDefault()}
        onClick={() => { close(); onPick(null); }}>{resetLabel}</button>
      <div className="small text-muted px-1">Theme colors</div>
      <div className="doc-swatch-row">{THEME.map(swatch)}</div>
      {SHADES.map((row, i) => <div className="doc-swatch-row tight" key={i}>{row.map(swatch)}</div>)}
      <div className="small text-muted px-1 mt-2">Standard colors</div>
      <div className="doc-swatch-row">{STANDARD.map(swatch)}</div>
    </div>
  );
}

// Hover a grid to choose a table size, like Word's Insert Table.
export function TableGrid({ onPick, close }) {
  const [hover, setHover] = useState({ r: 0, c: 0 });
  return (
    <div className="p-2">
      <div className="doc-table-grid" onMouseLeave={() => setHover({ r: 0, c: 0 })}>
        {Array.from({ length: 8 }, (_, r) => Array.from({ length: 10 }, (__, c) => (
          <button key={`${r}-${c}`} type="button" aria-label={`${r + 1} by ${c + 1} table`}
            className={r < hover.r && c < hover.c ? 'on' : ''}
            onMouseEnter={() => setHover({ r: r + 1, c: c + 1 })}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { close(); onPick(r + 1, c + 1); }} />
        )))}
      </div>
      <div className="small text-center text-muted mt-1">{hover.r ? `${hover.c} × ${hover.r} table` : 'Insert table'}</div>
    </div>
  );
}
