import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faXmark, faDownload, faChevronLeft, faChevronRight, faArrowUpRightFromSquare,
} from '@fortawesome/free-solid-svg-icons';
import Spinner from '../../../core/components/Spinner';
import { errorMessage } from '../../../core/api/client';
import { formatBytes, iconFor, iconColor, previewKind } from '../utils/format';

// Text files larger than this aren't shown, only downloaded.
const MAX_TEXT_BYTES = 1024 * 1024;

// A full-screen viewer like Google Drive's: images, video, audio and plain text
// show in the page; arrows (or ← →) step through the other files in the folder.
// PDFs open in a new tab (the browser's own viewer), everything else downloads.
//
// urlFor(item, inline) returns a URL the browser can fetch directly: a signed
// download link when signed in, a public-link URL on a shared page.
export default function Preview({ item, siblings, urlFor, onNavigate, onDownload, onClose }) {
  // The fetched URL for media, or the contents of a text file.
  const [url, setUrl] = useState(null);
  const [text, setText] = useState(null);
  const [error, setError] = useState('');
  // 'image', 'video', 'audio', 'text', 'pdf', or null (no preview, download only).
  const kind = previewKind(item);
  // The files on either side, for the arrows.
  const index = siblings.findIndex((s) => s.id === item.id);
  const prev = index > 0 ? siblings[index - 1] : null;
  const next = index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : null;

  // Each time the file changes: get a link to view it, and for text, fetch the
  // contents. PDFs wait for a click (see openPdf), and files with no preview
  // need nothing. `live` drops answers for a file already stepped away from.
  useEffect(() => {
    let live = true;
    setUrl(null);
    setText(null);
    setError('');
    if (!kind || kind === 'pdf') return undefined;
    Promise.resolve(urlFor(item, true))
      .then(async (u) => {
        if (!live) return;
        if (kind === 'text') {
          if (item.size > MAX_TEXT_BYTES) return;
          const res = await fetch(u);
          if (!res.ok) throw new Error('Could not open the file');
          const body = await res.text();
          if (live) setText(body);
        } else {
          setUrl(u);
        }
      })
      .catch((err) => live && setError(errorMessage(err, err.message)));
    return () => { live = false; };
  }, [item, kind, urlFor]);

  // Keyboard: Escape closes, arrows step through the folder.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && prev) onNavigate(prev);
      else if (e.key === 'ArrowRight' && next) onNavigate(next);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [prev, next, onNavigate, onClose]);

  // The tab opens straight away, while the click still counts (popup blockers
  // stop tabs opened later), and goes to the PDF once its link is ready.
  const openPdf = async () => {
    const tab = window.open('about:blank', '_blank');
    if (!tab) {
      setError('Your browser blocked the new tab. Allow pop-ups for this site, or download the PDF.');
      return;
    }
    try {
      tab.opener = null;
      tab.location.href = await urlFor(item, true);
    } catch (err) {
      tab?.close();
      setError(errorMessage(err));
    }
  };

  // The middle of the viewer, by kind of file.
  let body;
  if (error) {
    body = <p className="text-white-50">{error}</p>;
  } else if (kind === 'image') {
    body = url ? <img src={url} alt={item.name} className="files-preview-media" /> : <Spinner />;
  } else if (kind === 'video') {
    body = url ? <video src={url} controls autoPlay className="files-preview-media" /> : <Spinner />;
  } else if (kind === 'audio') {
    body = url ? <audio src={url} controls autoPlay /> : <Spinner />;
  } else if (kind === 'text' && item.size <= MAX_TEXT_BYTES) {
    body = text === null ? <Spinner /> : <pre className="files-preview-text">{text}</pre>;
  } else {
    body = (
      <div className="text-center text-white">
        <FontAwesomeIcon icon={iconFor(item)} size="4x" style={{ color: iconColor(item) }} className="mb-3" />
        <p className="mb-1 fw-semibold">{item.name}</p>
        <p className="text-white-50 small">{formatBytes(item.size)} · {kind === 'pdf' ? 'Opens in a new tab' : 'No preview available'}</p>
        {kind === 'pdf' ? (
          <button type="button" className="btn btn-light" onClick={openPdf}>
            <FontAwesomeIcon icon={faArrowUpRightFromSquare} className="me-2" />Open PDF
          </button>
        ) : (
          <button type="button" className="btn btn-light" onClick={() => onDownload(item)}>
            <FontAwesomeIcon icon={faDownload} className="me-2" />Download
          </button>
        )}
      </div>
    );
  }

  // Rendered into <body>, over everything, so no parent's layout or overflow clips it.
  return createPortal(
    <div className="files-preview" role="dialog" aria-modal="true" aria-label={item.name}>
      <header className="files-preview-head">
        <FontAwesomeIcon icon={iconFor(item)} style={{ color: iconColor(item) }} />
        <span className="fw-semibold text-truncate me-auto">{item.name}</span>
        <button type="button" className="icon-btn text-white" onClick={() => onDownload(item)} title="Download" aria-label="Download">
          <FontAwesomeIcon icon={faDownload} />
        </button>
        <button type="button" className="icon-btn text-white" onClick={onClose} title="Close" aria-label="Close preview">
          <FontAwesomeIcon icon={faXmark} size="lg" />
        </button>
      </header>
      {/* Clicking the dark area around the file closes the viewer. */}
      <div className="files-preview-body" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        {prev && (
          <button type="button" className="files-preview-nav start" onClick={() => onNavigate(prev)} aria-label={`Previous: ${prev.name}`}>
            <FontAwesomeIcon icon={faChevronLeft} />
          </button>
        )}
        {body}
        {next && (
          <button type="button" className="files-preview-nav end" onClick={() => onNavigate(next)} aria-label={`Next: ${next.name}`}>
            <FontAwesomeIcon icon={faChevronRight} />
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
