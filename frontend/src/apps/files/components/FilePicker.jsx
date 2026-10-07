import { useEffect, useMemo, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faHardDrive, faUserGroup, faClock, faChevronRight, faMagnifyingGlass, faFolder, faCheck,
} from '@fortawesome/free-solid-svg-icons';
import Modal from '../../../core/components/Modal';
import Spinner from '../../../core/components/Spinner';
import { errorMessage } from '../../../core/api/client';
import { filesApi } from '../api';
import { formatBytes, iconFor, iconColor } from '../utils/format';
import '../files.scss';

// "Choose from Files": picks files from the Files app for another app to use,
// like Google Drive's picker in Docs. Office uses it to insert pictures and to
// open Word, Excel and PowerPoint files.
//
// It browses My Drive, Shared with me and Recent, with search, and shows only
// the files `accept` allows (folders always show, to open). The chosen files
// are downloaded and handed to onPick as ordinary File objects, exactly as if
// they'd been picked from the computer, so the caller handles them the same way.
//
//   accept(item)       which files can be chosen
//   multiple           whether several can be chosen at once
//   confirmLabel       the button's label ("Insert", "Open")
//   onPick(files)      gets File[]; the picker closes once it resolves
//   onClose()
//
// utils/pick.js has the helpers callers need first (is Files available, filters for accept).

const VIEWS = [
  { id: 'drive', label: 'My Drive', icon: faHardDrive },
  { id: 'shared', label: 'Shared with me', icon: faUserGroup },
  { id: 'recent', label: 'Recent', icon: faClock },
];

// Downloads a file from Files into a File object, named and typed like the original.
async function toFile(item) {
  const res = await fetch(await filesApi.downloadUrl(item.id));
  if (!res.ok) throw new Error(`Could not download "${item.name}"`);
  return new File([await res.blob()], item.name, { type: item.mime || 'application/octet-stream' });
}

export default function FilePicker({
  title = 'Choose from Files', accept = () => true, multiple = false, confirmLabel = 'Choose', onPick, onClose,
}) {
  const [view, setView] = useState('drive');
  // The folder being browsed (null: the top of the view).
  const [folderId, setFolderId] = useState(null);
  const [query, setQuery] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  // The chosen files, by id (the items themselves, to download them).
  const [chosen, setChosen] = useState(() => new Map());
  const [busy, setBusy] = useState(false);

  // Loads what's on screen: search results, a folder, or the view's top level.
  // Typing waits a moment so every keystroke isn't a search.
  useEffect(() => {
    let live = true;
    const q = query.trim();
    const t = setTimeout(() => {
      setData(null);
      setError('');
      const load = q ? filesApi.search(q)
        : folderId ? filesApi.browse(folderId)
          : view === 'drive' ? filesApi.browse()
            : view === 'shared' ? filesApi.shared() : filesApi.recent();
      load.then((d) => live && setData(d)).catch((err) => live && setError(errorMessage(err)));
    }, q ? 300 : 0);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [view, folderId, query]);

  // Folders first (to open), then only the files that can be chosen.
  const items = useMemo(() => (data?.items ?? []).filter((i) => i.kind === 'folder' || accept(i)), [data, accept]);

  const openView = (id) => {
    setView(id);
    setFolderId(null);
    setQuery('');
  };

  const toggle = (item) => {
    const next = new Map(multiple ? chosen : []);
    if (chosen.has(item.id)) next.delete(item.id);
    else next.set(item.id, item);
    setChosen(next);
  };

  const finish = async (list = [...chosen.values()]) => {
    if (!list.length) return;
    setBusy(true);
    setError('');
    try {
      await onPick(await Promise.all(list.map(toFile)));
      onClose();
    } catch (err) {
      setError(errorMessage(err, err.message));
      setBusy(false);
    }
  };

  const crumbs = !query.trim() && folderId && data?.folder ? [...(data.breadcrumbs ?? []), { id: data.folder.id, name: data.folder.name }] : [];

  return (
    <Modal
      title={title}
      size="lg"
      onClose={busy ? () => {} : onClose}
      footer={(
        <>
          <span className="small text-muted me-auto">{chosen.size ? `${chosen.size} selected` : ''}</span>
          <button type="button" className="btn btn-light" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => finish()} disabled={busy || !chosen.size}>
            {busy ? 'Getting files…' : confirmLabel}
          </button>
        </>
      )}
    >
      <div className="files-picker">
        <div className="d-flex flex-wrap gap-2 align-items-center mb-2">
          <div className="btn-group btn-group-sm" role="tablist" aria-label="Where to look">
            {VIEWS.map((v) => (
              <button key={v.id} type="button" role="tab" aria-selected={view === v.id && !folderId}
                className={`btn ${view === v.id ? 'btn-primary' : 'btn-outline-primary'}`} onClick={() => openView(v.id)}>
                <FontAwesomeIcon icon={v.icon} className="me-1" />{v.label}
              </button>
            ))}
          </div>
          <div className="input-group input-group-sm ms-auto" style={{ maxWidth: 240 }}>
            <span className="input-group-text"><FontAwesomeIcon icon={faMagnifyingGlass} /></span>
            <input type="search" className="form-control" placeholder="Search in Files" aria-label="Search in Files"
              value={query} maxLength={100} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>

        {/* Where you are inside a folder; the first link goes back to the view's top. */}
        {crumbs.length > 0 && (
          <nav className="files-crumbs small mb-2" aria-label="Folder path">
            <button type="button" className="btn btn-link btn-sm p-0" onClick={() => setFolderId(null)}>{VIEWS.find((v) => v.id === view).label}</button>
            {crumbs.map((b, i) => (
              <span key={b.id}>
                <FontAwesomeIcon icon={faChevronRight} className="mx-1 text-muted small" />
                {i === crumbs.length - 1 ? <span className="fw-semibold">{b.name}</span> : (
                  <button type="button" className="btn btn-link btn-sm p-0" onClick={() => setFolderId(b.id)}>{b.name}</button>
                )}
              </span>
            ))}
          </nav>
        )}

        {error && <div className="alert alert-danger py-2 small">{error}</div>}

        {/* Folders open on click; files are chosen on click, and chosen and confirmed on double-click. */}
        {!data ? (
          <div className="text-center p-4"><Spinner small /></div>
        ) : items.length === 0 ? (
          <p className="text-muted text-center small py-4 mb-0">
            {query.trim() ? 'Nothing here matches that search.' : 'No files here that can be used.'}
          </p>
        ) : (
          <div className="files-picker-grid" role="listbox" aria-multiselectable={multiple} aria-label="Files">
            {items.map((item) => {
              const on = chosen.has(item.id);
              return (
                <button key={item.id} type="button" role="option" aria-selected={on} disabled={busy}
                  className={`files-picker-item ${on ? 'selected' : ''}`}
                  onClick={() => (item.kind === 'folder' ? (setQuery(''), setFolderId(item.id)) : toggle(item))}
                  onDoubleClick={() => item.kind === 'file' && finish([item])}>
                  <span className="files-picker-thumb">
                    {item.thumbUrl ? <img src={item.thumbUrl} alt="" loading="lazy" />
                      : <FontAwesomeIcon icon={item.kind === 'folder' ? faFolder : iconFor(item)} style={{ color: iconColor(item) }} size="2x" />}
                    {on && <span className="files-picker-check"><FontAwesomeIcon icon={faCheck} /></span>}
                  </span>
                  <span className="files-picker-name text-truncate" title={item.name}>{item.name}</span>
                  <span className="small text-muted">{item.kind === 'file' ? formatBytes(item.size) : 'Folder'}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
