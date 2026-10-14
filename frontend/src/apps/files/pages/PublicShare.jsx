import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faDownload, faChevronRight, faLinkSlash } from '@fortawesome/free-solid-svg-icons';
import Logo, { APP_NAME } from '../../../core/components/Logo';
import Spinner from '../../../core/components/Spinner';
import { errorMessage } from '../../../core/api/client';
import { publicFilesApi } from '../api';
import { formatBytes, iconFor, iconColor, previewKind } from '../utils/format';
import Preview from '../components/Preview';
import '../files.scss';

// What someone sees when they open a public link (/app/s/<token>), signed in
// or not: a shared file to preview and download, or a shared folder to browse.
// Nothing outside the shared item is reachable (the server checks every request).
export default function PublicShare() {
  // The signed link token from the URL. It names the shared item; folderId is a
  // folder inside it being browsed (null: the shared item itself).
  const { token } = useParams();
  const [folderId, setFolderId] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);

  // Loads the shared item, or the folder inside it being browsed. `live` drops
  // answers that arrive after the person has already moved on.
  useEffect(() => {
    let live = true;
    setData(null);
    publicFilesApi.open(token, folderId)
      .then((d) => live && setData(d))
      .catch((err) => live && setError(errorMessage(err, 'This link doesn\'t work')));
    return () => { live = false; };
  }, [token, folderId]);

  // Files are fetched straight from the public download route, through the token,
  // so no sign-in is needed. `inline` views it in the browser instead of saving it.
  const urlFor = useCallback((item, inline) => publicFilesApi.fileUrl(token, item.id, inline), [token]);
  const download = (item) => {
    const a = document.createElement('a');
    a.href = urlFor(item, false);
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  // What the page shows: an error, loading, a single shared file, or a shared folder.
  let body;
  if (error) {
    body = (
      <div className="text-center py-5">
        <FontAwesomeIcon icon={faLinkSlash} size="3x" className="text-muted mb-3" />
        <h1 className="h5 fw-bold">This link isn&apos;t available</h1>
        <p className="text-muted mb-0">{error}</p>
      </div>
    );
  } else if (!data) {
    body = <div className="text-center py-5"><Spinner /></div>;
  } else if (data.item.kind === 'file') {
    const { item } = data;
    body = (
      <div className="text-center py-5">
        <FontAwesomeIcon icon={iconFor(item)} size="4x" style={{ color: iconColor(item) }} className="mb-3" />
        <h1 className="h5 fw-bold text-break">{item.name}</h1>
        <p className="text-muted">{formatBytes(item.size)}{data.ownerName ? ` · shared by ${data.ownerName}` : ''}</p>
        <div className="d-flex gap-2 justify-content-center">
          {previewKind(item) && <button type="button" className="btn btn-outline-primary" onClick={() => setPreview(item)}>Preview</button>}
          <button type="button" className="btn btn-primary" onClick={() => download(item)}>
            <FontAwesomeIcon icon={faDownload} className="me-2" />Download
          </button>
        </div>
      </div>
    );
  } else {
    body = (
      <>
        <p className="text-muted small mb-2">{data.ownerName ? `Shared by ${data.ownerName}` : 'Shared folder'} · anyone with the link can view</p>
        <nav className="files-crumbs mb-3" aria-label="Folder path">
          {data.breadcrumbs.map((b, i) => (
            <span key={b.id} className="d-inline-flex align-items-center">
              {i > 0 && <FontAwesomeIcon icon={faChevronRight} className="mx-1 text-muted small" />}
              {/* The first crumb is the shared folder itself, opened as folderId null. */}
              {i === data.breadcrumbs.length - 1 ? (
                <span className="files-crumb current">{b.name}</span>
              ) : (
                <button type="button" className="btn btn-link files-crumb p-1" onClick={() => setFolderId(i === 0 ? null : b.id)}>{b.name}</button>
              )}
            </span>
          ))}
        </nav>
        <div className="files-list">
          {data.items.map((item) => (
            <div key={item.id} className="files-row" role="button" tabIndex={0}
              onClick={() => (item.kind === 'folder' ? setFolderId(item.id) : setPreview(item))}
              onKeyDown={(e) => e.key === 'Enter' && (item.kind === 'folder' ? setFolderId(item.id) : setPreview(item))}>
              <span className="d-flex align-items-center gap-2 min-w-0">
                <FontAwesomeIcon icon={iconFor(item)} style={{ color: iconColor(item) }} fixedWidth />
                <span className="text-truncate">{item.name}</span>
              </span>
              <span className="d-none d-sm-block text-muted small" />
              <span className="d-none d-sm-block text-muted small text-end">{item.kind === 'file' ? formatBytes(item.size) : '—'}</span>
              {item.kind === 'file' ? (
                <button type="button" className="icon-btn" aria-label={`Download ${item.name}`} onClick={(e) => { e.stopPropagation(); download(item); }}>
                  <FontAwesomeIcon icon={faDownload} />
                </button>
              ) : <span />}
            </div>
          ))}
          {!data.items.length && <p className="text-muted text-center py-4 mb-0">This folder is empty.</p>}
        </div>
      </>
    );
  }

  // The files the preview can step through with the arrow keys.
  const files = data?.items?.filter((i) => i.kind === 'file') ?? (data?.item ? [data.item] : []);
  return (
    <div className="min-vh-100 bg-white">
      <header className="d-flex align-items-center gap-2 px-3 py-2 border-bottom">
        <Logo />
        <span className="fw-bold text-primary">{APP_NAME}</span>
      </header>
      <main className="container py-4" style={{ maxWidth: 960 }}>{body}</main>
      {preview && (
        <Preview item={preview} siblings={files} urlFor={urlFor} onNavigate={setPreview} onDownload={download} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}
