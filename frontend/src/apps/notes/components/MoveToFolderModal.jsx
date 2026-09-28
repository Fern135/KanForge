import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFolder, faInbox } from '@fortawesome/free-solid-svg-icons';
import Modal from '../../../core/components/Modal';
import { MAX_FOLDER_DEPTH } from '../utils/folders';

// Picks where a note or folder goes. For a folder, its own subtree and any spot
// that would nest it too deeply are unavailable.
export default function MoveToFolderModal({ tree, title, currentId, movingFolderId, onMove, onClose }) {
  const [busy, setBusy] = useState(false);
  const blocked = new Set(movingFolderId ? tree.subtree(movingFolderId) : []);
  const tooDeep = (targetId) => movingFolderId && tree.depth(targetId) + tree.height(movingFolderId) > MAX_FOLDER_DEPTH;

  const choose = async (targetId) => {
    setBusy(true);
    try {
      await onMove(targetId);
      onClose();
    } catch {
      setBusy(false);
    }
  };

  const rows = [];
  const walk = (parentId, depth) => {
    for (const f of tree.kids(parentId)) {
      rows.push({ folder: f, depth });
      if (!blocked.has(f.id)) walk(f.id, depth + 1);
    }
  };
  walk(null, 0);

  const option = (key, targetId, label, icon, depth, disabled) => (
    <button
      key={key}
      type="button"
      className={`list-group-item list-group-item-action d-flex align-items-center ${targetId === currentId ? 'active' : ''}`}
      style={{ paddingLeft: `${1 + depth * 1.1}rem` }}
      disabled={busy || disabled || targetId === currentId}
      onClick={() => choose(targetId)}
    >
      <FontAwesomeIcon icon={icon} className="me-2" fixedWidth />
      <span className="text-truncate">{label}</span>
      {targetId === currentId && <span className="ms-auto small">Current</span>}
    </button>
  );

  return (
    <Modal title={title} onClose={onClose}>
      <div className="list-group list-group-flush" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
        {option('root', null, movingFolderId ? 'Top level' : 'No folder (Unfiled)', faInbox, 0, false)}
        {rows.map(({ folder, depth }) =>
          option(folder.id, folder.id, folder.name, faFolder, depth, blocked.has(folder.id) || tooDeep(folder.id)))}
      </div>
      {rows.length === 0 && <p className="text-muted small mt-3 mb-0">No folders yet. Create one from the sidebar.</p>}
    </Modal>
  );
}
