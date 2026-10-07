import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faChevronDown, faChevronUp, faXmark, faCircleCheck, faCircleExclamation, faRotateRight, faBan,
} from '@fortawesome/free-solid-svg-icons';
import {
  useUploads, cancel, cancelAll, retry, clearFinished,
} from '../utils/uploader';
import { formatBytes } from '../utils/format';

// The upload queue in the bottom corner, like Google Drive's: overall progress
// in the header, each file's progress below, and a way to cancel or retry.
export default function UploadPanel() {
  // Every upload this tab has started, live from the uploader's queue.
  const items = useUploads();
  const [collapsed, setCollapsed] = useState(false);
  if (!items.length) return null;

  // The header sums up what's still going (with overall progress), or, once
  // everything has settled, how many finished and failed.
  const active = items.filter((i) => i.status === 'queued' || i.status === 'uploading');
  const failed = items.filter((i) => i.status === 'error').length;
  const done = items.filter((i) => i.status === 'done').length;
  const total = active.reduce((s, i) => s + i.size, 0);
  const loaded = active.reduce((s, i) => s + i.loaded, 0);
  const title = active.length
    ? `Uploading ${active.length} ${active.length === 1 ? 'item' : 'items'}${total ? ` · ${Math.floor((loaded / total) * 100)}%` : ''}`
    : `${done} ${done === 1 ? 'upload' : 'uploads'} complete${failed ? `, ${failed} failed` : ''}`;

  return (
    <section className="files-upload-panel shadow" aria-label="Uploads">
      <header className="files-upload-head">
        <span className="fw-semibold text-truncate me-auto" role="status">{title}</span>
        <button type="button" className="icon-btn text-white" onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? 'Show uploads' : 'Hide uploads'} aria-expanded={!collapsed}>
          <FontAwesomeIcon icon={collapsed ? faChevronUp : faChevronDown} />
        </button>
        <button type="button" className="icon-btn text-white" title={active.length ? 'Cancel all uploads' : 'Close'}
          aria-label={active.length ? 'Cancel all uploads' : 'Close'}
          // Closing while uploads run cancels them; afterwards it just clears the list.
          onClick={() => {
            if (active.length) cancelAll();
            clearFinished();
          }}>
          <FontAwesomeIcon icon={faXmark} />
        </button>
      </header>
      {!collapsed && (
        <ul className="files-upload-list list-unstyled mb-0">
          {/* One row per file: its name, a status icon or action, and progress or the error. */}
          {items.map((i) => (
            <li key={i.id} className="files-upload-item">
              <div className="d-flex align-items-center gap-2">
                <span className="text-truncate me-auto small" title={i.name}>{i.name}</span>
                {i.status === 'done' && <FontAwesomeIcon icon={faCircleCheck} className="text-success" title="Uploaded" />}
                {i.status === 'cancelled' && <FontAwesomeIcon icon={faBan} className="text-muted" title="Cancelled" />}
                {i.status === 'error' && (
                  <button type="button" className="icon-btn" onClick={() => retry(i.id)} title="Try again" aria-label={`Try uploading ${i.name} again`}>
                    <FontAwesomeIcon icon={faRotateRight} />
                  </button>
                )}
                {(i.status === 'queued' || i.status === 'uploading') && (
                  <button type="button" className="icon-btn" onClick={() => cancel(i.id)} title="Cancel" aria-label={`Cancel uploading ${i.name}`}>
                    <FontAwesomeIcon icon={faXmark} />
                  </button>
                )}
              </div>
              {i.status === 'uploading' && (
                <div className="progress mt-1" style={{ height: 4 }} role="progressbar" aria-label={`${i.name} progress`}
                  aria-valuenow={i.size ? Math.round((i.loaded / i.size) * 100) : 0} aria-valuemin={0} aria-valuemax={100}>
                  <div className="progress-bar" style={{ width: `${i.size ? (i.loaded / i.size) * 100 : 0}%` }} />
                </div>
              )}
              {i.status === 'queued' && <div className="small text-muted">Waiting · {formatBytes(i.size)}</div>}
              {i.status === 'error' && (
                <div className="small text-danger d-flex align-items-center gap-1">
                  <FontAwesomeIcon icon={faCircleExclamation} />{i.error}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
