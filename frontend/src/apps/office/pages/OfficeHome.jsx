import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faPlus, faMagnifyingGlass, faFileWord, faFileExcel, faFilePowerpoint, faFileImport, faEllipsisVertical, faFolder,
  faFolderPlus, faPen, faCopy, faArrowRightToBracket, faTrashCan, faRotateLeft, faFolderOpen,
} from '@fortawesome/free-solid-svg-icons';
import { officeApi } from '../api';
import FolderTree, { DRAG_ITEM } from '../../../core/components/folders/FolderTree';
import MoveToFolderModal from '../../../core/components/folders/MoveToFolderModal';
import { buildTree, MAX_FOLDER_DEPTH } from '../../../core/components/folders/tree';
import ConfirmModal from '../../../core/components/ConfirmModal';
import Modal from '../../../core/components/Modal';
import Spinner from '../../../core/components/Spinner';
import useDropdown from '../../../core/hooks/useDropdown';
import { errorMessage } from '../../../core/api/client';
import { useToast } from '../../../core/context/ToastContext';
import { timeAgo } from '../../../core/utils/dates';
import '../office.scss';

const KIND = {
  doc: { icon: faFileWord, color: '#2b579a', label: 'Document', path: 'docs' },
  sheet: { icon: faFileExcel, color: '#217346', label: 'Spreadsheet', path: 'sheets' },
  slides: { icon: faFilePowerpoint, color: '#b7472a', label: 'Presentation', path: 'slides' },
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const sizeLabel = (bytes) => (bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

function useDebounced(value, ms) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function RenameModal({ doc, onRenamed, onClose }) {
  const [title, setTitle] = useState(doc.title);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const save = async (e) => {
    e?.preventDefault();
    setBusy(true);
    try {
      const { document } = await officeApi.update(doc.id, { title: title.trim(), version: doc.version });
      onRenamed(document);
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(false);
    }
  };
  return (
    <Modal title="Rename" onClose={onClose} footer={
      <>
        <button type="button" className="btn btn-light" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy}>OK</button>
      </>
    }>
      <form onSubmit={save}>
        <input className="form-control" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} aria-label="Name" />
      </form>
    </Modal>
  );
}

function RowMenu({ items }) {
  const menu = useDropdown();
  return (
    <div className="dropdown" ref={menu.ref}>
      <button type="button" className="icon-btn" aria-label="More actions" aria-haspopup="menu" aria-expanded={menu.open}
        onClick={(e) => { e.preventDefault(); menu.setOpen((o) => !o); }}>
        <FontAwesomeIcon icon={faEllipsisVertical} />
      </button>
      {menu.open && (
        <ul className="dropdown-menu dropdown-menu-end show shadow border-0" style={{ right: 0, left: 'auto' }} role="menu">
          {items.map((it) => (
            <li key={it.label}>
              <button type="button" className={`dropdown-item ${it.danger ? 'text-danger' : ''}`} onClick={() => { menu.setOpen(false); it.onClick(); }}>
                <FontAwesomeIcon icon={it.icon} className="me-2" fixedWidth />{it.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function OfficeHome() {
  const navigate = useNavigate();
  const toast = useToast();
  const newMenu = useDropdown();
  const docxInput = useRef(null);
  const [view, setView] = useState('active');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('all');
  const [deep, setDeep] = useState(false);
  const [docs, setDocs] = useState(null);
  const [folderData, setFolderData] = useState({ folders: [], totalCount: 0, unfiledCount: 0 });
  const [expanded, setExpanded] = useState(() => new Set());
  const [editing, setEditing] = useState(null);
  const [modal, setModal] = useState(null);
  const [importing, setImporting] = useState(false);
  const q = useDebounced(query.trim(), 250);

  const tree = useMemo(() => buildTree(folderData.folders), [folderData.folders]);
  const folderSelected = selected !== 'all' && selected !== 'unfiled';

  useEffect(() => {
    if (folderSelected && !tree.byId.has(selected)) setSelected('all');
  }, [folderSelected, selected, tree]);

  const loadDocs = useCallback(async () => {
    const params = { view, q: q || undefined };
    if (view !== 'trash' && selected !== 'all') {
      params.folder = selected;
      if (folderSelected && deep) params.deep = '1';
    }
    try {
      setDocs((await officeApi.list(params)).documents);
    } catch (err) {
      toast.error(errorMessage(err));
      setDocs([]);
    }
  }, [view, q, selected, folderSelected, deep, toast]);

  const loadFolders = useCallback(() => {
    officeApi.folders().then(setFolderData).catch((err) => toast.error(errorMessage(err)));
  }, [toast]);

  const refresh = useCallback(() => {
    loadDocs();
    loadFolders();
  }, [loadDocs, loadFolders]);

  useEffect(() => {
    loadDocs();
  }, [loadDocs]);
  useEffect(() => {
    loadFolders();
  }, [loadFolders]);

  const open = (id) => setExpanded((s) => new Set(s).add(id));
  const toggle = (id) => setExpanded((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const create = async (kind) => {
    newMenu.setOpen(false);
    try {
      const { document } = await officeApi.create({ kind, folderId: folderSelected ? selected : null });
      navigate(`/office/${KIND[kind].path}/${document.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const onImport = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setImporting(true);
    try {
      const { importDocx } = await import('../docs/importDocx');
      const result = await importDocx(file);
      const { document } = await officeApi.create({ kind: 'doc', title: result.title, content: result.content, folderId: folderSelected ? selected : null });
      if (result.warnings) toast.error(result.warnings);
      navigate(`/office/docs/${document.id}`);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not open that Word document'));
      setImporting(false);
    }
  };

  // ---------- Folders ----------

  const submitEdit = async (name) => {
    const edit = editing;
    setEditing(null);
    try {
      if (edit.mode === 'create') {
        await officeApi.createFolder(name, edit.parentId || null);
        if (edit.parentId) open(edit.parentId);
      } else if (name !== tree.byId.get(edit.id)?.name) {
        await officeApi.updateFolder(edit.id, { name });
      }
      loadFolders();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const moveFolder = async (folderId, parentId) => {
    if (folderId === parentId || (parentId && tree.subtree(folderId).includes(parentId))) {
      toast.error("A folder can't go inside itself");
      return;
    }
    if ((tree.byId.get(folderId)?.parentId ?? null) === parentId) return;
    if (parentId && tree.depth(parentId) + tree.height(folderId) > MAX_FOLDER_DEPTH) {
      toast.error(`Folders can be nested up to ${MAX_FOLDER_DEPTH} levels deep`);
      return;
    }
    try {
      await officeApi.updateFolder(folderId, { parentId });
      if (parentId) open(parentId);
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  };

  const moveDoc = async (id, folderId) => {
    try {
      await officeApi.update(id, { folderId });
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  };

  const deleteFolder = async (id) => {
    try {
      const data = await officeApi.removeFolder(id);
      toast.success(data.trashedItems ? `Folder deleted. ${plural(data.trashedItems, 'document')} moved to the trash.` : 'Folder deleted');
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  };

  // ---------- Documents ----------

  const act = (fn, success) => async (...args) => {
    try {
      await fn(...args);
      if (success) toast.success(success);
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  };
  const copyDoc = act((d) => officeApi.copy(d.id), 'Copy created');
  const trashDoc = act((d) => officeApi.trash(d.id), 'Moved to the trash');
  const restoreDoc = act((d) => officeApi.restore(d.id), 'Restored');
  const deleteDoc = act((d) => officeApi.remove(d.id), 'Deleted forever');
  const emptyTrash = act(() => officeApi.emptyTrash(), 'Trash emptied');

  const location = view === 'trash'
    ? 'Trash'
    : selected === 'all' ? 'All documents' : selected === 'unfiled' ? 'Unfiled' : tree.pathNames(selected).join(' / ');
  const deletingFolder = modal?.type === 'deleteFolder' ? tree.byId.get(modal.id) : null;
  const showFolderColumn = view === 'trash' || selected === 'all' || deep;

  return (
    <div className="office-page">
      <aside className="office-sidebar">
        <div className="p-3 pb-2">
          <div className="d-flex align-items-center gap-2 mb-2">
            <h1 className="h5 fw-bold text-primary mb-0 me-auto">Office</h1>
            <div className="dropdown" ref={newMenu.ref}>
              <button type="button" className="btn btn-sm btn-accent" aria-haspopup="menu" aria-expanded={newMenu.open} onClick={() => newMenu.setOpen((o) => !o)}>
                <FontAwesomeIcon icon={faPlus} className="me-1" />New
              </button>
              {newMenu.open && (
                <ul className="dropdown-menu dropdown-menu-end show shadow border-0" style={{ right: 0, left: 'auto' }} role="menu">
                  {Object.entries(KIND).map(([kind, k]) => (
                    <li key={kind}>
                      <button type="button" className="dropdown-item d-flex align-items-center" disabled={kind !== 'doc'} onClick={() => create(kind)}>
                        <FontAwesomeIcon icon={k.icon} className="me-2" style={{ color: k.color }} fixedWidth />{k.label}
                        {kind !== 'doc' && <span className="badge text-bg-light ms-auto ps-2">Coming soon</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className="input-group input-group-sm mb-2">
            <span className="input-group-text"><FontAwesomeIcon icon={faMagnifyingGlass} /></span>
            <input type="search" className="form-control" placeholder="Search documents" value={query} maxLength={100}
              onChange={(e) => setQuery(e.target.value)} aria-label="Search documents" />
          </div>
          <div className="btn-group btn-group-sm w-100" role="group" aria-label="Which documents">
            {[['active', 'Documents'], ['trash', 'Trash']].map(([id, label]) => (
              <button key={id} type="button" className={`btn ${view === id ? 'btn-primary' : 'btn-outline-primary'}`} aria-pressed={view === id} onClick={() => setView(id)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {view !== 'trash' && (
          <div className="folders-section border-top">
            <div className="d-flex align-items-center px-3 pt-2">
              <span className="small fw-bold text-uppercase text-muted me-auto">Folders</span>
              <button type="button" className="icon-btn" onClick={() => setEditing({ mode: 'create', parentId: null })} aria-label="New folder" title="New folder">
                <FontAwesomeIcon icon={faFolderPlus} />
              </button>
            </div>
            <FolderTree
              tree={tree}
              allLabel="All documents"
              allCount={folderData.totalCount}
              unfiledCount={folderData.unfiledCount}
              selected={selected}
              expanded={expanded}
              editing={editing}
              onSelect={setSelected}
              onToggle={toggle}
              onCreate={(parentId) => { open(parentId); setEditing({ mode: 'create', parentId }); }}
              onRename={(id) => setEditing({ mode: 'rename', id })}
              onMove={(id) => setModal({ type: 'moveFolder', id })}
              onDelete={(id) => setModal({ type: 'deleteFolder', id })}
              onSubmitEdit={submitEdit}
              onCancelEdit={() => setEditing(null)}
              onDropOnFolder={(item, folderId) => {
                if (item.itemId) moveDoc(item.itemId, folderId).catch(() => {});
                else if (item.folderId) moveFolder(item.folderId, folderId).catch(() => {});
              }}
            />
          </div>
        )}
      </aside>

      <main className="office-main">
        <div className="office-toolbar">
          <FontAwesomeIcon icon={view === 'trash' ? faTrashCan : faFolderOpen} className="text-muted" />
          <h2 className="h6 fw-bold mb-0 text-truncate me-auto">{location}</h2>
          {folderSelected && view !== 'trash' && tree.kids(selected).length > 0 && (
            <div className="form-check form-switch m-0 small">
              <input className="form-check-input" type="checkbox" role="switch" id="office-deep" checked={deep} onChange={(e) => setDeep(e.target.checked)} />
              <label className="form-check-label" htmlFor="office-deep">Include subfolders</label>
            </div>
          )}
          {view === 'trash' ? (
            docs?.length > 0 && <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => setModal({ type: 'emptyTrash' })}>Empty trash</button>
          ) : (
            <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => docxInput.current?.click()} disabled={importing}>
              <FontAwesomeIcon icon={faFileImport} className="me-1" />{importing ? 'Importing…' : 'Import Word file'}
            </button>
          )}
        </div>
        {view === 'trash' && <div className="form-text px-3 mt-0 mb-2">Documents in the trash are deleted after 30 days.</div>}

        {!docs ? (
          <div className="p-5 text-center"><Spinner /></div>
        ) : docs.length === 0 ? (
          <div className="text-center text-muted p-5">
            {q ? 'No documents match.' : view === 'trash' ? 'The trash is empty.' : (
              <>
                <FontAwesomeIcon icon={faFileWord} size="3x" className="mb-3" style={{ color: '#2b579a', opacity: 0.35 }} />
                <p className="mb-3">No documents here yet.</p>
                <button type="button" className="btn btn-primary" onClick={() => create('doc')}>
                  <FontAwesomeIcon icon={faPlus} className="me-2" />Blank document
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="office-list" role="table" aria-label="Documents">
            <div className="office-row office-head" role="row">
              <span role="columnheader">Name</span>
              {showFolderColumn && <span role="columnheader" className="d-none d-lg-block">Location</span>}
              <span role="columnheader" className="d-none d-sm-block">{view === 'trash' ? 'Deleted' : 'Modified'}</span>
              <span role="columnheader" className="d-none d-md-block text-end">Size</span>
              <span />
            </div>
            {docs.map((d) => {
              const k = KIND[d.kind];
              const trashed = Boolean(d.trashedAt);
              const where = d.folderId && tree.byId.has(d.folderId) ? tree.pathNames(d.folderId).join(' / ') : '—';
              const items = trashed
                ? [
                  { label: 'Restore', icon: faRotateLeft, onClick: () => restoreDoc(d).catch(() => {}) },
                  { label: 'Delete forever', icon: faTrashCan, danger: true, onClick: () => setModal({ type: 'deleteDoc', doc: d }) },
                ]
                : [
                  { label: 'Open', icon: faFolderOpen, onClick: () => navigate(`/office/${k.path}/${d.id}`) },
                  { label: 'Rename', icon: faPen, onClick: () => setModal({ type: 'rename', doc: d }) },
                  { label: 'Make a copy', icon: faCopy, onClick: () => copyDoc(d).catch(() => {}) },
                  { label: 'Move to…', icon: faArrowRightToBracket, onClick: () => setModal({ type: 'moveDoc', doc: d }) },
                  { label: 'Move to trash', icon: faTrashCan, danger: true, onClick: () => trashDoc(d).catch(() => {}) },
                ];
              return (
                <div key={d.id} className="office-row" role="row" draggable={!trashed}
                  onDragStart={(e) => { e.dataTransfer.setData(DRAG_ITEM, d.id); e.dataTransfer.effectAllowed = 'move'; }}>
                  <span role="cell" className="d-flex align-items-center gap-2 min-w-0">
                    <FontAwesomeIcon icon={k.icon} style={{ color: k.color }} fixedWidth />
                    {trashed ? (
                      <span className="text-truncate">{d.title || 'Untitled document'}</span>
                    ) : (
                      <Link to={`/office/${k.path}/${d.id}`} className="office-name text-truncate">{d.title || 'Untitled document'}</Link>
                    )}
                  </span>
                  {showFolderColumn && (
                    <span role="cell" className="d-none d-lg-block text-muted small text-truncate">
                      {where !== '—' && <FontAwesomeIcon icon={faFolder} className="me-1" />}{where}
                    </span>
                  )}
                  <span role="cell" className="d-none d-sm-block text-muted small">{timeAgo(d.trashedAt || d.updatedAt)}</span>
                  <span role="cell" className="d-none d-md-block text-muted small text-end">{sizeLabel(d.size)}</span>
                  <span role="cell" className="text-end"><RowMenu items={items} /></span>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <input ref={docxInput} type="file" className="d-none" onChange={onImport}
        accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" />

      {modal?.type === 'rename' && <RenameModal doc={modal.doc} onRenamed={() => refresh()} onClose={() => setModal(null)} />}
      {modal?.type === 'moveDoc' && (
        <MoveToFolderModal tree={tree} title="Move document to…" currentId={modal.doc.folderId && tree.byId.has(modal.doc.folderId) ? modal.doc.folderId : null}
          onMove={(folderId) => moveDoc(modal.doc.id, folderId)} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'moveFolder' && tree.byId.has(modal.id) && (
        <MoveToFolderModal tree={tree} title={`Move "${tree.byId.get(modal.id).name}" to…`} currentId={tree.byId.get(modal.id).parentId}
          movingFolderId={modal.id} onMove={(parentId) => moveFolder(modal.id, parentId)} onClose={() => setModal(null)} />
      )}
      {deletingFolder && (
        <ConfirmModal
          title={`Delete "${deletingFolder.name}"?`}
          message={(() => {
            const subfolders = tree.subtree(deletingFolder.id).length - 1;
            const count = tree.itemTotal(deletingFolder.id);
            const parts = [];
            if (subfolders) parts.push(`its ${plural(subfolders, 'subfolder')} will be deleted too`);
            if (count) parts.push(`${plural(count, 'document')} will move to the trash, where you can restore them for 30 days`);
            return parts.length ? `The folder is deleted, ${parts.join(', and ')}.` : 'The folder is empty.';
          })()}
          confirmLabel="Delete folder"
          onConfirm={() => deleteFolder(deletingFolder.id)}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'deleteDoc' && (
        <ConfirmModal title="Delete forever?" message={`"${modal.doc.title || 'Untitled document'}" can't be recovered afterwards.`}
          confirmLabel="Delete forever" onConfirm={() => deleteDoc(modal.doc)} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'emptyTrash' && (
        <ConfirmModal title="Empty the trash?" message="Every document in the trash is deleted forever."
          confirmLabel="Empty trash" onConfirm={() => emptyTrash()} onClose={() => setModal(null)} />
      )}
    </div>
  );
}
