import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faFilePowerpoint, faFolder, faCircleExclamation, faRotateLeft, faArrowLeft, faEllipsisVertical, faPlay, faNoteSticky, faPlus,
} from '@fortawesome/free-solid-svg-icons';
import { officeApi } from '../api';
import useDocumentSync from '../useDocumentSync';
import { uploadImageFile } from '../docs/images';
import { DropMenu, ColorGrid } from '../docs/ui';
import SlideView, { SlideElement } from './SlideView';
import SlideMenuBar from './SlideMenuBar';
import SlideToolbar from './SlideToolbar';
import Present from './Present';
import { printSlides } from './printSlides';
import {
  fromContent, toContent, makeSlide, newId, slideSize, themeOf, textCss, LIMITS, SIZES,
} from './model';
import Modal from '../../../core/components/Modal';
import MoveToFolderModal from '../../../core/components/folders/MoveToFolderModal';
import { buildTree } from '../../../core/components/folders/tree';
import Spinner from '../../../core/components/Spinner';
import { errorMessage } from '../../../core/api/client';
import { useToast } from '../../../core/context/ToastContext';
import { downloadBlob } from '../../../core/utils/download';
import '../docs/docs.scss';
import './slides.scss';

const STATUS = { saved: 'Saved', unsaved: 'Editing…', saving: 'Saving…', error: 'Not saved', conflict: 'Not saved' };
const safeFileName = (title) => (title || 'Untitled presentation').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim().slice(0, 100) || 'Untitled presentation';
const MAX_HISTORY = 100;
const SIZE_STEPS = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 72, 80, 96];
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const MIN_SIZE = 8;
const SNAP_PX = 6;
const EMPTY = new Set();
const NO_STYLE = Object.freeze({});

const round = (n) => Math.round(n * 10) / 10;
const hasText = (el) => el.type === 'text' || (el.type === 'shape' && el.shape !== 'line');

// ---- Pure deck edits ----

function withSlide(deck, index, fn) {
  const slides = deck.slides.slice();
  slides[index] = fn(slides[index]);
  return { ...deck, slides };
}

function withElements(deck, index, ids, fn) {
  return withSlide(deck, index, (s) => ({ ...s, elements: s.elements.map((el) => (ids.has(el.id) ? fn(el) : el)) }));
}

function cloneElement(el, dx = 0, dy = 0) {
  return { ...el, id: newId('e'), x: round(el.x + dx), y: round(el.y + dy), style: { ...el.style } };
}

function resizeBox(o, dir, dx, dy, keepRatio) {
  let { x, y, w, h } = o;
  if (dir.includes('e')) w = o.w + dx;
  if (dir.includes('s')) h = o.h + dy;
  if (dir.includes('w')) { w = o.w - dx; x = o.x + dx; }
  if (dir.includes('n')) { h = o.h - dy; y = o.y + dy; }
  if (keepRatio && dir.length === 2 && o.h > 0) {
    const ratio = o.w / o.h;
    if (w / h > ratio) {
      const nw = h * ratio;
      if (dir.includes('w')) x += w - nw;
      w = nw;
    } else {
      const nh = w / ratio;
      if (dir.includes('n')) y += h - nh;
      h = nh;
    }
  }
  if (w < MIN_SIZE) {
    if (dir.includes('w')) x = o.x + o.w - MIN_SIZE;
    w = MIN_SIZE;
  }
  if (h < MIN_SIZE) {
    if (dir.includes('n')) y = o.y + o.h - MIN_SIZE;
    h = MIN_SIZE;
  }
  return { x: round(x), y: round(y), w: round(w), h: round(h) };
}

// Snaps a moving box to the slide's edges and centre and to other items' edges
// and centres. Returns the adjusted offset and the guide lines to draw.
function snap(bounds, dx, dy, targets, threshold) {
  const lines = { x: [], y: [] };
  const axis = (from, size, delta, list, key) => {
    const edges = [from + delta, from + delta + size / 2, from + delta + size];
    let best = null;
    for (const t of list) {
      for (const e of edges) {
        const d = t - e;
        if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best.d))) best = { d, t };
      }
    }
    if (!best) return delta;
    lines[key].push(best.t);
    return delta + best.d;
  };
  return {
    dx: axis(bounds.x, bounds.w, dx, targets.x, 'x'),
    dy: axis(bounds.y, bounds.h, dy, targets.y, 'y'),
    guides: lines,
  };
}

function boundsOf(boxes) {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
}

function useElementWidth(ref) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

function usePref(key, fallback) {
  const storageKey = `kanforge.slides.${key}`;
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

// ---- Slide panel (thumbnails) ----

function SlidePanel({ look, deck, readOnly, onSelect, onMove, a }) {
  const drag = useRef(null);
  const [over, setOver] = useState(null);
  const activeRef = useRef(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [deck.active]);

  return (
    <div className="slide-panel" role="listbox" aria-label="Slides" tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          onSelect(Math.max(0, Math.min(deck.slides.length - 1, deck.active + (e.key === 'ArrowDown' ? 1 : -1))));
        } else if ((e.key === 'Delete' || e.key === 'Backspace') && !readOnly) {
          e.preventDefault();
          a.deleteSlide();
        }
      }}>
      {deck.slides.map((slide, i) => (
        <div
          key={slide.id}
          ref={i === deck.active ? activeRef : undefined}
          className={`slide-thumb${i === deck.active ? ' active' : ''}${over === i ? ' drop-target' : ''}`}
          role="option"
          aria-selected={i === deck.active}
          aria-label={`Slide ${i + 1}`}
          draggable={!readOnly}
          onClick={() => onSelect(i)}
          onDragStart={(e) => {
            drag.current = i;
            e.dataTransfer.effectAllowed = 'move';
          }}
          onDragOver={(e) => {
            if (drag.current === null) return;
            e.preventDefault();
            setOver(i);
          }}
          onDragLeave={() => setOver((o) => (o === i ? null : o))}
          onDrop={(e) => {
            e.preventDefault();
            if (drag.current !== null && drag.current !== i) onMove(drag.current, i);
            drag.current = null;
            setOver(null);
          }}
          onDragEnd={() => {
            drag.current = null;
            setOver(null);
          }}
        >
          <span className="slide-thumb-num">{i + 1}</span>
          <SlideView deck={look} slide={slide} width={168} />
          {!readOnly && (
            <DropMenu title="Slide actions" buttonClass="slide-thumb-menu" icon={faEllipsisVertical} className="slide-thumb-actions"
              items={[
                { label: 'New slide after', onClick: () => { onSelect(i); a.newSlide('content'); } },
                { label: 'Duplicate slide', onClick: () => { onSelect(i); a.duplicateSlide(); } },
                { label: 'Move up', disabled: i === 0, onClick: () => onMove(i, i - 1) },
                { label: 'Move down', disabled: i === deck.slides.length - 1, onClick: () => onMove(i, i + 1) },
                'divider',
                { label: 'Delete slide', disabled: deck.slides.length < 2, onClick: () => { onSelect(i); a.deleteSlide(); } },
              ]} />
          )}
        </div>
      ))}
      {!readOnly && (
        <button type="button" className="slide-add" onClick={() => a.newSlide('content')}>
          <FontAwesomeIcon icon={faPlus} className="me-1" />New slide
        </button>
      )}
    </div>
  );
}

// ---- The editor ----

function SlideWorkspace({ sync }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { doc } = sync;
  const readOnly = Boolean(doc.trashedAt);

  const [deck, setDeckState] = useState(() => fromContent(doc.content));
  const deckRef = useRef(deck);
  const history = useRef({ past: [], future: [], lastKey: null });
  const [, setTick] = useState(0);
  const [selected, setSelectedState] = useState(EMPTY);
  const selectedRef = useRef(selected);
  const [editingId, setEditingState] = useState(null);
  const editingRef = useRef(null);
  const [preview, setPreviewState] = useState(null);
  const [present, setPresent] = useState(null);
  const [modal, setModal] = useState(null);
  const [folderTree, setFolderTree] = useState(null);
  const [showNotes, setShowNotes] = usePref('notes', true);
  const clip = useRef(null);
  const [, setClipTick] = useState(0);
  const surfaceRef = useRef(null);
  const stageRef = useRef(null);
  const fileInput = useRef(null);
  const stage = useElementWidth(stageRef);

  const { w: W, h: H } = slideSize(deck);
  const theme = themeOf(deck);
  const look = useMemo(() => ({ size: deck.size, theme: deck.theme }), [deck.size, deck.theme]);
  const si = deck.active;
  const slide = deck.slides[si];
  const width = Math.max(200, Math.min(stage.w - 48, ((stage.h - 48) * W) / H));
  const scale = width / W;

  const syncRef = useRef(sync);
  syncRef.current = sync;
  useEffect(() => {
    syncRef.current.setContentGetter(() => toContent(deckRef.current));
  }, []);

  useEffect(() => {
    officeApi.folders().then((data) => setFolderTree(buildTree(data.folders))).catch(() => {});
  }, []);

  const setDeck = useCallback((next) => {
    deckRef.current = next;
    setDeckState(next);
  }, []);

  const setSelected = useCallback((next) => {
    selectedRef.current = next;
    setSelectedState(next);
  }, []);

  // The text box being typed in, if any.
  const setEditing = useCallback((id) => {
    editingRef.current = id;
    setEditingState(id);
  }, []);
  const setEditingId = setEditing;

  const setPreview = useCallback((next) => setPreviewState(next), []);

  // Every change goes through here: remembered for undo, then saved.
  // Changes with the same `coalesce` key in a row (typing, nudging) undo as one.
  const commit = useCallback((next, coalesce = null) => {
    if (readOnly) return;
    const h = history.current;
    if (!coalesce || h.lastKey !== coalesce) {
      h.past.push(deckRef.current);
      if (h.past.length > MAX_HISTORY) h.past.shift();
    }
    h.lastKey = coalesce;
    h.future = [];
    setDeck(next);
    syncRef.current.markDirty();
    setTick((t) => t + 1);
  }, [readOnly, setDeck]);

  const keepSelection = useCallback((d) => {
    const ids = new Set(d.slides[d.active].elements.map((e) => e.id));
    setSelected(new Set([...selectedRef.current].filter((id) => ids.has(id))));
  }, [setSelected]);

  const undo = useCallback(() => {
    const h = history.current;
    if (!h.past.length) return;
    h.future.push(deckRef.current);
    const prev = h.past.pop();
    h.lastKey = null;
    setDeck(prev);
    setEditingId(null);
    keepSelection(prev);
    syncRef.current.markDirty();
    setTick((t) => t + 1);
  }, [setDeck, keepSelection]);

  const redo = useCallback(() => {
    const h = history.current;
    if (!h.future.length) return;
    h.past.push(deckRef.current);
    const next = h.future.pop();
    h.lastKey = null;
    setDeck(next);
    setEditingId(null);
    keepSelection(next);
    syncRef.current.markDirty();
    setTick((t) => t + 1);
  }, [setDeck, keepSelection]);

  const selectSlide = useCallback((i) => {
    const d = deckRef.current;
    if (i === d.active || i < 0 || i >= d.slides.length) return;
    setEditingId(null);
    setSelected(EMPTY);
    // Which slide is open is saved with the next change, but isn't an undo step.
    setDeck({ ...d, active: i });
  }, [setDeck, setSelected]);

  // ---- Elements ----

  const selectedEls = slide.elements.filter((el) => selected.has(el.id));
  const textEls = selectedEls.filter(hasText);
  const shapeEls = selectedEls.filter((el) => el.type === 'shape');
  const activeStyle = textEls[0]?.style ?? NO_STYLE;

  const addElements = useCallback((els, { edit = false } = {}) => {
    const d = deckRef.current;
    if (d.slides[d.active].elements.length + els.length > LIMITS.elements) {
      toast.error(`A slide can have up to ${LIMITS.elements} items.`);
      return;
    }
    commit(withSlide(d, d.active, (s) => ({ ...s, elements: [...s.elements, ...els] })));
    setSelected(new Set(els.map((e) => e.id)));
    setEditingId(edit && els.length === 1 ? els[0].id : null);
  }, [commit, setSelected, toast]);

  const updateSelected = useCallback((fn, coalesce) => {
    const ids = selectedRef.current;
    if (!ids.size) return;
    const d = deckRef.current;
    commit(withElements(d, d.active, ids, fn), coalesce);
  }, [commit]);

  const deleteSelection = useCallback(() => {
    const ids = selectedRef.current;
    if (!ids.size) return;
    const d = deckRef.current;
    commit(withSlide(d, d.active, (s) => ({ ...s, elements: s.elements.filter((el) => !ids.has(el.id)) })));
    setSelected(EMPTY);
    setEditingId(null);
  }, [commit, setSelected]);

  const copySelection = useCallback((cut = false) => {
    const ids = selectedRef.current;
    const d = deckRef.current;
    const els = d.slides[d.active].elements.filter((el) => ids.has(el.id));
    if (!els.length) return null;
    clip.current = els;
    setClipTick((t) => t + 1);
    if (cut) deleteSelection();
    return els;
  }, [deleteSelection]);

  const pasteElements = useCallback(() => {
    if (!clip.current?.length) return;
    // Pasting onto the same spot again steps the copies down and right.
    const d = deckRef.current;
    const taken = new Set(d.slides[d.active].elements.map((el) => `${el.x},${el.y}`));
    let offset = 0;
    while (clip.current.some((el) => taken.has(`${round(el.x + offset)},${round(el.y + offset)}`)) && offset < 400) offset += 20;
    addElements(clip.current.map((el) => cloneElement(el, offset, offset)));
  }, [addElements]);

  const stopEditing = useCallback(() => {
    const id = editingRef.current;
    if (!id) return;
    setEditing(null);
    // Like PowerPoint, an empty text box you added disappears when you click away.
    const d = deckRef.current;
    const el = d.slides[d.active].elements.find((e) => e.id === id);
    if (el && el.type === 'text' && !el.text && !el.ph) {
      commit(withSlide(d, d.active, (s) => ({ ...s, elements: s.elements.filter((e) => e.id !== id) })), `text:${id}`);
      setSelected(EMPTY);
    }
  }, [commit, setEditing, setSelected]);

  const startEditing = useCallback((el) => {
    if (readOnly || !hasText(el)) return;
    setSelected(new Set([el.id]));
    setEditing(el.id);
  }, [readOnly, setEditing, setSelected]);

  const insertImageFile = useCallback(async (file) => {
    try {
      const bmp = await createImageBitmap(file);
      const ratio = bmp.width / bmp.height || 1;
      const { imageId } = await uploadImageFile(file, W);
      const d = deckRef.current;
      const { w: SW, h: SH } = slideSize(d);
      let w = Math.min(SW * 0.6, bmp.width);
      let h = w / ratio;
      if (h > SH * 0.7) {
        h = SH * 0.7;
        w = h * ratio;
      }
      addElements([{ id: newId('e'), type: 'image', imageId, x: round((SW - w) / 2), y: round((SH - h) / 2), w: round(w), h: round(h), style: {} }]);
    } catch (err) {
      toast.error(errorMessage(err, err.message || 'Could not add that image'));
    }
  }, [W, addElements, toast]);

  // ---- Pointer: select, move, resize ----

  const toSlide = useCallback((e) => {
    const rect = surfaceRef.current.getBoundingClientRect();
    const s = rect.width / slideSize(deckRef.current).w;
    return { x: (e.clientX - rect.left) / s, y: (e.clientY - rect.top) / s, scale: s };
  }, []);

  const startDrag = useCallback((e, spec) => {
    const start = toSlide(e);
    const d = deckRef.current;
    const els = d.slides[d.active].elements;
    const origin = new Map(els.filter((el) => spec.ids.includes(el.id)).map((el) => [el.id, { x: el.x, y: el.y, w: el.w, h: el.h }]));
    if (!origin.size) return;
    const { w: SW, h: SH } = slideSize(d);
    const others = els.filter((el) => !origin.has(el.id));
    const targets = {
      x: [0, SW / 2, SW, ...others.flatMap((el) => [el.x, el.x + el.w / 2, el.x + el.w])],
      y: [0, SH / 2, SH, ...others.flatMap((el) => [el.y, el.y + el.h / 2, el.y + el.h])],
    };
    const bounds = boundsOf([...origin.values()]);
    let moved = false;
    let latest = null;

    const onMove = (ev) => {
      const p = toSlide(ev);
      let dx = p.x - start.x;
      let dy = p.y - start.y;
      if (!moved && Math.hypot(dx, dy) * start.scale < 3) return;
      moved = true;
      const boxes = {};
      let guides = null;
      if (spec.kind === 'move') {
        if (ev.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        if (!ev.altKey) {
          const snapped = snap(bounds, dx, dy, targets, SNAP_PX / start.scale);
          ({ dx, dy, guides } = snapped);
        }
        for (const [id, o] of origin) boxes[id] = { x: round(o.x + dx), y: round(o.y + dy), w: o.w, h: o.h };
      } else {
        const [id, o] = [...origin][0];
        boxes[id] = resizeBox(o, spec.dir, dx, dy, spec.keepRatio !== ev.shiftKey);
      }
      latest = boxes;
      setPreview({ boxes, guides });
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setPreview(null);
      if (moved && latest) {
        const ids = new Set(Object.keys(latest));
        const cur = deckRef.current;
        commit(withElements(cur, cur.active, ids, (el) => ({ ...el, ...latest[el.id] })));
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, [toSlide, setPreview, commit]);

  const onElementPointerDown = (e, el) => {
    if (readOnly || e.button !== 0 || editingId === el.id) return;
    e.stopPropagation();
    if (editingId) stopEditing();
    let sel = selectedRef.current;
    if (e.shiftKey) {
      sel = new Set(sel);
      if (sel.has(el.id)) sel.delete(el.id);
      else sel.add(el.id);
      setSelected(sel);
      return;
    }
    if (!sel.has(el.id)) {
      sel = new Set([el.id]);
      setSelected(sel);
    }
    stageRef.current?.focus({ preventScroll: true });
    startDrag(e, { kind: 'move', ids: [...sel] });
  };

  const onHandlePointerDown = (e, el, dir) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    startDrag(e, { kind: 'resize', ids: [el.id], dir, keepRatio: el.type === 'image' });
  };

  // ---- Actions (menus, toolbar, shortcuts) ----

  const createAndOpen = async (fields) => {
    try {
      const { document } = await officeApi.create({ kind: 'slides', folderId: doc.folderId, ...fields });
      navigate(`/office/slides/${document.id}`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const setStyle = (key, value) => updateSelected((el) => {
    if (!hasText(el)) return el;
    const style = { ...el.style };
    if (value === null || value === undefined) delete style[key];
    else style[key] = value;
    return { ...el, style };
  });

  const actions = {
    canUndo: history.current.past.length > 0,
    canRedo: history.current.future.length > 0,
    canPaste: Boolean(clip.current?.length),
    undo, redo,
    showNotes,
    toggleNotes: () => setShowNotes(!showNotes),
    newPresentation: () => createAndOpen({}),
    openOffice: () => navigate('/office'),
    copyDoc: async () => {
      try {
        await sync.save();
        const { document } = await officeApi.copy(doc.id);
        toast.success(`Created "${document.title}"`);
        navigate(`/office/slides/${document.id}`);
      } catch (err) {
        toast.error(errorMessage(err));
      }
    },
    downloadPptx: async () => {
      try {
        const { exportPptx } = await import('./exportPptx');
        downloadBlob(await exportPptx(deckRef.current, sync.title), `${safeFileName(sync.title)}.pptx`);
      } catch (err) {
        toast.error(errorMessage(err, 'Could not create the PowerPoint file'));
      }
    },
    downloadPdf: () => {
      toast.success('Choose "Save as PDF" in the print dialog.');
      setTimeout(() => printSlides(deckRef.current, sync.title), 300);
    },
    print: () => printSlides(deckRef.current, sync.title),
    move: async () => {
      try {
        const data = await officeApi.folders();
        setFolderTree(buildTree(data.folders));
        setModal({ type: 'move' });
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
    cut: () => copySelection(true),
    copy: () => copySelection(false),
    paste: pasteElements,
    duplicate: () => {
      const els = copySelection(false);
      if (els) addElements(els.map((el) => cloneElement(el, 20, 20)));
    },
    deleteSelection,
    selectAll: () => setSelected(new Set(slide.elements.map((el) => el.id))),
    present: (i) => setPresent(i),
    presentHere: () => setPresent(deckRef.current.active),
    newSlide: (layout) => {
      const d = deckRef.current;
      if (d.slides.length >= LIMITS.slides) {
        toast.error(`A presentation can have up to ${LIMITS.slides} slides.`);
        return;
      }
      const slides = d.slides.slice();
      slides.splice(d.active + 1, 0, makeSlide(layout, d.size));
      commit({ ...d, slides, active: d.active + 1 });
      setSelected(EMPTY);
      setEditingId(null);
    },
    duplicateSlide: () => {
      const d = deckRef.current;
      if (d.slides.length >= LIMITS.slides) {
        toast.error(`A presentation can have up to ${LIMITS.slides} slides.`);
        return;
      }
      const src = d.slides[d.active];
      const copy = { ...src, id: newId('s'), elements: src.elements.map((el) => cloneElement(el)) };
      const slides = d.slides.slice();
      slides.splice(d.active + 1, 0, copy);
      commit({ ...d, slides, active: d.active + 1 });
      setSelected(EMPTY);
    },
    deleteSlide: () => {
      const d = deckRef.current;
      if (d.slides.length < 2) return;
      const slides = d.slides.filter((_, i) => i !== d.active);
      commit({ ...d, slides, active: Math.min(d.active, slides.length - 1) });
      setSelected(EMPTY);
      setEditingId(null);
    },
    moveSlide: (delta) => {
      const d = deckRef.current;
      const to = d.active + delta;
      if (to < 0 || to >= d.slides.length) return;
      const slides = d.slides.slice();
      const [moved] = slides.splice(d.active, 1);
      slides.splice(to, 0, moved);
      commit({ ...d, slides, active: to });
    },
    backgroundColor: () => setModal({ type: 'background' }),
    setBackground: (color) => {
      const d = deckRef.current;
      commit(withSlide(d, d.active, (s) => ({ ...s, background: color })));
    },
    setTheme: (id) => commit({ ...deckRef.current, theme: id }),
    setSize: (id) => {
      const d = deckRef.current;
      if (d.size === id) return;
      // Like PowerPoint, content is scaled across to the new width.
      const k = SIZES[id].w / slideSize(d).w;
      commit({
        ...d,
        size: id,
        slides: d.slides.map((s) => ({ ...s, elements: s.elements.map((el) => ({ ...el, x: round(el.x * k), w: round(el.w * k) })) })),
      });
    },
    insertText: () => {
      const d = deckRef.current;
      const { w: SW, h: SH } = slideSize(d);
      addElements([{ id: newId('e'), type: 'text', x: round(SW / 2 - 150), y: round(SH / 2 - 30), w: 300, h: 60, text: '', style: { size: 18 } }], { edit: true });
    },
    insertShape: (shape) => {
      const d = deckRef.current;
      const { w: SW, h: SH } = slideSize(d);
      const [w, h] = shape === 'line' ? [240, 20] : shape === 'arrow' ? [200, 100] : [200, 120];
      addElements([{
        id: newId('e'), type: 'shape', shape, x: round((SW - w) / 2), y: round((SH - h) / 2), w, h,
        fill: null, stroke: null, strokeWidth: 0, text: '', style: {},
      }]);
    },
    insertImage: () => fileInput.current?.click(),
    toggle: (key) => {
      const all = textEls.length > 0 && textEls.every((el) => el.style?.[key]);
      setStyle(key, all ? null : true);
    },
    setStyle,
    growText: (dir) => updateSelected((el) => {
      if (!hasText(el)) return el;
      const size = el.style?.size ?? 18;
      const next = dir > 0 ? SIZE_STEPS.find((s) => s > size) ?? Math.min(200, size + 8) : [...SIZE_STEPS].reverse().find((s) => s < size) ?? Math.max(6, size - 2);
      return { ...el, style: { ...el.style, size: next } };
    }),
    setShape: (key, value) => updateSelected((el) => (el.type === 'shape' ? { ...el, [key]: value } : el)),
    arrange: (where) => {
      const ids = selectedRef.current;
      if (!ids.size) return;
      const d = deckRef.current;
      commit(withSlide(d, d.active, (s) => {
        const els = s.elements.slice();
        const picked = els.filter((el) => ids.has(el.id));
        const rest = els.filter((el) => !ids.has(el.id));
        if (where === 'front') return { ...s, elements: [...rest, ...picked] };
        if (where === 'back') return { ...s, elements: [...picked, ...rest] };
        // One step: swap each picked element with its neighbour.
        const order = where === 'forward' ? [...els.keys()].reverse() : [...els.keys()];
        for (const i of order) {
          const j = where === 'forward' ? i + 1 : i - 1;
          if (ids.has(els[i].id) && j >= 0 && j < els.length && !ids.has(els[j].id)) [els[i], els[j]] = [els[j], els[i]];
        }
        return { ...s, elements: els };
      }));
    },
  };
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  // ---- Keyboard ----

  useEffect(() => {
    const onKey = (e) => {
      const a = actionsRef.current;
      const inField = Boolean(e.target.closest?.('input, textarea, select, [contenteditable="true"]'));
      const editingText = e.target.classList?.contains('slide-edit');
      const mod = e.ctrlKey || e.metaKey;
      if (present !== null) return;

      if (e.key === 'F5') {
        e.preventDefault();
        a.present(e.shiftKey ? deckRef.current.active : 0);
        return;
      }
      if (mod && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 's') {
          e.preventDefault();
          syncRef.current.save();
        } else if (k === 'p') {
          e.preventDefault();
          a.print();
        } else if (readOnly) {
          // Nothing else changes a presentation in the trash.
        } else if (k === 'm') {
          e.preventDefault();
          a.newSlide('content');
        } else if ((k === 'b' || k === 'i' || k === 'u') && (editingText || !inField) && selectedRef.current.size) {
          e.preventDefault();
          a.toggle(k);
        } else if ((k === ']' || k === '[') && (editingText || !inField)) {
          e.preventDefault();
          a.growText(k === ']' ? 1 : -1);
        } else if (inField) {
          // Undo, select all and the clipboard work natively inside text fields.
        } else if (k === 'z') {
          e.preventDefault();
          if (e.shiftKey) a.redo();
          else a.undo();
        } else if (k === 'y') {
          e.preventDefault();
          a.redo();
        } else if (k === 'd') {
          e.preventDefault();
          a.duplicate();
        } else if (k === 'a') {
          e.preventDefault();
          a.selectAll();
        }
        return;
      }
      if (inField) {
        if (e.key === 'Escape' && editingText) {
          e.preventDefault();
          stopEditing();
          stageRef.current?.focus({ preventScroll: true });
        }
        return;
      }
      if (e.target.closest?.('.slide-panel, .dropdown-menu, .modal')) return;

      const sel = selectedRef.current;
      if (e.key === 'PageDown' || (!sel.size && (e.key === 'ArrowDown' || e.key === 'ArrowRight'))) {
        e.preventDefault();
        selectSlide(deckRef.current.active + 1);
      } else if (e.key === 'PageUp' || (!sel.size && (e.key === 'ArrowUp' || e.key === 'ArrowLeft'))) {
        e.preventDefault();
        selectSlide(deckRef.current.active - 1);
      } else if (readOnly) {
        // Moving around only.
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && sel.size) {
        e.preventDefault();
        deleteSelection();
      } else if (e.key.startsWith('Arrow') && sel.size) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        updateSelected((el) => ({ ...el, x: round(el.x + dx), y: round(el.y + dy) }), 'nudge');
      } else if ((e.key === 'Enter' || e.key === 'F2') && sel.size === 1) {
        const d = deckRef.current;
        const el = d.slides[d.active].elements.find((x) => sel.has(x.id));
        if (el && hasText(el)) {
          e.preventDefault();
          startEditing(el);
        }
      } else if (e.key === 'Escape') {
        setSelected(EMPTY);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [present, readOnly, selectSlide, deleteSelection, updateSelected, startEditing, stopEditing, setSelected]);

  // Clipboard: copy and cut items, paste items or an image from outside.
  useEffect(() => {
    const outsideFields = (e) => !e.target.closest?.('input, textarea, select, [contenteditable="true"]');
    const onCopy = (e) => {
      if (!outsideFields(e) || !selectedRef.current.size) return;
      const els = copySelection(e.type === 'cut' && !readOnly);
      if (!els) return;
      e.preventDefault();
      e.clipboardData.setData('text/plain', els.map((el) => el.text).filter(Boolean).join('\n'));
    };
    const onPaste = (e) => {
      if (readOnly || !outsideFields(e)) return;
      const image = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
      if (image) {
        e.preventDefault();
        insertImageFile(image);
      } else if (clip.current?.length) {
        e.preventDefault();
        pasteElements();
      }
    };
    window.addEventListener('copy', onCopy);
    window.addEventListener('cut', onCopy);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('copy', onCopy);
      window.removeEventListener('cut', onCopy);
      window.removeEventListener('paste', onPaste);
    };
  }, [copySelection, pasteElements, insertImageFile, readOnly]);

  // ---- Rendering ----

  const restore = async () => {
    try {
      await officeApi.restore(doc.id);
      await sync.takeLatest();
      toast.success('Presentation restored');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const onTextChange = (el, value) => {
    const d = deckRef.current;
    commit(withElements(d, d.active, new Set([el.id]), (x) => ({ ...x, text: value.slice(0, LIMITS.text) })), `text:${el.id}`);
  };

  const renderElement = (el, th) => {
    const box = preview?.boxes[el.id] ?? el;
    const shown = box === el ? el : { ...el, ...box };
    const isSelected = selected.has(el.id);
    const editing = editingId === el.id;
    return (
      <div
        key={el.id}
        className={`slide-el${readOnly ? '' : ' editable'}${isSelected ? ' selected' : ''}${editing ? ' editing' : ''}`}
        style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
        onPointerDown={(e) => onElementPointerDown(e, el)}
        onDoubleClick={() => startEditing(el)}
      >
        {editing ? (
          <>
            {el.type === 'shape' && <SlideElement el={{ ...shown, text: '' }} theme={th} />}
            <textarea
              className="slide-edit"
              style={textCss(el, th)}
              value={el.text}
              maxLength={LIMITS.text}
              placeholder={el.ph ? { title: 'Title', subtitle: 'Subtitle', body: 'Text' }[el.ph] : ''}
              aria-label="Text"
              autoFocus
              onFocus={(e) => e.target.setSelectionRange(e.target.value.length, e.target.value.length)}
              onChange={(e) => onTextChange(el, e.target.value)}
              onBlur={stopEditing}
              onPointerDown={(e) => e.stopPropagation()}
            />
          </>
        ) : <SlideElement el={shown} theme={th} placeholders={!readOnly} />}
      </div>
    );
  };

  const single = selectedEls.length === 1 && !editingId ? selectedEls[0] : null;
  const singleBox = single ? preview?.boxes[single.id] ?? single : null;
  const handleSize = 9 / scale;
  const folderPath = folderTree && doc.folderId && folderTree.byId.has(doc.folderId) ? folderTree.pathNames(doc.folderId).join(' / ') : null;

  return (
    <div className="doc-app slide-app">
      <div className="doc-chrome">
        <div className="doc-titlebar">
          <Link to="/office" className="doc-home slide-home" title="Back to Office" aria-label="Back to Office">
            <FontAwesomeIcon icon={faArrowLeft} className="d-sm-none" />
            <FontAwesomeIcon icon={faFilePowerpoint} className="d-none d-sm-inline" />
          </Link>
          <div className="min-w-0 flex-grow-1">
            <div className="d-flex align-items-center gap-2">
              <input className="doc-title" value={sync.title} placeholder="Untitled presentation" maxLength={200}
                readOnly={readOnly} onChange={(e) => sync.setTitle(e.target.value)} aria-label="Presentation title" />
              <span className={`small text-nowrap ${sync.status === 'error' || sync.status === 'conflict' ? 'text-danger fw-semibold' : 'text-muted'}`} role="status">
                {readOnly ? 'In the trash' : STATUS[sync.status]}
              </span>
              {sync.status === 'error' && <button type="button" className="btn btn-link btn-sm p-0" onClick={() => sync.save()}>Retry</button>}
              {folderPath && (
                <button type="button" className="doc-folder d-none d-md-inline-flex" onClick={actions.move} title="Move to another folder">
                  <FontAwesomeIcon icon={faFolder} className="me-1" />{folderPath}
                </button>
              )}
            </div>
            {!readOnly && (
              <SlideMenuBar a={actions} deck={deck} style={activeStyle} hasSelection={selectedEls.length > 0} hasText={textEls.length > 0} />
            )}
          </div>
        </div>
        {!readOnly && (
          <SlideToolbar a={actions} style={activeStyle} hasText={textEls.length > 0} hasShape={shapeEls.length > 0} themeFont={theme.font} />
        )}
        {sync.status === 'conflict' && (
          <div className="alert alert-warning d-flex flex-wrap align-items-center gap-2 m-2 py-2" role="alert">
            <FontAwesomeIcon icon={faCircleExclamation} />
            <span className="me-auto">This presentation was changed in another tab or device.</span>
            <button type="button" className="btn btn-sm btn-outline-dark" onClick={sync.takeLatest}>Use the latest version</button>
            <button type="button" className="btn btn-sm btn-dark" onClick={sync.keepMine}>Keep my version</button>
          </div>
        )}
        {readOnly && (
          <div className="alert alert-secondary d-flex align-items-center gap-2 m-2 py-2" role="alert">
            <span className="me-auto">This presentation is in the trash, so it can&apos;t be edited.</span>
            <button type="button" className="btn btn-sm btn-primary" onClick={restore}><FontAwesomeIcon icon={faRotateLeft} className="me-1" />Restore</button>
          </div>
        )}
      </div>

      <div className="slide-main">
        <SlidePanel look={look} deck={deck} readOnly={readOnly} onSelect={selectSlide} a={actions}
          onMove={(from, to) => {
            const d = deckRef.current;
            const slides = d.slides.slice();
            const [moved] = slides.splice(from, 1);
            slides.splice(to, 0, moved);
            commit({ ...d, slides, active: to });
          }} />

        <div className="slide-work">
          <div
            ref={stageRef}
            className="slide-stage"
            tabIndex={-1}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              if (editingId) stopEditing();
              setSelected(EMPTY);
            }}
            onDragOver={(e) => {
              if (!readOnly && [...e.dataTransfer.items].some((i) => i.kind === 'file')) e.preventDefault();
            }}
            onDrop={(e) => {
              const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'));
              if (readOnly || !file) return;
              e.preventDefault();
              insertImageFile(file);
            }}
          >
            {stage.w > 0 && (
              <div className="slide-canvas" ref={surfaceRef} style={{ width, height: H * scale }}>
                <SlideView deck={look} slide={slide} width={width} renderElement={renderElement} className="slide-canvas-frame">
                  {selectedEls.filter((el) => !editingId || el.id !== editingId).map((el) => {
                    const b = preview?.boxes[el.id] ?? el;
                    return <div key={`o-${el.id}`} className="slide-outline" style={{ left: b.x, top: b.y, width: b.w, height: b.h, borderWidth: 1.5 / scale }} />;
                  })}
                  {single && !readOnly && HANDLES.map((dir) => {
                    const x = dir.includes('w') ? singleBox.x : dir.includes('e') ? singleBox.x + singleBox.w : singleBox.x + singleBox.w / 2;
                    const y = dir.includes('n') ? singleBox.y : dir.includes('s') ? singleBox.y + singleBox.h : singleBox.y + singleBox.h / 2;
                    return (
                      <div key={dir} className={`slide-handle h-${dir}`} onPointerDown={(e) => onHandlePointerDown(e, single, dir)}
                        style={{ left: x - handleSize / 2, top: y - handleSize / 2, width: handleSize, height: handleSize, borderWidth: 1.5 / scale }} />
                    );
                  })}
                  {preview?.guides?.x.map((x) => <div key={`gx${x}`} className="slide-guide v" style={{ left: x, width: 1 / scale }} />)}
                  {preview?.guides?.y.map((y) => <div key={`gy${y}`} className="slide-guide h" style={{ top: y, height: 1 / scale }} />)}
                </SlideView>
              </div>
            )}
          </div>
          {showNotes && (
            <div className="slide-notes">
              <textarea
                value={slide.notes}
                readOnly={readOnly}
                maxLength={LIMITS.notes}
                placeholder="Click to add speaker notes"
                aria-label="Speaker notes"
                onChange={(e) => {
                  const d = deckRef.current;
                  commit(withSlide(d, d.active, (s) => ({ ...s, notes: e.target.value })), `notes:${slide.id}`);
                }}
              />
            </div>
          )}
        </div>
      </div>

      <div className="doc-statusbar">
        <span className="text-truncate">Slide {si + 1} of {deck.slides.length}</span>
        <span className="d-none d-sm-inline text-muted">{theme.label}</span>
        <span className="ms-auto d-flex align-items-center gap-2">
          <button type="button" className={`doc-zoom-btn slide-notes-btn${showNotes ? ' active' : ''}`} onClick={() => setShowNotes(!showNotes)}
            aria-pressed={showNotes} title="Speaker notes">
            <FontAwesomeIcon icon={faNoteSticky} className="me-1" />Notes
          </button>
          <button type="button" className="doc-zoom-btn" onClick={() => setPresent(si)} title="Present from this slide (Shift+F5)">
            <FontAwesomeIcon icon={faPlay} className="me-1" />Present
          </button>
        </span>
      </div>

      <input ref={fileInput} type="file" className="d-none" accept="image/png,image/jpeg,image/gif,image/webp"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) insertImageFile(file);
        }} />

      {present !== null && <Present deck={deck} start={present} onClose={() => setPresent(null)} />}
      {modal?.type === 'background' && (
        <Modal title="Slide background" onClose={() => setModal(null)}>
          <ColorGrid close={() => setModal(null)} resetLabel="Theme background" onPick={(c) => actions.setBackground(c)} />
        </Modal>
      )}
      {modal?.type === 'move' && folderTree && (
        <MoveToFolderModal
          tree={folderTree}
          title="Move presentation to…"
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

export default function SlideEditor() {
  const { docId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const onError = useCallback((err, when) => {
    toast.error(errorMessage(err, when === 'load' ? 'Could not open the presentation' : 'Could not save the presentation'));
    if (when === 'load') navigate('/office', { replace: true });
  }, [toast, navigate]);
  const sync = useDocumentSync(docId, { onError });

  if (!sync.doc || !sync.settings) return <Spinner fullscreen />;
  if (sync.doc.kind !== 'slides') return <Navigate to={`/office/${sync.doc.kind === 'sheet' ? 'sheets' : 'docs'}/${docId}`} replace />;
  return <SlideWorkspace key={`${docId}:${sync.loadKey}`} sync={sync} />;
}
