import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { CharacterCount, Placeholder } from '@tiptap/extensions';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faFileWord, faFolder, faCircleExclamation, faMinus, faPlus, faRotateLeft, faArrowLeft,
} from '@fortawesome/free-solid-svg-icons';
import { officeApi } from '../api';
import useDocumentSync from '../useDocumentSync';
import { docExtensions } from './extensions';
import { FindHighlight } from './findReplace';
import { pageBox, mmToPx } from './fonts';
import { uploadImageFile } from './images';
import { printDocument } from './print';
import { changeFontSize } from './Toolbar';
import Toolbar from './Toolbar';
import MenuBar from './MenuBar';
import Ruler from './Ruler';
import FindPanel from './FindPanel';
import PageSetupModal from './PageSetupModal';
import LinkModal from './LinkModal';
import MoveToFolderModal from '../../../core/components/folders/MoveToFolderModal';
import { buildTree } from '../../../core/components/folders/tree';
import Spinner from '../../../core/components/Spinner';
import { errorMessage } from '../../../core/api/client';
import { useToast } from '../../../core/context/ToastContext';
import { useWorkspace } from '../../../core/context/WorkspaceContext';
import ViewOnlyNotice from '../../../core/components/ViewOnlyNotice';
import { downloadBlob } from '../../../core/utils/download';
import './docs.scss';

const STATUS = { saved: 'Saved', unsaved: 'Editing…', saving: 'Saving…', error: 'Not saved', conflict: 'Not saved' };
const safeFileName = (title) => (title || 'Untitled document').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim().slice(0, 100) || 'Untitled document';

// A per-browser preference (zoom, ruler), kept in localStorage when available.
function usePref(key, fallback) {
  const storageKey = `kanforge.docs.${key}`;
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  });
  const set = useCallback((v) => {
    setValue(v);
    try {
      localStorage.setItem(storageKey, JSON.stringify(v));
    } catch {
      // Storage can be unavailable (private windows); the preference just isn't remembered.
    }
  }, [storageKey]);
  return [value, set];
}

const imageFiles = (dataTransfer) => [...(dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/'));

function DocWorkspace({ sync }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [zoom, setZoom] = usePref('zoom', 100);
  const [showRuler, setShowRuler] = usePref('ruler', true);
  const [modal, setModal] = useState(null);
  const [find, setFind] = useState(null);
  const [folderTree, setFolderTree] = useState(null);
  const [pages, setPages] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const canvasRef = useRef(null);
  const paperRef = useRef(null);
  const imageInput = useRef(null);
  const docxInput = useRef(null);
  const editorRef = useRef(null);

  const { doc, settings } = sync;
  const trashed = Boolean(doc.trashedAt);
  // View-only access (set by a platform admin) reads like the trash: nothing changes.
  const viewOnly = !useWorkspace().canEdit('office');
  const locked = trashed || viewOnly;
  const box = pageBox(settings);
  const pageW = mmToPx(box.width);
  const pageH = mmToPx(box.height);
  const margin = {
    top: mmToPx(settings.margins.top),
    right: mmToPx(settings.margins.right),
    bottom: mmToPx(settings.margins.bottom),
    left: mmToPx(settings.margins.left),
  };
  const contentWidth = pageW - margin.left - margin.right;

  const insertImages = useCallback(async (files, pos) => {
    const editor = editorRef.current;
    for (const file of files) {
      try {
        const attrs = await uploadImageFile(file, contentWidth);
        const node = { type: 'docImage', attrs: { ...attrs, alt: file.name.replace(/\.\w+$/, '') } };
        if (typeof pos === 'number') editor.chain().focus().insertContentAt(pos, node).run();
        else editor.chain().focus().insertContent(node).run();
      } catch (err) {
        toast.error(errorMessage(err, err.message || 'Could not add the picture'));
      }
    }
  }, [contentWidth, toast]);

  const editor = useEditor({
    extensions: [...docExtensions, CharacterCount, Placeholder.configure({ placeholder: 'Type here…' }), FindHighlight],
    content: doc.content,
    editable: !locked,
    onUpdate: () => sync.markDirty(),
    editorProps: {
      attributes: { class: 'doc-body', spellcheck: 'true' },
      handlePaste: (_view, event) => {
        const files = imageFiles(event.clipboardData);
        if (!files.length) return false;
        insertImages(files);
        return true;
      },
      handleDrop: (view, event, _slice, moved) => {
        const files = imageFiles(event.dataTransfer);
        if (moved || !files.length) return false;
        insertImages(files, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos);
        return true;
      },
    },
  });
  editorRef.current = editor;

  const syncRef = useRef(sync);
  syncRef.current = sync;
  useEffect(() => {
    syncRef.current.setContentGetter(() => editor.getJSON());
  }, [editor]);

  // Folder names, for the folder path in the title bar.
  useEffect(() => {
    officeApi.folders().then((data) => setFolderTree(buildTree(data.folders))).catch(() => {});
  }, []);

  const counts = useEditorState({
    editor,
    selector: ({ editor: e }) => ({ words: e.storage.characterCount.words(), chars: e.storage.characterCount.characters() }),
  });

  // Page layout: a hard page break pushes what follows to the top of the next
  // page, and the paper grows a page at a time. Print, PDF and Word export
  // paginate for real; on screen, text that runs past a page edge carries on
  // across the marked boundary.
  const layout = useCallback(() => {
    const dom = editor?.view?.dom;
    if (!dom) return;
    const breaks = dom.querySelectorAll('.page-break');
    breaks.forEach((b) => {
      b.style.height = '';
    });
    breaks.forEach((b) => {
      const y = margin.top + b.offsetTop;
      const rest = pageH - (y % pageH);
      b.style.height = `${rest + margin.top}px`;
    });
    setPages(Math.max(1, Math.ceil((margin.top + dom.scrollHeight + margin.bottom) / pageH)));
  }, [editor, pageH, margin.top, margin.bottom]);

  useLayoutEffect(() => {
    layout();
    const dom = editor?.view?.dom;
    if (!dom) return undefined;
    const observer = new ResizeObserver(() => layout());
    observer.observe(dom);
    editor.on('update', layout);
    return () => {
      observer.disconnect();
      editor.off('update', layout);
    };
  }, [editor, layout]);

  const onScroll = () => {
    const canvas = canvasRef.current;
    const paper = paperRef.current;
    if (!canvas || !paper) return;
    const probe = canvas.getBoundingClientRect().top + canvas.clientHeight * 0.3 - paper.getBoundingClientRect().top;
    setCurrentPage(Math.min(pages, Math.max(1, Math.floor(probe / ((pageH * zoom) / 100)) + 1)));
  };

  const actions = {
    print: () => printDocument(settings, sync.title),
    clearFormatting: () => editor.chain().focus().unsetAllMarks().clearNodes().run(),
    link: () => setModal('link'),
    image: () => imageInput.current?.click(),
    find: () => setFind({ replace: true }),
    pageSetup: () => setModal('pageSetup'),
    toggleRuler: () => setShowRuler(!showRuler),
    setZoom,
    openOffice: () => navigate('/office'),
    pasteHint: () => toast.success('Press Ctrl+V (⌘V on a Mac) to paste.'),
    newDocument: async () => {
      try {
        const { document } = await officeApi.create({ kind: 'doc', folderId: doc.folderId });
        navigate(`/office/docs/${document.id}`);
      } catch (err) {
        toast.error(errorMessage(err));
      }
    },
    copy: async () => {
      try {
        await sync.save();
        const { document } = await officeApi.copy(doc.id);
        toast.success(`Created "${document.title}"`);
        navigate(`/office/docs/${document.id}`);
      } catch (err) {
        toast.error(errorMessage(err));
      }
    },
    importDocx: () => docxInput.current?.click(),
    downloadDocx: async () => {
      try {
        const { exportDocx } = await import('./exportDocx');
        const blob = await exportDocx({ content: editor.getJSON(), settings, title: sync.title });
        downloadBlob(blob, `${safeFileName(sync.title)}.docx`);
      } catch (err) {
        toast.error(errorMessage(err, 'Could not create the Word file'));
      }
    },
    downloadPdf: () => {
      toast.success('Choose "Save as PDF" in the print dialog.');
      setTimeout(() => printDocument(settings, sync.title), 300);
    },
    downloadText: () => downloadBlob(new Blob([editor.getText({ blockSeparator: '\n\n' })], { type: 'text/plain' }), `${safeFileName(sync.title)}.txt`),
    move: async () => {
      try {
        const data = await officeApi.folders();
        setFolderTree(buildTree(data.folders));
        setModal('move');
      } catch (err) {
        toast.error(errorMessage(err));
      }
    },
    trash: async () => {
      try {
        await sync.save();
        await officeApi.trash(doc.id);
        toast.success('Moved to the trash');
        navigate('/office', { replace: true });
      } catch (err) {
        toast.error(errorMessage(err));
      }
    },
  };

  const restore = async () => {
    try {
      await officeApi.restore(doc.id);
      await sync.takeLatest();
      toast.success('Document restored');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  // Word's shortcuts, including ones the browser would otherwise take (save, print, find).
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      const a = actionsRef.current;
      const handlers = {
        s: () => syncRef.current.save(),
        p: a.print,
        f: () => setFind({ replace: false }),
        h: () => setFind({ replace: true }),
        k: locked ? null : a.link,
        ']': locked ? null : () => changeFontSize(editorRef.current, 1),
        '[': locked ? null : () => changeFontSize(editorRef.current, -1),
      };
      if (handlers[k] && !e.shiftKey) {
        e.preventDefault();
        handlers[k]();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [locked]);

  const onImportDocx = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { importDocx } = await import('./importDocx');
      const result = await importDocx(file);
      const { document } = await officeApi.create({ kind: 'doc', title: result.title, content: result.content, folderId: doc.folderId });
      if (result.warnings) toast.error(result.warnings);
      toast.success(`Opened "${document.title}"`);
      navigate(`/office/docs/${document.id}`);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not open that Word document'));
    }
  };

  if (!editor) return <Spinner fullscreen />;
  const folderPath = folderTree && doc.folderId && folderTree.byId.has(doc.folderId) ? folderTree.pathNames(doc.folderId).join(' / ') : null;

  return (
    <div className="doc-app">
      <div className="doc-chrome">
        <div className="doc-titlebar">
          <Link to="/office" className="doc-home" title="Back to Office" aria-label="Back to Office">
            <FontAwesomeIcon icon={faArrowLeft} className="d-sm-none" />
            <FontAwesomeIcon icon={faFileWord} className="d-none d-sm-inline" />
          </Link>
          <div className="min-w-0 flex-grow-1">
            <div className="d-flex align-items-center gap-2">
              <input className="doc-title" value={sync.title} placeholder="Untitled document" maxLength={200}
                readOnly={locked} onChange={(e) => sync.setTitle(e.target.value)} aria-label="Document title" />
              <span className={`small text-nowrap ${sync.status === 'error' || sync.status === 'conflict' ? 'text-danger fw-semibold' : 'text-muted'}`} role="status">
                {trashed ? 'In the trash' : viewOnly ? 'View only' : STATUS[sync.status]}
              </span>
              {sync.status === 'error' && <button type="button" className="btn btn-link btn-sm p-0" onClick={() => sync.save()}>Retry</button>}
              {folderPath && (
                <button type="button" className="doc-folder d-none d-md-inline-flex" onClick={actions.move} title="Move to another folder">
                  <FontAwesomeIcon icon={faFolder} className="me-1" />{folderPath}
                </button>
              )}
            </div>
            {!locked && <MenuBar editor={editor} actions={actions} zoom={zoom} showRuler={showRuler} />}
          </div>
        </div>
        {!locked && <Toolbar editor={editor} actions={actions} />}
        {sync.status === 'conflict' && (
          <div className="alert alert-warning d-flex flex-wrap align-items-center gap-2 m-2 py-2" role="alert">
            <FontAwesomeIcon icon={faCircleExclamation} />
            <span className="me-auto">This document was changed in another tab or device.</span>
            <button type="button" className="btn btn-sm btn-outline-dark" onClick={sync.takeLatest}>Use the latest version</button>
            <button type="button" className="btn btn-sm btn-dark" onClick={sync.keepMine}>Keep my version</button>
          </div>
        )}
        {viewOnly && <ViewOnlyNotice className="m-2" />}
        {trashed && !viewOnly && (
          <div className="alert alert-secondary d-flex align-items-center gap-2 m-2 py-2" role="alert">
            <span className="me-auto">This document is in the trash, so it can't be edited.</span>
            <button type="button" className="btn btn-sm btn-primary" onClick={restore}><FontAwesomeIcon icon={faRotateLeft} className="me-1" />Restore</button>
          </div>
        )}
      </div>

      <div className="doc-canvas-wrap">
      {find && <FindPanel key={String(find.replace)} editor={editor} showReplace={find.replace && !locked} onClose={() => { setFind(null); editor.commands.focus(); }} />}
      <div className="doc-canvas" ref={canvasRef} onScroll={onScroll}>
        <div className="doc-zoom" style={{ zoom: zoom / 100 }}>
          {showRuler && !locked && <Ruler widthMm={box.width} margins={settings.margins} inches={['letter', 'legal'].includes(settings.pageSize)} />}
          <div
            className="doc-paper"
            ref={paperRef}
            style={{ width: pageW, minHeight: pages * pageH, padding: `${margin.top}px ${margin.right}px ${margin.bottom}px ${margin.left}px` }}
            onMouseDown={(e) => {
              // Clicking the margins puts the cursor in the text, like Word.
              if (e.target === paperRef.current) {
                e.preventDefault();
                editor.commands.focus(e.clientY > editor.view.dom.getBoundingClientRect().bottom ? 'end' : undefined);
              }
            }}
          >
            {Array.from({ length: pages - 1 }, (_, i) => (
              <div key={i} className="doc-page-edge" style={{ top: (i + 1) * pageH }} aria-hidden="true"><span>Page {i + 2}</span></div>
            ))}
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>
      </div>

      <div className="doc-statusbar">
        <span>Page {Math.min(currentPage, pages)} of {pages}</span>
        <span>{counts.words.toLocaleString()} word{counts.words === 1 ? '' : 's'}</span>
        <span className="d-none d-sm-inline">{counts.chars.toLocaleString()} characters</span>
        <span className="ms-auto d-flex align-items-center gap-2">
          <button type="button" className="doc-zoom-btn" onClick={() => setZoom(Math.max(50, zoom - 10))} aria-label="Zoom out"><FontAwesomeIcon icon={faMinus} /></button>
          <input type="range" min={50} max={200} step={10} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Zoom" className="doc-zoom-range" />
          <button type="button" className="doc-zoom-btn" onClick={() => setZoom(Math.min(200, zoom + 10))} aria-label="Zoom in"><FontAwesomeIcon icon={faPlus} /></button>
          <button type="button" className="doc-zoom-btn" style={{ minWidth: 44 }} onClick={() => setZoom(100)} title="Reset zoom">{zoom}%</button>
        </span>
      </div>

      <input ref={imageInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple className="d-none"
        onChange={(e) => { insertImages([...e.target.files]); e.target.value = ''; }} />
      <input ref={docxInput} type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="d-none" onChange={onImportDocx} />

      {modal === 'pageSetup' && <PageSetupModal settings={settings} onSave={sync.setSettings} onClose={() => setModal(null)} />}
      {modal === 'link' && <LinkModal editor={editor} onClose={() => setModal(null)} />}
      {modal === 'move' && folderTree && (
        <MoveToFolderModal
          tree={folderTree}
          title="Move document to…"
          currentId={doc.folderId && folderTree.byId.has(doc.folderId) ? doc.folderId : null}
          onMove={async (folderId) => {
            try {
              await sync.moveTo(folderId);
            } catch (err) {
              toast.error(errorMessage(err));
              throw err;
            }
          }}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

export default function DocEditor() {
  const { docId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const onError = useCallback((err, when) => {
    toast.error(errorMessage(err, when === 'load' ? 'Could not open the document' : 'Could not save the document'));
    if (when === 'load') navigate('/office', { replace: true });
  }, [toast, navigate]);
  const sync = useDocumentSync(docId, { onError });

  if (!sync.doc || !sync.settings) return <Spinner fullscreen />;
  if (sync.doc.kind === 'sheet') return <Navigate to={`/office/sheets/${docId}`} replace />;
  return <DocWorkspace key={`${docId}:${sync.loadKey}`} sync={sync} />;
}
