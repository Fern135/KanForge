import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { NavLink, useNavigate, useParams } from 'react-router';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faPlus, faFolderPlus, faFileArrowUp, faFolderOpen, faHardDrive, faUserGroup, faClock, faTrashCan,
  faMagnifyingGlass, faChevronRight, faList, faTableCells, faDownload, faShareNodes, faPen, faArrowRightToBracket,
  faRotateLeft, faXmark, faCloudArrowUp, faCircleExclamation, faEye,
} from '@fortawesome/free-solid-svg-icons';
import { filesApi } from '../api';
import {
  enqueue, enqueueTree, entriesFromPicker, readDrop, onUploaded,
} from '../utils/uploader';
import { formatBytes } from '../utils/format';
import { ensureThumbnails, onThumbnail } from '../utils/thumbnails';
import ItemList, { DRAG_TYPE, isFromComputer } from '../components/ItemList';
import UploadPanel from '../components/UploadPanel';
import NameModal from '../components/NameModal';
import MoveModal from '../components/MoveModal';
import ShareModal from '../components/ShareModal';
import Preview from '../components/Preview';
import ConfirmModal from '../../../core/components/ConfirmModal';
import Spinner from '../../../core/components/Spinner';
import ViewOnlyNotice from '../../../core/components/ViewOnlyNotice';
import useDropdown from '../../../core/hooks/useDropdown';
import { errorMessage } from '../../../core/api/client';
import { useAuth } from '../../../core/context/AuthContext';
import { useToast } from '../../../core/context/ToastContext';
import { useWorkspace } from '../../../core/context/WorkspaceContext';

// The views in the sidebar, like Google Drive's.
const NAV = [
  { id: 'drive', to: '/files', label: 'My Drive', icon: faHardDrive, end: true },
  { id: 'shared', to: '/files/shared', label: 'Shared with me', icon: faUserGroup },
  { id: 'recent', to: '/files/recent', label: 'Recent', icon: faClock },
  { id: 'trash', to: '/files/trash', label: 'Trash', icon: faTrashCan },
];

const LAYOUT_KEY = 'kanforge.files.layout';
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Grid or list, remembered in this browser only.
function useLayout() {
  const [layout, setLayout] = useState(() => {
    try {
      return localStorage.getItem(LAYOUT_KEY) === 'grid' ? 'grid' : 'list';
    } catch {
      return 'list';
    }
  });
  const save = (next) => {
    setLayout(next);
    try {
      localStorage.setItem(LAYOUT_KEY, next);
    } catch { /* storage may be unavailable (private windows) */ }
  };
  return [layout, save];
}

function useDebounced(value, ms) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

// Folders always first; then the chosen column, either way round.
function sortItems(items, { by, dir }) {
  const sign = dir === 'asc' ? 1 : -1;
  const value = (i) => (by === 'name' ? i.name.toLowerCase() : by === 'size' ? (i.size ?? -1) : i[by] || '');
  return [...items].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
    const x = value(a);
    const y = value(b);
    return (x < y ? -1 : x > y ? 1 : 0) * sign || a.name.localeCompare(b.name);
  });
}

// Hands the browser a URL to download, as if a link to it was clicked.
function saveUrl(url) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// view: 'drive' (a folder, or the top of My Drive), 'shared', 'recent' or 'trash'.
export default function Files({ view }) {
  const { folderId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  // View-only access (set by a platform admin): browse and download, nothing else.
  const readOnly = !useWorkspace().canEdit('files');
  const newMenu = useDropdown();
  const [layout, setLayout] = useLayout();
  const [data, setData] = useState(null);
  const [storage, setStorage] = useState(null);
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim(), 300);
  const [sort, setSort] = useState({ by: 'name', dir: 'asc' });
  const [selected, setSelected] = useState(() => new Set());
  // The item the last plain click selected, where a Shift-click range starts.
  const anchor = useRef(null);
  const [menu, setMenu] = useState(null);
  const [modal, setModal] = useState(null);
  const [preview, setPreview] = useState(null);
  // Files from the computer are being dragged over the page.
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const fileInput = useRef(null);
  const folderInput = useRef(null);

  const searching = Boolean(q);
  const current = view === 'drive' ? (folderId ?? null) : null;

  // ---------- Loading ----------

  const load = useCallback(async () => {
    try {
      let next;
      if (searching) next = { ...(await filesApi.search(q)), role: null };
      else if (view === 'drive') next = await filesApi.browse(folderId);
      else if (view === 'shared') next = { ...(await filesApi.shared()), role: null };
      else if (view === 'recent') next = { ...(await filesApi.recent()), role: 'owner' };
      else next = { ...(await filesApi.trash()), role: 'owner' };
      setData(next);
    } catch (err) {
      // A folder that's gone (deleted, or no longer shared) sends you home.
      if (err.response?.status === 404 && folderId) {
        toast.error('That folder isn\'t available anymore');
        navigate('/files', { replace: true });
        return;
      }
      toast.error(errorMessage(err));
      setData({ items: [], role: null });
    }
  }, [searching, q, view, folderId, toast, navigate]);

  const loadStorage = useCallback(() => {
    filesApi.storage().then((d) => setStorage(d.storage)).catch(() => {});
  }, []);

  useEffect(() => {
    setData(null);
    setSelected(new Set());
    load();
  }, [load]);
  useEffect(loadStorage, [loadStorage]);
  // Leaving a view clears the search.
  useEffect(() => setQuery(''), [view, folderId]);

  // A finished upload refreshes the list if it landed here, and the storage meter.
  useEffect(() => onUploaded((parentId) => {
    loadStorage();
    if (view === 'drive' && !searching && (parentId ?? null) === current) load();
  }), [view, searching, current, load, loadStorage]);

  // A preview finished (just uploaded, or made for the grid view): swap it in.
  useEffect(() => onThumbnail((updated) => setData((d) => (d?.items?.some((i) => i.id === updated.id)
    ? { ...d, items: d.items.map((i) => (i.id === updated.id ? { ...i, thumb: updated.thumb, thumbUrl: updated.thumbUrl } : i)) }
    : d))), []);

  const items = useMemo(() => sortItems(data?.items ?? [], sort), [data, sort]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const selection = [...selected].map((id) => byId.get(id)).filter(Boolean);

  // What the caller can do with an item: their own, or what it was shared with them as.
  const roleOf = useCallback((item) => {
    if (item.ownerId === user.id) return 'owner';
    return item.role ?? (view === 'drive' && !searching ? data?.role : null) ?? 'view';
  }, [user.id, view, searching, data]);
  const canEdit = (item) => !readOnly && view !== 'trash' && ['owner', 'edit'].includes(roleOf(item));

  // In the grid view, files from before previews existed get one now, made in
  // the background by whoever can edit them (see utils/thumbnails.js).
  useEffect(() => {
    if (layout === 'grid' && data?.items?.length) ensureThumbnails(data.items, canEdit);
    // canEdit changes with every render; data and layout are what matter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, data]);

  // New files and folders go into the folder on screen, if the caller may add to it.
  const canAddHere = !readOnly && view === 'drive' && !searching && ['owner', 'edit'].includes(data?.role);

  // ---------- Selection ----------

  const select = (item, e) => {
    if (e?.shiftKey && anchor.current && byId.has(anchor.current)) {
      const a = items.findIndex((i) => i.id === anchor.current);
      const b = items.findIndex((i) => i.id === item.id);
      setSelected(new Set(items.slice(Math.min(a, b), Math.max(a, b) + 1).map((i) => i.id)));
      return;
    }
    if (e?.metaKey || e?.ctrlKey || e?.key === ' ') {
      const next = new Set(selected);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      setSelected(next);
    } else {
      setSelected(new Set([item.id]));
    }
    anchor.current = item.id;
  };

  // ---------- Actions ----------

  const open = (item) => {
    if (view === 'trash') return;
    if (item.kind === 'folder') navigate(`/files/folders/${item.id}`);
    else setPreview(item);
  };

  const urlFor = useCallback((item, inline) => filesApi.downloadUrl(item.id, inline), []);

  const download = async (list) => {
    for (const item of list.filter((i) => i.kind === 'file')) {
      try {
        saveUrl(await filesApi.downloadUrl(item.id));
      } catch (err) {
        toast.error(errorMessage(err));
      }
    }
  };

  // Runs an action on each item, then reloads once and reports how it went.
  const each = async (list, action, done) => {
    let ok = 0;
    for (const item of list) {
      try {
        await action(item);
        ok += 1;
      } catch (err) {
        toast.error(`${item.name}: ${errorMessage(err)}`);
      }
    }
    if (ok) toast.success(done(ok));
    setSelected(new Set());
    load();
    loadStorage();
  };

  const trash = (list) => each(list, (i) => filesApi.trashItem(i.id), (n) => `${plural(n, 'item')} moved to the trash`);
  const restore = (list) => each(list, (i) => filesApi.restore(i.id), (n) => `${plural(n, 'item')} restored`);
  const deleteForever = (list) => each(list, (i) => filesApi.deleteForever(i.id), (n) => `${plural(n, 'item')} deleted forever`);
  const moveTo = (ids, parentId) => each(ids.map((id) => byId.get(id)).filter(Boolean), (i) => filesApi.move(i.id, parentId), (n) => `Moved ${plural(n, 'item')}`);

  const emptyTrash = async () => {
    try {
      const { deleted } = await filesApi.emptyTrash();
      toast.success(`Deleted ${plural(deleted, 'item')} forever`);
      load();
      loadStorage();
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  };

  // ---------- Uploading ----------

  // Files (and folders) from the picker or a drop go into `parentId`.
  const upload = async (entries, parentId) => {
    if (!entries.length) return;
    try {
      if (entries.some((e) => e.path?.length || e.dir)) await enqueueTree(entries, parentId);
      else enqueue(entries.map((e) => ({ file: e.file, parentId })));
      // New folders show up straight away; files as they finish.
      if (parentId === current) load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const pickFiles = (e) => {
    upload([...e.target.files].map((file) => ({ file, path: [] })), current);
    e.target.value = '';
  };
  const pickFolder = (e) => {
    upload(entriesFromPicker(e.target.files), current);
    e.target.value = '';
  };

  // React doesn't know the folder picker attribute, so it's set directly.
  useEffect(() => {
    folderInput.current?.setAttribute('webkitdirectory', '');
    folderInput.current?.setAttribute('directory', '');
  }, []);

  // Drag and drop from the computer onto the page: a highlighted drop zone, and
  // the files (and folders) upload into the folder on screen.
  const dropZone = canAddHere ? {
    onDragEnter: (e) => {
      if (!isFromComputer(e)) return;
      e.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    },
    onDragOver: (e) => {
      if (!isFromComputer(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setDragging(false);
    },
    onDrop: async (e) => {
      if (!isFromComputer(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      upload(await readDrop(e.dataTransfer), current);
    },
  } : {};

  // ---------- Keyboard ----------

  useEffect(() => {
    const onKey = (e) => {
      if (modal || preview || e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && selection.length) {
        e.preventDefault();
        if (view === 'trash') setModal({ type: 'deleteForever', items: selection });
        else if (selection.every(canEdit)) trash(selection);
      } else if (e.key === 'Escape') {
        setSelected(new Set());
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault();
        setSelected(new Set(items.map((i) => i.id)));
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  // ---------- Menus ----------

  // The actions for `list` (the right-clicked item, or the whole selection).
  const actionsFor = (list) => {
    const single = list.length === 1 ? list[0] : null;
    const files = list.filter((i) => i.kind === 'file');
    const editable = list.every(canEdit);
    const own = list.every((i) => roleOf(i) === 'owner');
    if (view === 'trash') {
      return [
        { label: 'Restore', icon: faRotateLeft, run: () => restore(list) },
        { label: 'Delete forever', icon: faTrashCan, danger: true, run: () => setModal({ type: 'deleteForever', items: list }) },
      ];
    }
    return [
      single && { label: single.kind === 'folder' ? 'Open' : 'Preview', icon: single.kind === 'folder' ? faFolderOpen : faEye, run: () => open(single) },
      files.length > 0 && { label: files.length > 1 ? `Download ${files.length} files` : 'Download', icon: faDownload, run: () => download(files) },
      single && own && !readOnly && { label: 'Share', icon: faShareNodes, run: () => setModal({ type: 'share', item: single }) },
      single && editable && { label: 'Rename', icon: faPen, run: () => setModal({ type: 'rename', item: single }) },
      editable && { label: 'Move to…', icon: faArrowRightToBracket, run: () => setModal({ type: 'move', items: list }) },
      // Editors can trash too: it goes to the owner's trash, where only they can restore it.
      editable && { label: 'Move to trash', icon: faTrashCan, danger: true, run: () => trash(list) },
    ].filter(Boolean);
  };

  const openMenu = (item, pos) => {
    // Right-clicking outside the selection selects just that item, like a file manager.
    const list = selected.has(item.id) ? selection : [item];
    if (!selected.has(item.id)) setSelected(new Set([item.id]));
    setMenu({ ...pos, actions: actionsFor(list) });
  };

  useEffect(() => {
    if (!menu) return undefined;
    const close = () => setMenu(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [menu]);

  // ---------- Rendering ----------

  // The heading: search results, or the sidebar view's name. Inside a folder the
  // breadcrumbs take its place.
  const title = searching ? `Results for "${q}"` : NAV.find((n) => n.id === view).label;
  // Whether the folder on screen is in the caller's own drive (not one shared with them).
  const ownDrive = view === 'drive' && (data?.role === 'owner' || !folderId);
  // How full the caller's storage is, 0 to 1 (null when there's no limit).
  const quotaShare = storage?.quotaBytes ? Math.min(1, storage.usedBytes / storage.quotaBytes) : null;

  // My Drive (or Shared with me) > folder > folder. Each folder above can take
  // items dragged onto it, to move them up the tree.
  const breadcrumbs = view === 'drive' && !searching && data && (
    <nav className="files-crumbs" aria-label="Folder path">
      {ownDrive ? (
        <NavLink to="/files" end className="files-crumb">My Drive</NavLink>
      ) : (
        <NavLink to="/files/shared" className="files-crumb">Shared with me</NavLink>
      )}
      {data.breadcrumbs?.map((b) => (
        <span key={b.id} className="d-inline-flex align-items-center">
          <FontAwesomeIcon icon={faChevronRight} className="mx-1 text-muted small" />
          <NavLink to={`/files/folders/${b.id}`} className="files-crumb"
            onDragOver={(e) => canAddHere && e.preventDefault()}
            onDrop={(e) => {
              const ids = JSON.parse(e.dataTransfer.getData(DRAG_TYPE) || '[]');
              if (canAddHere && ids.length) moveTo(ids, b.id);
            }}>
            {b.name}
          </NavLink>
        </span>
      ))}
      {data.folder && (
        <span className="d-inline-flex align-items-center">
          <FontAwesomeIcon icon={faChevronRight} className="mx-1 text-muted small" />
          <span className="files-crumb current">{data.folder.name}</span>
          {data.role === 'view' && <span className="badge text-bg-light ms-2">View only</span>}
        </span>
      )}
    </nav>
  );

  // What an empty view says, depending on where you are.
  const emptyText = searching ? 'Nothing matches that search.'
    : view === 'trash' ? 'The trash is empty.'
      : view === 'shared' ? 'Nothing has been shared with you yet.'
        : view === 'recent' ? 'Files you add or change will show up here.'
          : canAddHere ? 'Drop files here, or use New to upload.' : 'This folder is empty.';

  return (
    <div className="files-page">
      {/* Sidebar: the New button (folder, file upload, folder upload), the views, and storage used. */}
      <aside className="files-sidebar">
        {!readOnly && (
          <div className="dropdown p-3 pb-2" ref={newMenu.ref}>
            <button type="button" className="btn btn-accent files-new-btn" aria-haspopup="menu" aria-expanded={newMenu.open}
              disabled={!canAddHere} title={canAddHere ? undefined : 'Open a folder you can add to'}
              onClick={() => newMenu.setOpen((o) => !o)}>
              <FontAwesomeIcon icon={faPlus} className="me-2" />New
            </button>
            {newMenu.open && (
              <ul className="dropdown-menu show shadow border-0" role="menu">
                <li>
                  <button type="button" className="dropdown-item" onClick={() => { newMenu.setOpen(false); setModal({ type: 'newFolder' }); }}>
                    <FontAwesomeIcon icon={faFolderPlus} className="me-2" fixedWidth />New folder
                  </button>
                </li>
                <li><hr className="dropdown-divider" /></li>
                <li>
                  <button type="button" className="dropdown-item" onClick={() => { newMenu.setOpen(false); fileInput.current.click(); }}>
                    <FontAwesomeIcon icon={faFileArrowUp} className="me-2" fixedWidth />File upload
                  </button>
                </li>
                <li>
                  <button type="button" className="dropdown-item" onClick={() => { newMenu.setOpen(false); folderInput.current.click(); }}>
                    <FontAwesomeIcon icon={faFolderOpen} className="me-2" fixedWidth />Folder upload
                  </button>
                </li>
              </ul>
            )}
            <input ref={fileInput} type="file" multiple hidden onChange={pickFiles} />
            <input ref={folderInput} type="file" multiple hidden onChange={pickFolder} />
          </div>
        )}
        <nav className="files-nav" aria-label="Files">
          {NAV.map((n) => (
            <NavLink key={n.id} to={n.to} end={n.end} className={({ isActive }) => `files-nav-link ${isActive || (n.id === 'drive' && view === 'drive' && ownDrive) ? 'active' : ''}`}>
              <FontAwesomeIcon icon={n.icon} fixedWidth className="me-2" />{n.label}
            </NavLink>
          ))}
        </nav>
        {storage && (
          <div className="files-storage">
            {quotaShare !== null && (
              <div className="progress mb-1" style={{ height: 6 }} role="progressbar" aria-label="Storage used"
                aria-valuenow={Math.round(quotaShare * 100)} aria-valuemin={0} aria-valuemax={100}>
                <div className={`progress-bar ${quotaShare > 0.9 ? 'bg-danger' : ''}`} style={{ width: `${quotaShare * 100}%` }} />
              </div>
            )}
            <div className="small text-muted">
              {formatBytes(storage.usedBytes)} {storage.quotaBytes ? `of ${formatBytes(storage.quotaBytes)} used` : 'used'}
              {storage.perWorkspace ? ' in this workspace' : ''}
            </div>
            {storage.trashBytes > 0 && <div className="small text-muted">{formatBytes(storage.trashBytes)} in the trash</div>}
          </div>
        )}
      </aside>

      {/* Main area: search and layout, notices, heading, the selection bar and the items.
          The whole area is a drop zone for files from the computer. */}
      <section className={`files-main ${dragging ? 'dragging' : ''}`} {...dropZone}>
        <div className="files-toolbar">
          <div className="input-group input-group-sm files-search">
            <span className="input-group-text"><FontAwesomeIcon icon={faMagnifyingGlass} /></span>
            <input type="search" className="form-control" placeholder="Search in Files" value={query} maxLength={100}
              onChange={(e) => setQuery(e.target.value)} aria-label="Search in Files" />
          </div>
          <div className="btn-group btn-group-sm ms-auto" role="group" aria-label="Layout">
            <button type="button" className={`btn ${layout === 'list' ? 'btn-primary' : 'btn-outline-primary'}`} aria-pressed={layout === 'list'}
              onClick={() => setLayout('list')} title="List"><FontAwesomeIcon icon={faList} /></button>
            <button type="button" className={`btn ${layout === 'grid' ? 'btn-primary' : 'btn-outline-primary'}`} aria-pressed={layout === 'grid'}
              onClick={() => setLayout('grid')} title="Grid"><FontAwesomeIcon icon={faTableCells} /></button>
          </div>
        </div>

        {storage && !storage.configured && (
          <div className="alert alert-warning m-3 mb-0 small d-flex gap-2">
            <FontAwesomeIcon icon={faCircleExclamation} className="mt-1" />
            <span>File storage isn&apos;t set up on this server yet, so files can&apos;t be uploaded. A platform admin needs to configure object storage (the S3_* settings).</span>
          </div>
        )}
        {readOnly && <ViewOnlyNotice className="m-3 mb-0" />}

        <div className="files-heading">
          {breadcrumbs || <h1 className="h5 fw-bold mb-0">{title}</h1>}
          {view === 'trash' && !searching && items.length > 0 && !readOnly && (
            <button type="button" className="btn btn-sm btn-outline-danger ms-auto" onClick={() => setModal({ type: 'emptyTrash' })}>Empty trash</button>
          )}
        </div>
        {view === 'trash' && !searching && <p className="small text-muted px-3 mb-2">Items in the trash are deleted forever after 30 days.</p>}

        {selection.length > 0 && (
          <div className="files-selection" role="toolbar" aria-label="Selected items">
            <button type="button" className="icon-btn" onClick={() => setSelected(new Set())} aria-label="Clear selection"><FontAwesomeIcon icon={faXmark} /></button>
            <span className="fw-semibold me-2">{selection.length} selected</span>
            {actionsFor(selection).filter((a) => a.label !== 'Open' && a.label !== 'Preview').map((a) => (
              <button key={a.label} type="button" className={`btn btn-sm ${a.danger ? 'btn-outline-danger' : 'btn-outline-primary'}`} onClick={a.run}>
                <FontAwesomeIcon icon={a.icon} className="me-1" />{a.label}
              </button>
            ))}
          </div>
        )}

        <div className="files-content" onClick={(e) => e.target === e.currentTarget && setSelected(new Set())}>
          {!data ? (
            <div className="p-5 text-center"><Spinner /></div>
          ) : items.length === 0 ? (
            <div className="files-empty">
              <FontAwesomeIcon icon={canAddHere ? faCloudArrowUp : view === 'trash' ? faTrashCan : faFolderOpen} size="3x" className="mb-3 opacity-50" />
              <p className="mb-0">{emptyText}</p>
            </div>
          ) : (
            <ItemList
              items={items}
              layout={layout}
              sort={sort}
              onSort={(by) => setSort((s) => ({ by, dir: s.by === by && s.dir === 'asc' ? 'desc' : by === 'name' ? 'asc' : 'desc' }))}
              selected={selected}
              showOwner={view === 'shared' || searching || (view === 'drive' && data.role !== 'owner')}
              showTrashed={view === 'trash'}
              onSelect={select}
              onOpen={open}
              onMenu={openMenu}
              canDrag={canEdit}
              onDropItems={canAddHere ? (folder, ids) => moveTo(ids, folder.id) : null}
              onDropFiles={canAddHere ? async (folder, e) => upload(await readDrop(e.dataTransfer), folder.id) : null}
            />
          )}
          {data?.truncated && <p className="small text-muted text-center p-3">Only the first 2,000 items are shown. Use search to find others.</p>}
        </div>

        {dragging && (
          <div className="files-drop-hint" aria-hidden="true">
            <FontAwesomeIcon icon={faCloudArrowUp} size="2x" className="mb-2" />
            <div className="fw-semibold">Drop to upload to {data?.folder?.name ?? 'My Drive'}</div>
          </div>
        )}
      </section>

      {/* The right-click (or ⋮) menu, kept inside the window. */}
      {menu && (
        <ul className="dropdown-menu show shadow border-0 files-context-menu" role="menu"
          style={{ left: Math.min(menu.x, window.innerWidth - 220), top: Math.min(menu.y, window.innerHeight - 40 * menu.actions.length - 16) }}
          onMouseDown={(e) => e.stopPropagation()}>
          {menu.actions.map((a) => (
            <li key={a.label}>
              <button type="button" className={`dropdown-item ${a.danger ? 'text-danger' : ''}`} onClick={() => { setMenu(null); a.run(); }}>
                <FontAwesomeIcon icon={a.icon} className="me-2" fixedWidth />{a.label}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Dialogs, one at a time, chosen by modal.type. */}
      {modal?.type === 'newFolder' && (
        <NameModal title="New folder" initial="Untitled folder" confirmLabel="Create" onClose={() => setModal(null)}
          onSubmit={async (name) => {
            try {
              await filesApi.createFolder(name, current);
              load();
            } catch (err) {
              toast.error(errorMessage(err));
              throw err;
            }
          }} />
      )}
      {modal?.type === 'rename' && (
        <NameModal title="Rename" initial={modal.item.name} confirmLabel="Rename" onClose={() => setModal(null)}
          onSubmit={async (name) => {
            if (name === modal.item.name) return;
            try {
              await filesApi.rename(modal.item.id, name);
              load();
            } catch (err) {
              toast.error(errorMessage(err));
              throw err;
            }
          }} />
      )}
      {modal?.type === 'move' && (
        <MoveModal
          title={modal.items.length === 1 ? `Move "${modal.items[0].name}"` : `Move ${plural(modal.items.length, 'item')}`}
          startId={view === 'drive' ? current : modal.items[0].parentId}
          movingIds={modal.items.map((i) => i.id)}
          allowRoot={modal.items.every((i) => roleOf(i) === 'owner')}
          onMove={(parentId) => moveTo(modal.items.map((i) => i.id), parentId)}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'share' && <ShareModal item={modal.item} onChanged={load} onClose={() => setModal(null)} />}
      {modal?.type === 'deleteForever' && (
        <ConfirmModal
          title={modal.items.length === 1 ? `Delete "${modal.items[0].name}" forever?` : `Delete ${plural(modal.items.length, 'item')} forever?`}
          message="This can't be undone. Anything inside a folder is deleted with it."
          confirmLabel="Delete forever"
          onConfirm={() => deleteForever(modal.items)}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'emptyTrash' && (
        <ConfirmModal title="Empty the trash?" message="Everything in the trash is deleted forever. This can't be undone."
          confirmLabel="Empty trash" onConfirm={emptyTrash} onClose={() => setModal(null)} />
      )}
      {preview && (
        <Preview
          item={preview}
          siblings={items.filter((i) => i.kind === 'file')}
          urlFor={urlFor}
          onNavigate={setPreview}
          onDownload={(i) => download([i])}
          onClose={() => setPreview(null)}
        />
      )}
      <UploadPanel />
    </div>
  );
}
