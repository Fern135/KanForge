import { useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFolder, faChevronRight, faHardDrive } from '@fortawesome/free-solid-svg-icons';
import Modal from '../../../core/components/Modal';
import Spinner from '../../../core/components/Spinner';
import { errorMessage } from '../../../core/api/client';
import { filesApi } from '../api';

// Picks a folder to move items into, by browsing folders like the main view.
// startId: the folder to open first (null: the top of My Drive).
// movingIds: the items being moved, which can't be picked (a folder can't go inside itself).
// allowRoot: whether the top of My Drive is a valid place (only for the owner's own items).
export default function MoveModal({ title, startId, movingIds, allowRoot, onMove, onClose }) {
  // The folder being looked at (and where the items go on "Move here").
  const [at, setAt] = useState(startId ?? null);
  const [view, setView] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Loads the folder being looked at, ignoring answers for one already left.
  useEffect(() => {
    let live = true;
    setView(null);
    filesApi.browse(at ?? undefined)
      .then((d) => live && setView(d))
      .catch((err) => live && setError(errorMessage(err)));
    return () => { live = false; };
  }, [at]);

  const moving = new Set(movingIds);
  // Only folders are listed: files can't be moved into.
  const folders = view?.items.filter((i) => i.kind === 'folder') ?? [];
  // Moving into a folder needs edit access to it; the top level is the owner's own.
  const canDropHere = at === null ? allowRoot : view && view.role !== 'view' && !moving.has(at);

  // Moves, then closes. A refusal (say, a folder going inside itself) shows here.
  const go = async () => {
    setBusy(true);
    try {
      await onMove(at);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn-light" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={go} disabled={busy || !canDropHere}>Move here</button>
        </>
      )}
    >
      {error && <div className="alert alert-danger py-2 small">{error}</div>}
      <nav className="files-crumbs small mb-2" aria-label="Folder">
        {allowRoot && (
          <button type="button" className="btn btn-link btn-sm p-0" onClick={() => setAt(null)}>
            <FontAwesomeIcon icon={faHardDrive} className="me-1" />My Drive
          </button>
        )}
        {view?.breadcrumbs.map((b) => (
          <span key={b.id}>
            <FontAwesomeIcon icon={faChevronRight} className="mx-1 text-muted small" />
            <button type="button" className="btn btn-link btn-sm p-0" onClick={() => setAt(b.id)}>{b.name}</button>
          </span>
        ))}
        {view?.folder && (
          <span>
            <FontAwesomeIcon icon={faChevronRight} className="mx-1 text-muted small" />
            <span className="fw-semibold">{view.folder.name}</span>
          </span>
        )}
      </nav>
      {!view ? (
        <div className="text-center p-3"><Spinner small /></div>
      ) : (
        <ul className="list-group files-move-list">
          {folders.map((f) => (
            <li key={f.id} className="list-group-item p-0">
              <button type="button" className="files-move-row" disabled={moving.has(f.id)} onClick={() => setAt(f.id)}>
                <FontAwesomeIcon icon={faFolder} className="files-folder-icon me-2" />
                <span className="text-truncate">{f.name}</span>
                <FontAwesomeIcon icon={faChevronRight} className="ms-auto text-muted small" />
              </button>
            </li>
          ))}
          {!folders.length && <li className="list-group-item text-muted small">No folders here.</li>}
        </ul>
      )}
    </Modal>
  );
}
