import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { Placeholder } from '@tiptap/extensions';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowLeft, faThumbtack, faBoxArchive, faBoxOpen, faTrashCan, faDownload, faRotateLeft, faCircleExclamation, faFolder,
} from '@fortawesome/free-solid-svg-icons';
import { notesApi } from '../api';
import { noteExtensions } from '../extensions';
import { toMarkdown, fileNames } from '../utils/markdown';
import { downloadBlob } from '../../../core/utils/download';
import EditorToolbar from './EditorToolbar';
import TagInput from './TagInput';
import MoveToFolderModal from '../../../core/components/folders/MoveToFolderModal';
import ConfirmModal from '../../../core/components/ConfirmModal';
import Spinner from '../../../core/components/Spinner';
import { errorMessage } from '../../../core/api/client';
import { useToast } from '../../../core/context/ToastContext';
import { timeAgo } from '../../../core/utils/dates';

// Saves this long after the last keystroke.
const SAVE_DELAY_MS = 800;
const extensions = [...noteExtensions, Placeholder.configure({ placeholder: 'Start writing…' })];

function EditorBody({ content, editable, onUpdate, editorRef }) {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const editor = useEditor({
    extensions,
    content,
    editable,
    onUpdate: () => onUpdateRef.current(),
  });
  useEffect(() => {
    editorRef.current = editor;
  }, [editor, editorRef]);
  if (!editor) return null;
  return (
    <>
      {editable && <EditorToolbar editor={editor} />}
      <EditorContent editor={editor} className="note-content" />
    </>
  );
}

const STATUS_TEXT = { saved: 'Saved', unsaved: 'Unsaved changes', saving: 'Saving…', error: 'Not saved', conflict: 'Not saved' };

export default function NoteEditor({ noteId, tree, moved, tagSuggestions, onChanged, onRemoved, onBack, readOnly = false }) {
  const toast = useToast();
  const [note, setNote] = useState(null);
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('saved');
  const [bodyKey, setBodyKey] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [moving, setMoving] = useState(false);

  const editorRef = useRef(null);
  const titleRef = useRef('');
  const versionRef = useRef(0);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const againRef = useRef(false);
  const conflictRef = useRef(false);
  const timerRef = useRef(null);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  const load = useCallback(async () => {
    const data = await notesApi.get(noteId);
    versionRef.current = data.note.version;
    titleRef.current = data.note.title;
    dirtyRef.current = false;
    conflictRef.current = false;
    setNote(data.note);
    setTitle(data.note.title);
    setStatus('saved');
    setBodyKey((k) => k + 1);
    return data.note;
  }, [noteId]);

  useEffect(() => {
    load().catch((err) => {
      toast.error(errorMessage(err, 'Could not open the note'));
      onBack();
    });
  }, [load, toast, onBack]);

  // The note was dragged to another folder from the sidebar.
  useEffect(() => {
    if (moved) setNote((n) => (n ? { ...n, folderId: moved.folderId } : n));
  }, [moved]);

  const save = useCallback(async () => {
    clearTimeout(timerRef.current);
    if (conflictRef.current || !dirtyRef.current || !editorRef.current) return;
    if (savingRef.current) {
      againRef.current = true;
      return;
    }
    savingRef.current = true;
    dirtyRef.current = false;
    setStatus('saving');
    try {
      const data = await notesApi.update(noteId, {
        title: titleRef.current,
        content: editorRef.current.getJSON(),
        version: versionRef.current,
      });
      versionRef.current = data.note.version;
      setNote((n) => ({ ...n, ...data.note }));
      onChangedRef.current(data.note);
      setStatus(dirtyRef.current ? 'unsaved' : 'saved');
    } catch (err) {
      dirtyRef.current = true;
      if (err?.response?.data?.error?.code === 'VERSION_CONFLICT') {
        conflictRef.current = true;
        setStatus('conflict');
      } else {
        setStatus('error');
        toast.error(errorMessage(err, 'Could not save the note'));
      }
    } finally {
      savingRef.current = false;
      if (againRef.current) {
        againRef.current = false;
        if (dirtyRef.current && !conflictRef.current) timerRef.current = setTimeout(save, 0);
      }
    }
  }, [noteId, toast]);

  const scheduleSave = useCallback(() => {
    dirtyRef.current = true;
    if (conflictRef.current) return;
    setStatus('unsaved');
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(save, SAVE_DELAY_MS);
  }, [save]);

  // Leaving the note (or the page) saves what's pending, and the browser warns
  // before closing with unsaved changes.
  useEffect(() => {
    const warn = (e) => {
      if (dirtyRef.current || savingRef.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
      clearTimeout(timerRef.current);
      if (dirtyRef.current && !conflictRef.current && editorRef.current && !savingRef.current) {
        let content;
        try {
          content = editorRef.current.getJSON();
        } catch {
          return;
        }
        notesApi
          .update(noteId, { title: titleRef.current, content, version: versionRef.current })
          .then((data) => onChangedRef.current(data.note))
          .catch(() => {});
      }
    };
  }, [noteId]);

  const onTitle = (value) => {
    titleRef.current = value;
    setTitle(value);
    scheduleSave();
  };

  // Pin, archive, tags and folder don't touch the text, so they save straight away without a version.
  const updateMeta = async (fields, { rethrow = false } = {}) => {
    try {
      const data = await notesApi.update(noteId, fields);
      setNote((n) => ({ ...n, ...data.note, version: n.version }));
      onChangedRef.current(data.note, true);
    } catch (err) {
      toast.error(errorMessage(err));
      if (rethrow) throw err;
    }
  };

  const takeLatest = () => load().catch((err) => toast.error(errorMessage(err)));
  const keepMine = async () => {
    try {
      const data = await notesApi.get(noteId);
      versionRef.current = data.note.version;
      conflictRef.current = false;
      dirtyRef.current = true;
      await save();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const moveToTrash = async () => {
    clearTimeout(timerRef.current);
    if (dirtyRef.current) await save();
    try {
      await notesApi.trash(noteId);
      dirtyRef.current = false;
      toast.success('Moved to the trash');
      onRemoved(noteId);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const restore = async () => {
    try {
      await notesApi.restore(noteId);
      toast.success('Note restored');
      onRemoved(noteId);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const deleteForever = async () => {
    try {
      await notesApi.remove(noteId);
      toast.success('Note deleted');
      onRemoved(noteId);
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  };

  const exportNote = () => {
    const current = { title: titleRef.current, tags: note.tags, content: editorRef.current?.getJSON() ?? note.content };
    downloadBlob(new Blob([toMarkdown(current)], { type: 'text/markdown' }), fileNames([current])[0]);
  };

  if (!note) return <div className="p-5 text-center"><Spinner /></div>;
  const trashed = Boolean(note.trashedAt);
  // In the trash, or view-only access: nothing here can change.
  const locked = trashed || readOnly;
  const folderPath = note.folderId && tree.byId.has(note.folderId) ? tree.pathNames(note.folderId) : [];

  return (
    <div className="note-editor">
      <div className="note-editor-head">
        <button type="button" className="btn btn-sm btn-light d-md-none" onClick={onBack} aria-label="Back to notes">
          <FontAwesomeIcon icon={faArrowLeft} />
        </button>
        <span className={`small ${status === 'error' || status === 'conflict' ? 'text-danger fw-semibold' : 'text-muted'}`} role="status">
          {trashed ? 'In the trash' : readOnly ? 'View only' : STATUS_TEXT[status]}
          {!locked && status === 'saved' && note.updatedAt && <span className="d-none d-sm-inline"> · edited {timeAgo(note.updatedAt)}</span>}
        </span>
        {status === 'error' && <button type="button" className="btn btn-link btn-sm p-0" onClick={() => save()}>Retry</button>}
        <div className="ms-auto d-flex gap-1">
          {readOnly ? (
            <button type="button" className="icon-btn" onClick={exportNote} aria-label="Download as Markdown" title="Download as Markdown">
              <FontAwesomeIcon icon={faDownload} />
            </button>
          ) : trashed ? (
            <>
              <button type="button" className="btn btn-sm btn-outline-primary" onClick={restore}>
                <FontAwesomeIcon icon={faRotateLeft} className="me-1" />Restore
              </button>
              <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => setConfirmDelete(true)}>Delete forever</button>
            </>
          ) : (
            <>
              <button type="button" className={`icon-btn ${note.pinned ? 'text-primary' : ''}`} onClick={() => updateMeta({ pinned: !note.pinned })}
                aria-pressed={note.pinned} aria-label={note.pinned ? 'Unpin' : 'Pin'} title={note.pinned ? 'Unpin' : 'Pin to top'}>
                <FontAwesomeIcon icon={faThumbtack} />
              </button>
              <button type="button" className="icon-btn" onClick={() => updateMeta({ archived: !note.archived })}
                aria-label={note.archived ? 'Unarchive' : 'Archive'} title={note.archived ? 'Move out of the archive' : 'Archive'}>
                <FontAwesomeIcon icon={note.archived ? faBoxOpen : faBoxArchive} />
              </button>
              <button type="button" className="icon-btn" onClick={exportNote} aria-label="Download as Markdown" title="Download as Markdown">
                <FontAwesomeIcon icon={faDownload} />
              </button>
              <button type="button" className="icon-btn text-danger" onClick={moveToTrash} aria-label="Move to trash" title="Move to trash">
                <FontAwesomeIcon icon={faTrashCan} />
              </button>
            </>
          )}
        </div>
      </div>

      {status === 'conflict' && (
        <div className="alert alert-warning d-flex flex-wrap align-items-center gap-2 mx-3 mt-3 mb-0 py-2" role="alert">
          <FontAwesomeIcon icon={faCircleExclamation} />
          <span className="me-auto">This note was changed in another tab or device.</span>
          <button type="button" className="btn btn-sm btn-outline-dark" onClick={takeLatest}>Use the latest version</button>
          <button type="button" className="btn btn-sm btn-dark" onClick={keepMine}>Keep my version</button>
        </div>
      )}

      <div className="note-editor-body">
        <input
          className="note-title"
          placeholder="Untitled"
          value={title}
          maxLength={200}
          readOnly={locked}
          onChange={(e) => onTitle(e.target.value)}
          aria-label="Title"
        />
        <button type="button" className="note-folder-btn" onClick={() => setMoving(true)} disabled={locked} title="Move to another folder">
          <FontAwesomeIcon icon={faFolder} className="me-1" />
          <span className="text-truncate">{folderPath.length ? folderPath.join(' / ') : 'No folder'}</span>
        </button>
        <div className="mb-3">
          <TagInput tags={note.tags} suggestions={tagSuggestions} disabled={locked} onChange={(tags) => updateMeta({ tags })} />
        </div>
        <EditorBody key={bodyKey} content={note.content} editable={!locked} onUpdate={scheduleSave} editorRef={editorRef} />
      </div>

      {moving && (
        <MoveToFolderModal
          tree={tree}
          title="Move note to…"
          currentId={note.folderId && tree.byId.has(note.folderId) ? note.folderId : null}
          onMove={(folderId) => updateMeta({ folderId }, { rethrow: true })}
          onClose={() => setMoving(false)}
        />
      )}
      {confirmDelete && (
        <ConfirmModal
          title="Delete this note forever?"
          message="It can't be recovered afterwards."
          confirmLabel="Delete forever"
          onConfirm={deleteForever}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}
