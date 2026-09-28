import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faChevronRight, faChevronDown, faFolder, faFolderOpen, faInbox, faLayerGroup, faEllipsis,
  faFolderPlus, faPen, faArrowRightToBracket, faTrashCan,
} from '@fortawesome/free-solid-svg-icons';
import useDropdown from '../../../core/hooks/useDropdown';
import { MAX_FOLDER_DEPTH } from '../utils/folders';

// Drag-and-drop payload types, so a drop knows whether a note or a folder landed.
export const DRAG_NOTE = 'application/x-kanforge-note';
export const DRAG_FOLDER = 'application/x-kanforge-folder';

// A drop target: highlights while something is dragged over it.
function useDropZone(onDrop) {
  const [over, setOver] = useState(false);
  const accepts = (e) => e.dataTransfer.types.includes(DRAG_NOTE) || e.dataTransfer.types.includes(DRAG_FOLDER);
  return {
    over,
    props: {
      onDragOver: (e) => {
        if (!accepts(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (e) => {
        setOver(false);
        if (!accepts(e)) return;
        e.preventDefault();
        const noteId = e.dataTransfer.getData(DRAG_NOTE);
        const folderId = e.dataTransfer.getData(DRAG_FOLDER);
        onDrop(noteId ? { noteId } : { folderId });
      },
    },
  };
}

function NameInput({ initial = '', onSubmit, onCancel, depth }) {
  const [name, setName] = useState(initial);
  const submit = () => (name.trim() ? onSubmit(name.trim()) : onCancel());
  return (
    <div className="folder-row" style={{ paddingLeft: `${0.5 + depth * 0.9}rem` }}>
      <FontAwesomeIcon icon={faFolder} className="text-muted me-2" fixedWidth />
      <input
        className="form-control form-control-sm"
        value={name}
        maxLength={100}
        autoFocus
        placeholder="Folder name"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') onCancel();
        }}
        onBlur={submit}
        aria-label="Folder name"
      />
    </div>
  );
}

function SpecialRow({ icon, label, active, onClick, onDrop, count }) {
  const drop = useDropZone(onDrop);
  return (
    <button type="button" className={`folder-row ${active ? 'active' : ''} ${drop.over ? 'drop-over' : ''}`} onClick={onClick} {...drop.props}>
      <span className="folder-toggle" />
      <FontAwesomeIcon icon={icon} className="me-2 text-muted" fixedWidth />
      <span className="text-truncate me-auto">{label}</span>
      {count > 0 && <span className="folder-count">{count}</span>}
    </button>
  );
}

function FolderRow({ folder, tree, depth, ctx }) {
  const menu = useDropdown();
  const open = ctx.expanded.has(folder.id);
  const kids = tree.kids(folder.id);
  const active = ctx.selected === folder.id;
  const drop = useDropZone((item) => ctx.onDropOnFolder(item, folder.id));
  const canNest = tree.depth(folder.id) < MAX_FOLDER_DEPTH;
  const count = tree.noteTotal(folder.id);

  if (ctx.editing?.mode === 'rename' && ctx.editing.id === folder.id) {
    return <NameInput initial={folder.name} depth={depth} onSubmit={(name) => ctx.onSubmitEdit(name)} onCancel={ctx.onCancelEdit} />;
  }

  const act = (fn) => () => {
    menu.setOpen(false);
    fn();
  };

  return (
    <>
      <div
        className={`folder-row ${active ? 'active' : ''} ${drop.over ? 'drop-over' : ''}`}
        style={{ paddingLeft: `${0.5 + depth * 0.9}rem` }}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_FOLDER, folder.id);
          e.dataTransfer.effectAllowed = 'move';
        }}
        {...drop.props}
      >
        <button type="button" className="folder-toggle" onClick={() => ctx.onToggle(folder.id)}
          aria-label={open ? `Collapse ${folder.name}` : `Expand ${folder.name}`} style={{ visibility: kids.length ? 'visible' : 'hidden' }}>
          <FontAwesomeIcon icon={open ? faChevronDown : faChevronRight} />
        </button>
        <button type="button" className="folder-name" onClick={() => ctx.onSelect(folder.id)} aria-current={active ? 'true' : undefined}>
          <FontAwesomeIcon icon={active || open ? faFolderOpen : faFolder} className="me-2 folder-icon" fixedWidth />
          <span className="text-truncate">{folder.name}</span>
        </button>
        {count > 0 && <span className="folder-count">{count}</span>}
        <div className="dropdown" ref={menu.ref}>
          <button type="button" className="folder-menu-btn" aria-label={`${folder.name} options`} aria-haspopup="menu" aria-expanded={menu.open}
            onClick={() => menu.setOpen((o) => !o)}>
            <FontAwesomeIcon icon={faEllipsis} />
          </button>
          {menu.open && (
            <ul className="dropdown-menu dropdown-menu-end show shadow border-0" style={{ right: 0, left: 'auto' }} role="menu">
              {canNest && (
                <li><button type="button" className="dropdown-item" onClick={act(() => ctx.onCreate(folder.id))}>
                  <FontAwesomeIcon icon={faFolderPlus} className="me-2" fixedWidth />New subfolder
                </button></li>
              )}
              <li><button type="button" className="dropdown-item" onClick={act(() => ctx.onRename(folder.id))}>
                <FontAwesomeIcon icon={faPen} className="me-2" fixedWidth />Rename
              </button></li>
              <li><button type="button" className="dropdown-item" onClick={act(() => ctx.onMove(folder.id))}>
                <FontAwesomeIcon icon={faArrowRightToBracket} className="me-2" fixedWidth />Move to…
              </button></li>
              <li><button type="button" className="dropdown-item text-danger" onClick={act(() => ctx.onDelete(folder.id))}>
                <FontAwesomeIcon icon={faTrashCan} className="me-2" fixedWidth />Delete
              </button></li>
            </ul>
          )}
        </div>
      </div>
      {open && kids.map((k) => <FolderRow key={k.id} folder={k} tree={tree} depth={depth + 1} ctx={ctx} />)}
      {ctx.editing?.mode === 'create' && ctx.editing.parentId === folder.id && (
        <NameInput depth={depth + 1} onSubmit={(name) => ctx.onSubmitEdit(name)} onCancel={ctx.onCancelEdit} />
      )}
    </>
  );
}

// The sidebar's folder list. "All notes" and "Unfiled" sit above the folders;
// dropping on "Unfiled" takes a note out of its folder, or moves a folder to the top level.
export default function FolderTree({ tree, unfiledCount, allCount, ...ctx }) {
  return (
    <nav className="folder-tree" aria-label="Folders">
      <SpecialRow icon={faLayerGroup} label="All notes" active={ctx.selected === 'all'} count={allCount}
        onClick={() => ctx.onSelect('all')} onDrop={(item) => ctx.onDropOnFolder(item, null)} />
      <SpecialRow icon={faInbox} label="Unfiled" active={ctx.selected === 'unfiled'} count={unfiledCount}
        onClick={() => ctx.onSelect('unfiled')} onDrop={(item) => ctx.onDropOnFolder(item, null)} />
      {tree.kids(null).map((f) => <FolderRow key={f.id} folder={f} tree={tree} depth={0} ctx={ctx} />)}
      {ctx.editing?.mode === 'create' && !ctx.editing.parentId && (
        <NameInput depth={0} onSubmit={(name) => ctx.onSubmitEdit(name)} onCancel={ctx.onCancelEdit} />
      )}
    </nav>
  );
}
