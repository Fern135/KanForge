import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { zipSync, strToU8 } from 'fflate';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faPlus, faMagnifyingGlass, faEllipsisVertical, faFileImport, faFileExport, faTrashCan, faThumbtack, faNoteSticky,
  faFolderPlus, faFolder,
} from '@fortawesome/free-solid-svg-icons';
import { notesApi } from '../api';
import { toMarkdown, fileNames } from '../utils/markdown';
import { downloadBlob } from '../../../core/utils/download';
import { buildTree, MAX_FOLDER_DEPTH } from '../../../core/components/folders/tree';
import NoteEditor from '../components/NoteEditor';
import ImportNotesModal from '../components/ImportNotesModal';
import MoveToFolderModal from '../../../core/components/folders/MoveToFolderModal';
import FolderTree, { DRAG_ITEM } from '../../../core/components/folders/FolderTree';
import ConfirmModal from '../../../core/components/ConfirmModal';
import Spinner from '../../../core/components/Spinner';
import useDropdown from '../../../core/hooks/useDropdown';
import { errorMessage } from '../../../core/api/client';
import { useToast } from '../../../core/context/ToastContext';
import { timeAgo } from '../../../core/utils/dates';

const VIEWS = [
  { id: 'active', label: 'Notes' },
  { id: 'archived', label: 'Archive' },
  { id: 'trash', label: 'Trash' },
];

const EXPANDED_KEY = 'kanforge.notes.expandedFolders';

const byListOrder = (view) => (a, b) => {
  if (view === 'trash') return (b.trashedAt || '').localeCompare(a.trashedAt || '');
  return Number(b.pinned) - Number(a.pinned) || (b.updatedAt || '').localeCompare(a.updatedAt || '');
};

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Waits until typing pauses before searching.
function useDebounced(value, ms) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

// Which folders are open in the tree, remembered in this browser only.
function useExpanded() {
  const [expanded, setExpanded] = useState(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) || '[]'));
    } catch {
      return new Set();
    }
  });
  const save = (next) => {
    setExpanded(next);
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]));
    } catch {
      // Storage can be unavailable (private windows); the tree still works.
    }
  };
  const toggle = (id) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    save(next);
  };
  const open = (id) => !expanded.has(id) && save(new Set(expanded).add(id));
  return { expanded, toggle, open };
}

export default function Notes() {
  const { noteId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const menu = useDropdown();
  const { expanded, toggle, open } = useExpanded();
  const [view, setView] = useState('active');
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('');
  // 'all', 'unfiled', or a folder id.
  const [selected, setSelected] = useState('all');
  const [deep, setDeep] = useState(false);
  const [notes, setNotes] = useState(null);
  const [tags, setTags] = useState([]);
  const [folderData, setFolderData] = useState({ folders: [], totalCount: 0, unfiledCount: 0 });
  const [editing, setEditing] = useState(null);
  const [modal, setModal] = useState(null);
  // Tells the open editor when its note was moved from the sidebar.
  const [moved, setMoved] = useState(null);
  const q = useDebounced(query.trim(), 250);

  const tree = useMemo(() => buildTree(folderData.folders), [folderData.folders]);
  const folderSelected = selected !== 'all' && selected !== 'unfiled';

  // A deleted folder can't stay selected.
  useEffect(() => {
    if (folderSelected && !tree.byId.has(selected)) setSelected('all');
  }, [folderSelected, selected, tree]);

  const loadList = useCallback(async () => {
    const params = { view, q: q || undefined, tag: tag || undefined };
    if (view !== 'trash' && selected !== 'all') {
      params.folder = selected;
      if (folderSelected && deep) params.deep = '1';
    }
    try {
      const data = await notesApi.list(params);
      setNotes(data.notes);
    } catch (err) {
      toast.error(errorMessage(err));
      setNotes([]);
    }
  }, [view, q, tag, selected, folderSelected, deep, toast]);

  const loadTags = useCallback(() => {
    notesApi.tags().then((d) => setTags(d.tags)).catch(() => {});
  }, []);

  const loadFolders = useCallback(() => {
    notesApi.folders().then(setFolderData).catch((err) => toast.error(errorMessage(err)));
  }, [toast]);

  useEffect(() => {
    loadList();
  }, [loadList]);
  useEffect(() => {
    loadTags();
    loadFolders();
  }, [loadTags, loadFolders]);

  // Whether a note belongs in the list as currently filtered.
  const inList = useCallback((note) => {
    if (view === 'trash') return Boolean(note.trashedAt);
    if (note.trashedAt || note.archived !== (view === 'archived')) return false;
    if (selected === 'unfiled') return !note.folderId;
    if (folderSelected) return deep ? tree.subtree(selected).includes(note.folderId) : note.folderId === selected;
    return true;
  }, [view, selected, folderSelected, deep, tree]);

  const createNote = async () => {
    try {
      const body = { folderId: folderSelected ? selected : null };
      if (tag) body.tags = [tag];
      const { note } = await notesApi.create(body);
      if (view !== 'active') setView('active');
      else setNotes((list) => [note, ...(list || [])].sort(byListOrder('active')));
      loadFolders();
      navigate(`/notes/${note.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  // The editor reports every save, so the list stays current without reloading.
  // `structural` changes (folder, tags, pin, archive) also refresh counts.
  const onChanged = useCallback((saved, structural = false) => {
    setNotes((list) => {
      if (!list) return list;
      const rest = list.filter((n) => n.id !== saved.id);
      return inList(saved) ? [saved, ...rest].sort(byListOrder(view)) : rest;
    });
    if (structural) {
      loadTags();
      loadFolders();
    }
  }, [inList, view, loadTags, loadFolders]);

  const onRemoved = useCallback((id) => {
    setNotes((list) => list?.filter((n) => n.id !== id) ?? list);
    loadTags();
    loadFolders();
    navigate('/notes', { replace: true });
  }, [navigate, loadTags, loadFolders]);

  const closeEditor = useCallback(() => navigate('/notes'), [navigate]);

  // ---------- Folders ----------

  const selectFolder = (id) => {
    setSelected(id);
    if (view === 'trash') setView('active');
  };

  const submitEdit = async (name) => {
    const edit = editing;
    setEditing(null);
    try {
      if (edit.mode === 'create') {
        await notesApi.createFolder(name, edit.parentId || null);
        if (edit.parentId) open(edit.parentId);
      } else if (name !== tree.byId.get(edit.id)?.name) {
        await notesApi.updateFolder(edit.id, { name });
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
      await notesApi.updateFolder(folderId, { parentId });
      if (parentId) open(parentId);
      loadFolders();
      loadList();
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  };

  const moveNote = async (id, folderId) => {
    try {
      const { note } = await notesApi.update(id, { folderId });
      onChanged(note, true);
      setMoved({ id, folderId, at: Date.now() });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const onDropOnFolder = (item, folderId) => {
    if (item.itemId) moveNote(item.itemId, folderId);
    else if (item.folderId) moveFolder(item.folderId, folderId).catch(() => {});
  };

  const deleteFolder = async (id) => {
    try {
      const data = await notesApi.removeFolder(id);
      toast.success(data.trashedItems
        ? `Folder deleted. ${plural(data.trashedItems, 'note')} moved to the trash.`
        : 'Folder deleted');
      if (folderSelected && tree.subtree(id).includes(selected)) setSelected('all');
      if (noteId) navigate('/notes', { replace: true });
      loadFolders();
      loadList();
      loadTags();
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  };

  // ---------- Import / export ----------

  const exportAll = async () => {
    menu.setOpen(false);
    try {
      const data = await notesApi.exportAll();
      if (!data.notes.length) {
        toast.success('There are no notes to export');
        return;
      }
      const names = fileNames(data.notes);
      const files = Object.fromEntries(data.notes.map((n, i) => [names[i], strToU8(toMarkdown(n))]));
      downloadBlob(new Blob([zipSync(files)], { type: 'application/zip' }), 'kanforge-notes.zip');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const emptyTrash = async () => {
    try {
      const data = await notesApi.emptyTrash();
      toast.success(`Deleted ${plural(data.deleted, 'note')}`);
      setNotes([]);
      if (noteId) navigate('/notes', { replace: true });
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  };

  const openModal = (m) => {
    menu.setOpen(false);
    setModal(m);
  };

  const locationLabel = view === 'trash'
    ? 'Trash'
    : selected === 'all' ? 'All notes' : selected === 'unfiled' ? 'Unfiled' : tree.pathNames(selected).join(' / ');
  const deletingFolder = modal?.type === 'deleteFolder' ? tree.byId.get(modal.id) : null;

  return (
    <div className="notes-page">
      <aside className={`notes-sidebar ${noteId ? 'd-none d-md-flex' : 'd-flex'}`}>
        <div className="p-3 pb-2 border-bottom">
          <div className="d-flex align-items-center gap-2 mb-2">
            <h1 className="h5 fw-bold text-primary mb-0 me-auto">Notes</h1>
            <button type="button" className="btn btn-sm btn-accent" onClick={createNote}>
              <FontAwesomeIcon icon={faPlus} className="me-1" />New
            </button>
            <div className="dropdown" ref={menu.ref}>
              <button type="button" className="icon-btn" aria-label="More" aria-haspopup="menu" aria-expanded={menu.open}
                onClick={() => menu.setOpen((o) => !o)}>
                <FontAwesomeIcon icon={faEllipsisVertical} />
              </button>
              {menu.open && (
                <ul className="dropdown-menu dropdown-menu-end show shadow border-0" style={{ right: 0, left: 'auto' }} role="menu">
                  <li>
                    <button type="button" className="dropdown-item" onClick={() => openModal({ type: 'import' })}>
                      <FontAwesomeIcon icon={faFileImport} className="me-2" fixedWidth />Import Markdown
                    </button>
                  </li>
                  <li>
                    <button type="button" className="dropdown-item" onClick={exportAll}>
                      <FontAwesomeIcon icon={faFileExport} className="me-2" fixedWidth />Export all (.zip)
                    </button>
                  </li>
                  {view === 'trash' && (
                    <li>
                      <button type="button" className="dropdown-item text-danger" onClick={() => openModal({ type: 'emptyTrash' })}>
                        <FontAwesomeIcon icon={faTrashCan} className="me-2" fixedWidth />Empty trash
                      </button>
                    </li>
                  )}
                </ul>
              )}
            </div>
          </div>
          <div className="input-group input-group-sm mb-2">
            <span className="input-group-text"><FontAwesomeIcon icon={faMagnifyingGlass} /></span>
            <input type="search" className="form-control" placeholder="Search notes" value={query} maxLength={100}
              onChange={(e) => setQuery(e.target.value)} aria-label="Search notes" />
          </div>
          <div className="d-flex gap-2">
            <div className="btn-group btn-group-sm flex-grow-1" role="group" aria-label="Which notes">
              {VIEWS.map((v) => (
                <button key={v.id} type="button" className={`btn ${view === v.id ? 'btn-primary' : 'btn-outline-primary'}`}
                  aria-pressed={view === v.id} onClick={() => setView(v.id)}>
                  {v.label}
                </button>
              ))}
            </div>
            {tags.length > 0 && (
              <select className="form-select form-select-sm w-auto" value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Filter by tag">
                <option value="">All tags</option>
                {tags.map((t) => <option key={t.name} value={t.name}>{t.name} ({t.count})</option>)}
              </select>
            )}
          </div>
        </div>

        {view !== 'trash' && (
          <div className="folders-section border-bottom">
            <div className="d-flex align-items-center px-3 pt-2">
              <span className="small fw-bold text-uppercase text-muted me-auto">Folders</span>
              <button type="button" className="icon-btn" onClick={() => setEditing({ mode: 'create', parentId: null })}
                aria-label="New folder" title="New folder">
                <FontAwesomeIcon icon={faFolderPlus} />
              </button>
            </div>
            <FolderTree
              tree={tree}
              allLabel="All notes"
              allCount={folderData.totalCount}
              unfiledCount={folderData.unfiledCount}
              selected={selected}
              expanded={expanded}
              editing={editing}
              onSelect={selectFolder}
              onToggle={toggle}
              onCreate={(parentId) => {
                open(parentId);
                setEditing({ mode: 'create', parentId });
              }}
              onRename={(id) => setEditing({ mode: 'rename', id })}
              onMove={(id) => setModal({ type: 'moveFolder', id })}
              onDelete={(id) => setModal({ type: 'deleteFolder', id })}
              onSubmitEdit={submitEdit}
              onCancelEdit={() => setEditing(null)}
              onDropOnFolder={onDropOnFolder}
            />
          </div>
        )}

        <div className="d-flex align-items-center gap-2 px-3 py-2 border-bottom small">
          <FontAwesomeIcon icon={faFolder} className="text-muted" />
          <span className="fw-semibold text-truncate me-auto">{locationLabel}</span>
          {folderSelected && view !== 'trash' && tree.kids(selected).length > 0 && (
            <div className="form-check form-switch m-0 flex-shrink-0">
              <input className="form-check-input" type="checkbox" role="switch" id="notes-deep" checked={deep} onChange={(e) => setDeep(e.target.checked)} />
              <label className="form-check-label" htmlFor="notes-deep">Include subfolders</label>
            </div>
          )}
        </div>
        {view === 'trash' && <div className="form-text px-3 pt-2 mt-0">Notes in the trash are deleted after 30 days.</div>}

        <div className="notes-list">
          {!notes ? (
            <div className="p-4 text-center"><Spinner small /></div>
          ) : notes.length === 0 ? (
            <p className="text-muted small text-center p-4 mb-0">
              {q || tag ? 'No notes match.' : view === 'trash' ? 'The trash is empty.' : view === 'archived' ? 'Nothing archived here.' : 'No notes here yet.'}
            </p>
          ) : (
            notes.map((n) => {
              const folderNames = selected === 'all' || deep ? (n.folderId && tree.byId.has(n.folderId) ? tree.pathNames(n.folderId) : []) : [];
              return (
                <Link
                  key={n.id}
                  to={`/notes/${n.id}`}
                  className={`note-item ${n.id === noteId ? 'active' : ''}`}
                  draggable={!n.trashedAt}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DRAG_ITEM, n.id);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                >
                  <div className="d-flex align-items-center gap-2">
                    {n.pinned && <FontAwesomeIcon icon={faThumbtack} className="text-primary small" title="Pinned" />}
                    <span className="fw-semibold text-truncate">{n.title || 'Untitled'}</span>
                    <span className="ms-auto small text-muted flex-shrink-0">{timeAgo(n.trashedAt || n.updatedAt)}</span>
                  </div>
                  {n.preview && <div className="small text-muted note-item-preview">{n.preview}</div>}
                  {(folderNames.length > 0 || n.tags.length > 0) && (
                    <div className="d-flex flex-wrap align-items-center gap-1 mt-1">
                      {folderNames.length > 0 && (
                        <span className="small text-muted text-truncate me-1">
                          <FontAwesomeIcon icon={faFolder} className="me-1" />{folderNames.join(' / ')}
                        </span>
                      )}
                      {n.tags.slice(0, 4).map((t) => <span key={t} className="note-tag note-tag-sm">{t}</span>)}
                    </div>
                  )}
                </Link>
              );
            })
          )}
        </div>
      </aside>

      <section className={`notes-main ${noteId ? 'd-flex' : 'd-none d-md-flex'}`}>
        {noteId ? (
          <NoteEditor
            key={noteId}
            noteId={noteId}
            tree={tree}
            moved={moved?.id === noteId ? moved : null}
            tagSuggestions={tags.map((t) => t.name)}
            onChanged={onChanged}
            onRemoved={onRemoved}
            onBack={closeEditor}
          />
        ) : (
          <div className="m-auto text-center text-muted p-4">
            <FontAwesomeIcon icon={faNoteSticky} size="2x" className="mb-3 opacity-50" />
            <p className="mb-3">Pick a note, or start a new one.</p>
            <button type="button" className="btn btn-primary" onClick={createNote}>
              <FontAwesomeIcon icon={faPlus} className="me-2" />New note
            </button>
          </div>
        )}
      </section>

      {modal?.type === 'import' && (
        <ImportNotesModal
          targetPath={folderSelected ? tree.pathNames(selected) : []}
          onImported={() => {
            loadList();
            loadTags();
            loadFolders();
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'moveFolder' && tree.byId.has(modal.id) && (
        <MoveToFolderModal
          tree={tree}
          title={`Move "${tree.byId.get(modal.id).name}" to…`}
          currentId={tree.byId.get(modal.id).parentId}
          movingFolderId={modal.id}
          onMove={(parentId) => moveFolder(modal.id, parentId)}
          onClose={() => setModal(null)}
        />
      )}
      {deletingFolder && (
        <ConfirmModal
          title={`Delete "${deletingFolder.name}"?`}
          message={(() => {
            const subfolders = tree.subtree(deletingFolder.id).length - 1;
            const count = tree.itemTotal(deletingFolder.id);
            const parts = [];
            if (subfolders) parts.push(`its ${plural(subfolders, 'subfolder')} will be deleted too`);
            if (count) parts.push(`${plural(count, 'note')} will move to the trash, where you can restore them for 30 days`);
            return parts.length ? `The folder is deleted, ${parts.join(', and ')}.` : 'The folder is empty.';
          })()}
          confirmLabel="Delete folder"
          onConfirm={() => deleteFolder(deletingFolder.id)}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'emptyTrash' && (
        <ConfirmModal
          title="Empty the trash?"
          message="Every note in the trash is deleted forever."
          confirmLabel="Empty trash"
          onConfirm={emptyTrash}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
