import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faEllipsisVertical, faUserGroup, faArrowUp, faArrowDown,
} from '@fortawesome/free-solid-svg-icons';
import { formatBytes, iconFor, iconColor } from '../utils/format';
import { shortDate, fullDate } from '../../../core/utils/dates';

// Items dragged within the page (to move them into a folder) carry their ids
// under this type. Files dragged in from the computer carry "Files" instead.
export const DRAG_TYPE = 'application/x-kanforge-files';
// Whether a drag carries files from the computer (an upload) or items from this page (a move).
export const isFromComputer = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
const isOurs = (e) => [...(e.dataTransfer?.types || [])].includes(DRAG_TYPE);

// The sortable columns of the list layout.
const COLUMNS = [
  { id: 'name', label: 'Name' },
  { id: 'updatedAt', label: 'Modified' },
  { id: 'size', label: 'Size' },
];

// The files and folders in the current view, as a list (like Drive's list
// layout) or a grid of tiles. Selection, opening and menus are handled by the
// page; this only reports what was clicked.
//
//   onSelect(item, event)      click (with Ctrl/Cmd or Shift for multi-select)
//   onOpen(item)               double-click or Enter
//   onMenu(item, {x, y})       right-click or the ⋮ button
//   canDrag(item)              whether it can be dragged to move it
//   onDropItems(folder, ids)   items from this page dropped onto a folder
//   onDropFiles(folder, e)     files from the computer dropped onto a folder
export default function ItemList({
  items, layout, sort, onSort, selected, showOwner, showTrashed,
  onSelect, onOpen, onMenu, canDrag, onDropItems, onDropFiles,
}) {
  // The folder something is being dragged over, highlighted as the drop target.
  const [over, setOver] = useState(null);

  // Folders accept drops: items from this page move into them, files from the
  // computer upload into them. Other items, and read-only views, accept nothing.
  // stopPropagation keeps the page's own drop zone (the open folder) out of it.
  const dropProps = (item) => (item.kind !== 'folder' || !(onDropItems || onDropFiles) ? {} : {
    onDragOver: (e) => {
      if (!isOurs(e) && !isFromComputer(e)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = isOurs(e) ? 'move' : 'copy';
      setOver(item.id);
    },
    onDragLeave: () => setOver((o) => (o === item.id ? null : o)),
    onDrop: (e) => {
      e.preventDefault();
      e.stopPropagation();
      setOver(null);
      if (isOurs(e)) {
        const ids = JSON.parse(e.dataTransfer.getData(DRAG_TYPE) || '[]').filter((id) => id !== item.id);
        if (ids.length) onDropItems?.(item, ids);
      } else if (isFromComputer(e)) {
        onDropFiles?.(item, e);
      }
    },
  });

  // What every row or tile responds to: selecting, opening, dragging, the
  // keyboard, right-click menus, and drops (for folders).
  const rowProps = (item) => ({
    'aria-selected': selected.has(item.id),
    tabIndex: 0,
    draggable: canDrag(item),
    onDragStart: (e) => {
      // Dragging an unselected item drags just it; a selected one drags the whole selection.
      const ids = selected.has(item.id) ? [...selected] : [item.id];
      e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids));
      e.dataTransfer.effectAllowed = 'move';
    },
    onClick: (e) => onSelect(item, e),
    onDoubleClick: () => onOpen(item),
    onKeyDown: (e) => {
      if (e.key === 'Enter') onOpen(item);
      else if (e.key === ' ') {
        e.preventDefault();
        onSelect(item, e);
      }
    },
    onContextMenu: (e) => {
      e.preventDefault();
      onMenu(item, { x: e.clientX, y: e.clientY }, e);
    },
    ...dropProps(item),
  });

  // The ⋮ button, which opens the same menu as right-click, just under itself.
  // It stops its clicks from also selecting or opening the row.
  const menuButton = (item) => (
    <button type="button" className="icon-btn files-row-menu" aria-label={`Actions for ${item.name}`}
      onClick={(e) => {
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        onMenu(item, { x: r.right, y: r.bottom });
      }}
      onDoubleClick={(e) => e.stopPropagation()}>
      <FontAwesomeIcon icon={faEllipsisVertical} />
    </button>
  );

  // The date shown: when it was trashed in the trash, otherwise when it last changed.
  const when = (item) => (showTrashed ? item.trashedAt : item.updatedAt);

  // Grid layout: folders and files in separate sections, like Drive. Files show
  // their preview image when they have one, otherwise a large icon.
  if (layout === 'grid') {
    const folders = items.filter((i) => i.kind === 'folder');
    const files = items.filter((i) => i.kind === 'file');
    const tile = (item) => (
      <div key={item.id} {...rowProps(item)} role="option" className={`files-tile files-tile-${item.kind} ${selected.has(item.id) ? 'selected' : ''} ${over === item.id ? 'drop-over' : ''}`}>
        {item.kind === 'file' && (
          <div className={`files-tile-thumb ${item.thumbUrl ? 'has-image' : ''}`}>
            {/* The preview image (photos fill the box, pages show from the top), or the file's icon. */}
            {item.thumbUrl ? (
              <img src={item.thumbUrl} alt="" loading="lazy" draggable={false}
                className={(item.mime || '').startsWith('image/') ? 'is-photo' : 'is-page'} />
            ) : (
              <FontAwesomeIcon icon={iconFor(item)} style={{ color: iconColor(item) }} size="3x" />
            )}
          </div>
        )}
        <div className="files-tile-name">
          <FontAwesomeIcon icon={iconFor(item)} style={{ color: iconColor(item) }} className="flex-shrink-0" />
          <span className="text-truncate" title={item.name}>{item.name}</span>
          {item.shared && <FontAwesomeIcon icon={faUserGroup} className="text-muted small flex-shrink-0" title="Shared" />}
          {menuButton(item)}
        </div>
      </div>
    );
    return (
      <div className="files-grid-wrap" role="listbox" aria-multiselectable="true" aria-label="Files and folders">
        {folders.length > 0 && <h2 className="files-grid-heading">Folders</h2>}
        {folders.length > 0 && <div className="files-grid files-grid-folders">{folders.map(tile)}</div>}
        {files.length > 0 && <h2 className="files-grid-heading">Files</h2>}
        {files.length > 0 && <div className="files-grid">{files.map(tile)}</div>}
      </div>
    );
  }

  // List layout: a header row of sort buttons, then one row per item. The owner
  // column shows only where items can belong to others (shared views, search).
  return (
    <div className="files-list" role="listbox" aria-multiselectable="true" aria-label="Files and folders">
      <div className={`files-row files-head ${showOwner ? 'with-owner' : ''}`} role="presentation">
        {COLUMNS.slice(0, 1).map((c) => <SortHeader key={c.id} column={c} sort={sort} onSort={onSort} />)}
        {showOwner && <span className="d-none d-md-block">Owner</span>}
        <SortHeader column={showTrashed ? { id: 'trashedAt', label: 'Trashed' } : COLUMNS[1]} sort={sort} onSort={onSort} className="d-none d-sm-block" />
        <SortHeader column={COLUMNS[2]} sort={sort} onSort={onSort} className="d-none d-sm-block text-end" />
        <span />
      </div>
      {items.map((item) => (
        <div key={item.id} {...rowProps(item)} role="option"
          className={`files-row ${showOwner ? 'with-owner' : ''} ${selected.has(item.id) ? 'selected' : ''} ${over === item.id ? 'drop-over' : ''}`}>
          <span className="d-flex align-items-center gap-2 min-w-0">
            <FontAwesomeIcon icon={iconFor(item)} style={{ color: iconColor(item) }} fixedWidth className="flex-shrink-0" />
            <span className="text-truncate" title={item.name}>{item.name}</span>
            {item.shared && <FontAwesomeIcon icon={faUserGroup} className="text-muted small flex-shrink-0" title="Shared" />}
          </span>
          {showOwner && <span className="d-none d-md-block text-truncate text-muted small">{item.ownerName ?? 'me'}</span>}
          <span className="d-none d-sm-block text-muted small" title={when(item) ? fullDate(when(item)) : ''}>{when(item) ? shortDate(when(item)) : ''}</span>
          <span className="d-none d-sm-block text-muted small text-end">{item.kind === 'file' ? formatBytes(item.size) : '—'}</span>
          {menuButton(item)}
        </div>
      ))}
    </div>
  );
}

// A column header that sorts by that column; clicking again flips the direction.
function SortHeader({ column, sort, onSort, className = '' }) {
  const active = sort.by === column.id;
  return (
    <button type="button" className={`files-sort ${active ? 'active' : ''} ${className}`} onClick={() => onSort(column.id)}
      aria-label={`Sort by ${column.label.toLowerCase()}`}>
      {column.label}
      {active && <FontAwesomeIcon icon={sort.dir === 'asc' ? faArrowUp : faArrowDown} className="ms-1 small" />}
    </button>
  );
}
