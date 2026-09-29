import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFile, faFolder } from '@fortawesome/free-solid-svg-icons';
import Modal from '../../../core/components/Modal';
import { errorMessage } from '../../../core/api/client';
import { useToast } from '../../../core/context/ToastContext';
import { notesApi } from '../api';
import { fromMarkdown } from '../utils/markdown';
import { MAX_FOLDER_DEPTH } from '../../../core/components/folders/tree';

// The server takes at most 100 notes and 256 KB per request, so larger
// imports are sent in batches.
const BATCH_NOTES = 100;
const BATCH_BYTES = 240_000;
const MAX_FILES = 2000;
const MAX_FILE_BYTES = 1_000_000;
const NOTE_FILE = /\.(md|markdown|txt)$/i;

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const folderSegment = (s) => s.replace(/[<>\\\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);

function batches(notes) {
  const out = [];
  let current = [];
  let size = 0;
  for (const n of notes) {
    const bytes = JSON.stringify(n).length;
    if (bytes > BATCH_BYTES) throw new Error(`"${n.title || 'Untitled'}" is too large to import.`);
    if (current.length && (current.length >= BATCH_NOTES || size + bytes > BATCH_BYTES)) {
      out.push(current);
      current = [];
      size = 0;
    }
    current.push(n);
    size += bytes;
  }
  if (current.length) out.push(current);
  return out;
}

// Imports into `targetPath` (the open folder's names, or [] for none). Picking
// a folder keeps its subfolders; hidden folders such as .obsidian are skipped.
export default function ImportNotesModal({ targetPath, onImported, onClose }) {
  const toast = useToast();
  const [notes, setNotes] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');

  const pick = async (e) => {
    const all = [...e.target.files];
    e.target.value = '';
    setError('');
    setNotes([]);
    const files = all.filter((f) => NOTE_FILE.test(f.name) && !(f.webkitRelativePath || '').split('/').some((seg) => seg.startsWith('.')));
    if (!files.length) {
      if (all.length) setError('No Markdown files (.md) found.');
      return;
    }
    if (files.length > MAX_FILES) {
      setError(`Pick up to ${MAX_FILES} files at a time.`);
      return;
    }
    const tooBig = files.find((f) => f.size > MAX_FILE_BYTES);
    if (tooBig) {
      setError(`${tooBig.name} is too large to import.`);
      return;
    }
    try {
      const parsed = await Promise.all(files.map(async (f) => {
        const dirs = (f.webkitRelativePath || '').split('/').slice(0, -1).map(folderSegment).filter(Boolean);
        const folderPath = [...targetPath, ...dirs];
        if (folderPath.length > MAX_FOLDER_DEPTH) throw new Error(`${f.webkitRelativePath} is nested more than ${MAX_FOLDER_DEPTH} folders deep.`);
        const note = fromMarkdown(await f.text(), f.name.replace(NOTE_FILE, ''));
        return folderPath.length ? { ...note, folderPath } : note;
      }));
      batches(parsed);
      setNotes(parsed);
    } catch (err) {
      setError(err.message || 'Some of these files could not be read.');
    }
  };

  const submit = async () => {
    setBusy(true);
    let done = 0;
    try {
      const groups = batches(notes);
      for (const group of groups) {
        if (groups.length > 1) setProgress(`Importing ${done + group.length} of ${notes.length}…`);
        done += (await notesApi.importNotes(group)).imported;
      }
      toast.success(`Imported ${plural(done, 'note')}`);
      onImported();
      onClose();
    } catch (err) {
      toast.error(done ? `Imported ${plural(done, 'note')}, then: ${errorMessage(err)}` : errorMessage(err));
      if (done) onImported();
      setBusy(false);
      setProgress('');
    }
  };

  const folders = new Set(notes.map((n) => (n.folderPath || []).join(' / ')).filter(Boolean));

  return (
    <Modal
      title="Import notes"
      onClose={onClose}
      footer={
        <>
          {progress && <span className="small text-muted me-auto">{progress}</span>}
          <button type="button" className="btn btn-light" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={busy || !notes.length}>
            {notes.length ? `Import ${plural(notes.length, 'note')}` : 'Import'}
          </button>
        </>
      }
    >
      <p className="small text-muted">
        Import Markdown files (.md), for example from Obsidian or another notes app. Each file becomes a note.
        A <code># Heading</code> on the first line becomes the title, and <code>tags:</code> in the front matter become tags.
        Picking a folder keeps its subfolders.
      </p>
      <p className="small mb-3">
        Importing into: <strong>{targetPath.length ? targetPath.join(' / ') : 'No folder'}</strong>
      </p>
      <div className="d-flex flex-wrap gap-2">
        <label className="btn btn-outline-primary mb-0">
          <FontAwesomeIcon icon={faFile} className="me-2" />Pick files
          <input type="file" className="d-none" accept=".md,.markdown,.txt,text/markdown,text/plain" multiple onChange={pick} disabled={busy} />
        </label>
        <label className="btn btn-outline-primary mb-0">
          <FontAwesomeIcon icon={faFolder} className="me-2" />Pick a folder
          <input type="file" className="d-none" webkitdirectory="" directory="" multiple onChange={pick} disabled={busy} />
        </label>
      </div>
      {error && <div className="alert alert-danger py-2 mt-3 mb-0" role="alert">{error}</div>}
      {notes.length > 0 && (
        <>
          <p className="small text-muted mt-3 mb-1">
            {plural(notes.length, 'note')}{folders.size > 0 && ` in ${plural(folders.size, 'folder')}`}
          </p>
          <ul className="list-unstyled small mb-0" style={{ maxHeight: 240, overflowY: 'auto' }}>
            {notes.slice(0, 300).map((n, i) => (
              // eslint-disable-next-line react/no-array-index-key
              <li key={i} className="py-1 border-bottom text-truncate">
                {n.folderPath?.length > 0 && <span className="text-muted">{n.folderPath.join(' / ')} / </span>}
                <span className="fw-semibold">{n.title || 'Untitled'}</span>
                {n.tags.length > 0 && <span className="text-muted"> · {n.tags.join(', ')}</span>}
              </li>
            ))}
            {notes.length > 300 && <li className="py-1 text-muted">…and {notes.length - 300} more</li>}
          </ul>
        </>
      )}
    </Modal>
  );
}
