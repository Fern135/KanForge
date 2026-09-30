import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faFilePowerpoint, faFolder, faCircleExclamation, faRotateLeft, faArrowLeft, faEllipsisVertical, faPlay, faNoteSticky,
  faPlus, faMinus, faLock, faEyeSlash, faTableCells, faSquare,
} from '@fortawesome/free-solid-svg-icons';
import { officeApi } from '../api';
import useDocumentSync from '../useDocumentSync';
import { uploadImageFile } from '../docs/images';
import { DropMenu } from '../docs/ui';
import SlideView, { SlideElement, boxStyle } from './SlideView';
import SlideMenuBar from './SlideMenuBar';
import SlideToolbar from './SlideToolbar';
import Present from './Present';
import {
  ChartDataModal, IconPicker, LinkModal, FooterModal, BackgroundModal,
} from './SlideModals';
import { printSlides } from './printSlides';
import {
  fromContent, toContent, makeSlide, makeTable, makeChart, newId, slideSize, themeOf, textCss, groupIds, animated,
  LIMITS, SIZES,
} from './model';
import MoveToFolderModal from '../../../core/components/folders/MoveToFolderModal';
import { buildTree } from '../../../core/components/folders/tree';
import Spinner from '../../../core/components/Spinner';
import { errorMessage } from '../../../core/api/client';
import { useToast } from '../../../core/context/ToastContext';
import { useWorkspace } from '../../../core/context/WorkspaceContext';
import ViewOnlyNotice from '../../../core/components/ViewOnlyNotice';
import { downloadBlob } from '../../../core/utils/download';
import '../docs/docs.scss';
import './slides.scss';

const STATUS = { saved: 'Saved', unsaved: 'Editing…', saving: 'Saving…', error: 'Not saved', conflict: 'Not saved' };
const safeFileName = (title) => (title || 'Untitled presentation').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim().slice(0, 100) || 'Untitled presentation';
const MAX_HISTORY = 100;
const SIZE_STEPS = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 72, 80, 96];
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const MIN_SIZE = 8;
const SNAP_PX = 6;
const EMPTY = new Set();
const NO_STYLE = Object.freeze({});

const round = (n) => Math.round(n * 10) / 10;
const rad = (deg) => (deg * Math.PI) / 180;
const rotate = (x, y, deg) => {
  const a = rad(deg);
  return { x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) };
};
// Items whose text can be edited in place, and items with a text style.
const typesIn = (el) => el.type === 'text' || (el.type === 'shape' && el.shape !== 'line');
const hasStyle = (el) => typesIn(el) || el.type === 'table' || el.type === 'chart';

// ---- Pure deck edits ----

function withSlide(deck, index, fn) {
  const slides = deck.slides.slice();
  slides[index] = fn(slides[index]);
  return { ...deck, slides };
}

function withElements(deck, index, ids, fn) {
  return withSlide(deck, index, (s) => ({ ...s, elements: s.elements.map((el) => (ids.has(el.id) ? fn(el) : el)) }));
}

// Copies with new ids. Copied groups stay grouped, as new groups.
function cloneElements(els, dx = 0, dy = 0) {
  const groups = new Map();
  return els.map((el) => {
    const copy = { ...el, id: newId('e'), x: round(el.x + dx), y: round(el.y + dy), style: { ...el.style } };
    if (el.group) {
      if (!groups.has(el.group)) groups.set(el.group, newId('g'));
      copy.group = groups.get(el.group);
    }
    if (el.cells) copy.cells = el.cells.map((r) => [...r]);
    if (el.series) copy.series = el.series.map((s) => ({ ...s, values: [...s.values] }));
    return copy;
  });
}

// Resizes in the item's own (unrotated) frame, then moves it so the opposite
// edge stays where it was on the slide.
function resizeBox(o, dir, dx, dy, keepRatio, rotation = 0) {
  const d = rotate(dx, dy, -rotation);
  let { x, y, w, h } = o;
  if (dir.includes('e')) w = o.w + d.x;
  if (dir.includes('s')) h = o.h + d.y;
  if (dir.includes('w')) { w = o.w - d.x; x = o.x + d.x; }
  if (dir.includes('n')) { h = o.h - d.y; y = o.y + d.y; }
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
  if (rotation) {
    // The centre moved by this much in the item's frame; turn that onto the slide.
    const c = rotate(x + w / 2 - (o.x + o.w / 2), y + h / 2 - (o.y + o.h / 2), rotation);
    x = o.x + o.w / 2 + c.x - w / 2;
    y = o.y + o.h / 2 + c.y - h / 2;
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
  return { dx: axis(bounds.x, bounds.w, dx, targets.x, 'x'), dy: axis(bounds.y, bounds.h, dy, targets.y, 'y'), guides: lines };
}

function boundsOf(boxes) {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
}

// Table rows and columns, added or removed around the cell being edited.
function tableEdit(el, op, at) {
  const cells = el.cells.map((r) => [...r]);
  const r = Math.min(at?.r ?? el.rows - 1, el.rows - 1);
  const c = Math.min(at?.c ?? el.cols - 1, el.cols - 1);
  const blankRow = () => Array.from({ length: el.cols }, () => '');
  switch (op) {
    case 'rowAbove':
    case 'rowBelow':
      if (el.rows >= LIMITS.tableRows) return el;
      cells.splice(op === 'rowAbove' ? r : r + 1, 0, blankRow());
      return { ...el, cells, rows: el.rows + 1, h: round(el.h + el.h / el.rows) };
    case 'colLeft':
    case 'colRight':
      if (el.cols >= LIMITS.tableCols) return el;
      cells.forEach((row) => row.splice(op === 'colLeft' ? c : c + 1, 0, ''));
      return { ...el, cells, cols: el.cols + 1 };
    case 'deleteRow':
      if (el.rows < 2) return el;
      cells.splice(r, 1);
      return { ...el, cells, rows: el.rows - 1, h: round(el.h - el.h / el.rows) };
    case 'deleteCol':
      if (el.cols < 2) return el;
      cells.forEach((row) => row.splice(c, 1));
      return { ...el, cells, cols: el.cols - 1 };
    case 'header':
      return { ...el, header: !el.header };
    default:
      return el;
  }
}

// The element's size. `key` re-attaches when the element is replaced (switching views).
function useElementSize(ref, key) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, key]);
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

// ---- Slide thumbnails: the side panel and the slide sorter ----

function Thumbnails({ look, deck, readOnly, width, onSelect, onOpen, onMove, a, className }) {
  const drag = useRef(null);
  const [over, setOver] = useState(null);
  const activeRef = useRef(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [deck.active]);

  return (
    <div className={className} role="listbox" aria-label="Slides" tabIndex={0}
      onKeyDown={(e) => {
        const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
        if (step) {
          e.preventDefault();
          onSelect(Math.max(0, Math.min(deck.slides.length - 1, deck.active + step)));
        } else if ((e.key === 'Delete' || e.key === 'Backspace') && !readOnly) {
          e.preventDefault();
          a.deleteSlide();
        } else if (e.key === 'Enter' && onOpen) {
          e.preventDefault();
          onOpen(deck.active);
        }
      }}>
      {deck.slides.map((slide, i) => (
        <div
          key={slide.id}
          ref={i === deck.active ? activeRef : undefined}
          className={`slide-thumb${i === deck.active ? ' active' : ''}${over === i ? ' drop-target' : ''}${slide.hidden ? ' is-hidden' : ''}`}
          role="option"
          aria-selected={i === deck.active}
          aria-label={`Slide ${i + 1}${slide.hidden ? ' (hidden)' : ''}`}
          draggable={!readOnly}
          onClick={() => onSelect(i)}
          onDoubleClick={() => onOpen?.(i)}
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
          <span className="slide-thumb-num">
            {i + 1}
            {slide.hidden && <FontAwesomeIcon icon={faEyeSlash} className="d-block mt-1" title="Hidden in the slide show" />}
          </span>
          <SlideView deck={look} slide={slide} index={i} width={width} />
          {!readOnly && (
            <DropMenu title="Slide actions" buttonClass="slide-thumb-menu" icon={faEllipsisVertical} className="slide-thumb-actions"
              items={[
                { label: 'New slide after', onClick: () => { onSelect(i); a.newSlide('content'); } },
                { label: 'Duplicate slide', onClick: () => { onSelect(i); a.duplicateSlide(); } },
                { label: slide.hidden ? 'Show slide' : 'Hide slide', onClick: () => { onSelect(i); a.toggleHidden(); } },
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

// Editing a table's cells in place. Tab and Shift+Tab move between cells.
function TableEditor({ el, theme, onChange, onCell }) {
  const refs = useRef([]);
  const css = textCss({ ...el, type: 'text' }, theme);
  const border = el.border === 'none' ? 'transparent' : el.border ?? (theme.dark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.22)');
  const headerFill = el.headerFill === 'none' ? 'transparent' : el.headerFill ?? theme.accent;
  useEffect(() => {
    refs.current[0]?.focus();
  }, []);
  return (
    <table className="slide-table editing" style={{ fontFamily: css.fontFamily, fontSize: css.fontSize, color: css.color }}>
      <tbody>
        {el.cells.map((row, r) => (
          <tr key={r} style={{ height: `${100 / el.rows}%` }}>
            {row.map((cell, c) => {
              const head = el.header && r === 0;
              const i = r * el.cols + c;
              return (
                <td key={c} style={{ borderColor: border, background: head ? headerFill : el.fill && el.fill !== 'none' ? el.fill : 'transparent' }}>
                  <textarea
                    ref={(n) => { refs.current[i] = n; }}
                    className="slide-cell-edit"
                    value={cell}
                    maxLength={LIMITS.cell}
                    aria-label={`Row ${r + 1}, column ${c + 1}`}
                    style={{ color: head && !el.style?.color && el.headerFill !== 'none' ? '#ffffff' : 'inherit', fontWeight: head ? 700 : 'inherit', textAlign: el.style?.align ?? 'left' }}
                    onFocus={() => onCell({ r, c })}
                    onChange={(e) => onChange(r, c, e.target.value)}
                    onPointerDown={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key !== 'Tab') return;
                      e.preventDefault();
                      const next = refs.current[i + (e.shiftKey ? -1 : 1)];
                      next?.focus();
                    }}
                  />
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---- The editor ----

function SlideWorkspace({ sync }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { doc } = sync;
  const trashed = Boolean(doc.trashedAt);
  // View-only access (set by a platform admin) reads like the trash: nothing changes.
  const viewOnly = !useWorkspace().canEdit('office');
  const readOnly = trashed || viewOnly;

  const [deck, setDeckState] = useState(() => fromContent(doc.content));
  const deckRef = useRef(deck);
  const history = useRef({ past: [], future: [], lastKey: null });
  const [, setTick] = useState(0);
  const [selected, setSelectedState] = useState(EMPTY);
  const selectedRef = useRef(selected);
  const [editingId, setEditingState] = useState(null);
  const editingRef = useRef(null);
  const tableCell = useRef(null);
  const [preview, setPreview] = useState(null);
  const [present, setPresent] = useState(null);
  const [modal, setModal] = useState(null);
  const [folderTree, setFolderTree] = useState(null);
  const [showNotes, setShowNotes] = usePref('notes', true);
  const [view, setView] = useState('normal');
  const [zoom, setZoom] = useState(1);
  const clip = useRef(null);
  const [, setClipTick] = useState(0);
  const surfaceRef = useRef(null);
  const stageRef = useRef(null);
  const fileInput = useRef(null);
  const pptxInput = useRef(null);
  const pictureFor = useRef(null);
  const stage = useElementSize(stageRef, view);

  const { w: W, h: H } = slideSize(deck);
  const theme = themeOf(deck);
  const look = useMemo(() => ({ size: deck.size, theme: deck.theme, footer: deck.footer }), [deck.size, deck.theme, deck.footer]);
  const si = deck.active;
  const slide = deck.slides[si];
  const fit = Math.max(200, Math.min(stage.w - 48, ((stage.h - 48) * W) / H));
  const width = fit * zoom;
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

  const setEditing = useCallback((id) => {
    editingRef.current = id;
    tableCell.current = null;
    setEditingState(id);
  }, []);

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

  const travel = useCallback((from, to) => {
    const h = history.current;
    if (!h[from].length) return;
    h[to].push(deckRef.current);
    const next = h[from].pop();
    h.lastKey = null;
    setDeck(next);
    setEditing(null);
    keepSelection(next);
    syncRef.current.markDirty();
    setTick((t) => t + 1);
  }, [setDeck, setEditing, keepSelection]);
  const undo = useCallback(() => travel('past', 'future'), [travel]);
  const redo = useCallback(() => travel('future', 'past'), [travel]);

  const selectSlide = useCallback((i) => {
    const d = deckRef.current;
    if (i === d.active || i < 0 || i >= d.slides.length) return;
    setEditing(null);
    setSelected(EMPTY);
    // Which slide is open is saved with the next change, but isn't an undo step.
    setDeck({ ...d, active: i });
  }, [setDeck, setEditing, setSelected]);

  // ---- Selection summary (drives the menus and toolbar) ----

  const selectedEls = slide.elements.filter((el) => selected.has(el.id));
  const styled = selectedEls.filter(hasStyle);
  const first = selectedEls[0];
  const sel = {
    count: selectedEls.length,
    any: selectedEls.length > 0,
    many: selectedEls.length > 1,
    text: styled.length > 0,
    style: styled[0]?.style ?? NO_STYLE,
    fillable: selectedEls.some((el) => el.type === 'shape' || el.type === 'icon' || el.type === 'table' || el.type === 'text'),
    table: selectedEls.length === 1 && first.type === 'table',
    header: first?.type === 'table' && first.header,
    image: selectedEls.some((el) => el.type === 'image'),
    opacity: first?.opacity,
    shadow: Boolean(first?.shadow),
    radius: selectedEls.find((el) => el.type === 'image')?.radius,
    anim: first?.anim,
    locked: selectedEls.length > 0 && selectedEls.every((el) => el.locked),
    grouped: selectedEls.some((el) => el.group),
  };

  // ---- Elements ----

  const addElements = useCallback((els, { edit = false } = {}) => {
    const d = deckRef.current;
    if (d.slides[d.active].elements.length + els.length > LIMITS.elements) {
      toast.error(`A slide can have up to ${LIMITS.elements} items.`);
      return;
    }
    commit(withSlide(d, d.active, (s) => ({ ...s, elements: [...s.elements, ...els] })));
    setSelected(new Set(els.map((e) => e.id)));
    setEditing(edit && els.length === 1 ? els[0].id : null);
  }, [commit, setEditing, setSelected, toast]);

  const updateSelected = useCallback((fn, coalesce) => {
    const ids = selectedRef.current;
    if (!ids.size) return;
    const d = deckRef.current;
    commit(withElements(d, d.active, ids, fn), coalesce);
  }, [commit]);

  const deleteSelection = useCallback(() => {
    const d = deckRef.current;
    const ids = new Set([...selectedRef.current].filter((id) => !d.slides[d.active].elements.find((e) => e.id === id)?.locked));
    if (!ids.size) return;
    commit(withSlide(d, d.active, (s) => ({ ...s, elements: s.elements.filter((el) => !ids.has(el.id)) })));
    setSelected(EMPTY);
    setEditing(null);
  }, [commit, setEditing, setSelected]);

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
    addElements(cloneElements(clip.current, offset, offset).map(({ locked, ...el }) => el));
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

  const openItem = useCallback((el) => {
    if (readOnly || el.locked) return;
    setSelected(new Set([el.id]));
    if (typesIn(el) && el.ph !== 'picture') setEditing(el.id);
    else if (el.type === 'table') setEditing(el.id);
    else if (el.type === 'chart') setModal({ type: 'chart', id: el.id });
    else if (el.type === 'icon') setModal({ type: 'icon', id: el.id });
    else if (el.ph === 'picture') {
      pictureFor.current = el.id;
      fileInput.current?.click();
    }
  }, [readOnly, setEditing, setSelected]);

  const insertImageFile = useCallback(async (file) => {
    const target = pictureFor.current;
    pictureFor.current = null;
    try {
      const bmp = await createImageBitmap(file);
      const ratio = bmp.width / bmp.height || 1;
      const { imageId } = await uploadImageFile(file, W);
      const d = deckRef.current;
      const { w: SW, h: SH } = slideSize(d);
      const holder = target && d.slides[d.active].elements.find((e) => e.id === target);
      // Into a picture placeholder: fit inside it. Otherwise: centred, at most 60% of the slide.
      const area = holder ?? { x: SW * 0.2, y: SH * 0.15, w: SW * 0.6, h: SH * 0.7 };
      let w = holder ? area.w : Math.min(area.w, bmp.width);
      let h = w / ratio;
      if (h > area.h) {
        h = area.h;
        w = h * ratio;
      }
      const image = {
        id: newId('e'), type: 'image', imageId, x: round(area.x + (area.w - w) / 2), y: round(area.y + (area.h - h) / 2), w: round(w), h: round(h), style: {},
      };
      if (holder) {
        commit(withSlide(d, d.active, (s) => ({ ...s, elements: s.elements.map((e) => (e.id === holder.id ? image : e)) })));
        setSelected(new Set([image.id]));
      } else addElements([image]);
    } catch (err) {
      toast.error(errorMessage(err, err.message || 'Could not add that image'));
    }
  }, [W, addElements, commit, setSelected, toast]);

  // ---- Pointer: select, move, resize, rotate ----

  const toSlide = useCallback((e) => {
    const rect = surfaceRef.current.getBoundingClientRect();
    const s = rect.width / slideSize(deckRef.current).w;
    return { x: (e.clientX - rect.left) / s, y: (e.clientY - rect.top) / s, scale: s };
  }, []);

  const startDrag = useCallback((e, spec) => {
    const start = toSlide(e);
    const d = deckRef.current;
    const els = d.slides[d.active].elements;
    const origin = new Map(els.filter((el) => spec.ids.includes(el.id)).map((el) => [el.id, el]));
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
        if (!ev.altKey) ({ dx, dy, guides } = snap(bounds, dx, dy, targets, SNAP_PX / start.scale));
        for (const [id, o] of origin) boxes[id] = { x: round(o.x + dx), y: round(o.y + dy) };
      } else if (spec.kind === 'resize') {
        const [id, o] = [...origin][0];
        boxes[id] = resizeBox(o, spec.dir, dx, dy, spec.keepRatio !== ev.shiftKey, o.rotation ?? 0);
      } else {
        const [id, o] = [...origin][0];
        const cx = o.x + o.w / 2;
        const cy = o.y + o.h / 2;
        let deg = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI + 90;
        if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
        else if (Math.abs(((deg % 90) + 90) % 90) < 3 || Math.abs(((deg % 90) + 90) % 90) > 87) deg = Math.round(deg / 90) * 90;
        boxes[id] = { rotation: round(((deg % 360) + 360) % 360) };
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
        commit(withElements(cur, cur.active, ids, (el) => {
          const next = { ...el, ...latest[el.id] };
          if (next.rotation === 0) delete next.rotation;
          return next;
        }));
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, [toSlide, commit]);

  const onElementPointerDown = (e, el) => {
    if (readOnly || e.button !== 0 || editingId === el.id) return;
    e.stopPropagation();
    if (editingId) stopEditing();
    const els = deckRef.current.slides[deckRef.current.active].elements;
    let sel = selectedRef.current;
    const withGroup = groupIds(els, new Set([el.id]));
    if (e.shiftKey) {
      sel = new Set(sel);
      const adding = !sel.has(el.id);
      withGroup.forEach((id) => (adding ? sel.add(id) : sel.delete(id)));
      setSelected(sel);
      return;
    }
    if (!sel.has(el.id)) {
      sel = withGroup;
      setSelected(sel);
    }
    stageRef.current?.focus({ preventScroll: true });
    const movable = [...sel].filter((id) => !els.find((x) => x.id === id)?.locked);
    if (movable.length) startDrag(e, { kind: 'move', ids: movable });
  };

  const onHandlePointerDown = (e, el, dir) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    startDrag(e, dir === 'rotate'
      ? { kind: 'rotate', ids: [el.id] }
      : { kind: 'resize', ids: [el.id], dir, keepRatio: el.type === 'image' || el.type === 'icon' });
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
    if (!hasStyle(el)) return el;
    const style = { ...el.style };
    if (value === null || value === undefined) delete style[key];
    else style[key] = value;
    return { ...el, style };
  });

  const setProp = (key, value, onlyType) => updateSelected((el) => {
    if (onlyType && el.type !== onlyType) return el;
    const next = { ...el };
    if (value === undefined || value === null) delete next[key];
    else next[key] = value;
    return next;
  });

  const insertCentered = (el, w, h, opts) => {
    const d = deckRef.current;
    const { w: SW, h: SH } = slideSize(d);
    addElements([{ id: newId('e'), x: round((SW - w) / 2), y: round((SH - h) / 2), w, h, style: {}, ...el }], opts);
  };

  const actions = {
    canUndo: history.current.past.length > 0,
    canRedo: history.current.future.length > 0,
    canPaste: Boolean(clip.current?.length),
    undo, redo, view, showNotes, zoom,
    setView: (v) => {
      setEditing(null);
      setView(v);
    },
    setZoom,
    zoomBy: (dir) => setZoom((z) => (dir > 0 ? ZOOMS.find((s) => s > z + 0.01) ?? z : [...ZOOMS].reverse().find((s) => s < z - 0.01) ?? z)),
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
    importPptx: () => pptxInput.current?.click(),
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
      if (els) addElements(cloneElements(els, 20, 20).map(({ locked, ...el }) => el));
    },
    deleteSelection,
    selectAll: () => setSelected(new Set(slide.elements.map((el) => el.id))),
    present: (i, presenter = false) => setPresent({ start: i, presenter }),
    presentHere: () => setPresent({ start: deckRef.current.active, presenter: false }),
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
      setEditing(null);
    },
    duplicateSlide: () => {
      const d = deckRef.current;
      if (d.slides.length >= LIMITS.slides) {
        toast.error(`A presentation can have up to ${LIMITS.slides} slides.`);
        return;
      }
      const src = d.slides[d.active];
      const copy = { ...src, id: newId('s'), elements: cloneElements(src.elements) };
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
      setEditing(null);
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
    toggleHidden: () => {
      const d = deckRef.current;
      commit(withSlide(d, d.active, (s) => {
        const { hidden, ...rest } = s;
        return hidden ? rest : { ...rest, hidden: true };
      }));
    },
    setTransition: (t) => {
      const d = deckRef.current;
      commit(withSlide(d, d.active, (s) => ({ ...s, transition: t })));
    },
    transitionToAll: () => {
      const d = deckRef.current;
      const t = d.slides[d.active].transition ?? 'none';
      commit({ ...d, slides: d.slides.map((s) => ({ ...s, transition: t })) });
      toast.success('Transition applied to every slide');
    },
    backgroundColor: () => setModal({ type: 'background' }),
    resetBackground: () => {
      const d = deckRef.current;
      commit(withSlide(d, d.active, (s) => ({ ...s, background: null, background2: null })));
    },
    editFooter: () => setModal({ type: 'footer' }),
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
    insertText: () => insertCentered({ type: 'text', text: '', style: { size: 18 } }, 300, 60, { edit: true }),
    insertShape: (shape) => {
      const [w, h] = shape === 'line' ? [240, 20] : ['arrow', 'leftRightArrow', 'chevron'].includes(shape) ? [200, 100] : shape === 'downArrow' ? [100, 200] : [200, shape === 'rect' || shape === 'roundRect' || shape === 'callout' ? 120 : 200];
      insertCentered({ type: 'shape', shape, fill: null, stroke: null, strokeWidth: 0, text: '' }, w, h);
    },
    insertImage: () => fileInput.current?.click(),
    insertTable: (rows, cols) => insertCentered({ ...makeTable(rows, cols) }, Math.min(W - 80, cols * 140), Math.min(H - 80, rows * 44)),
    insertChart: (chart) => insertCentered({ ...makeChart(chart) }, 520, 320),
    insertIcon: () => setModal({ type: 'icon' }),
    editLink: () => sel.any && setModal({ type: 'link' }),
    toggle: (key) => {
      const all = styled.length > 0 && styled.every((el) => el.style?.[key]);
      setStyle(key, all ? null : true);
    },
    setStyle,
    setProp,
    growText: (dir) => updateSelected((el) => {
      if (!hasStyle(el)) return el;
      const size = el.style?.size ?? 18;
      const next = dir > 0 ? SIZE_STEPS.find((s) => s > size) ?? Math.min(200, size + 8) : [...SIZE_STEPS].reverse().find((s) => s < size) ?? Math.max(6, size - 2);
      return { ...el, style: { ...el.style, size: next } };
    }),
    // Fill: a shape's fill, an icon's colour, a table's cells, a text box's background (as highlight).
    setFill: (value) => updateSelected((el) => {
      if (el.type === 'shape') return { ...el, fill: value };
      if (el.type === 'icon') return { ...el, color: value === 'none' ? null : value };
      if (el.type === 'table') return { ...el, fill: value };
      if (el.type === 'text') {
        const style = { ...el.style };
        if (value && value !== 'none') style.highlight = value;
        else delete style.highlight;
        return { ...el, style };
      }
      return el;
    }),
    setOutline: (value, width) => updateSelected((el) => {
      if (el.type === 'shape') return { ...el, ...(value !== undefined ? { stroke: value } : {}), ...(width ? { strokeWidth: width, stroke: el.stroke === 'none' || value === 'none' ? null : el.stroke } : {}) };
      if (el.type === 'table' && value !== undefined) return { ...el, border: value };
      return el;
    }),
    rotateBy: (deg) => updateSelected((el) => {
      const r = ((((el.rotation ?? 0) + deg) % 360) + 360) % 360;
      const { rotation, ...rest } = el;
      return r ? { ...rest, rotation: r } : rest;
    }),
    flip: (key) => updateSelected((el) => {
      const { [key]: on, ...rest } = el;
      return on ? rest : { ...rest, [key]: true };
    }),
    setAnimation: (anim) => {
      const d = deckRef.current;
      let order = Math.max(0, ...animated(d.slides[d.active]).map((e) => e.animOrder ?? 0));
      updateSelected((el) => {
        const { anim: a0, animOrder, ...rest } = el;
        if (!anim) return rest;
        order += 1;
        return { ...rest, anim, animOrder: el.anim ? animOrder : order };
      });
    },
    tableOp: (op) => updateSelected((el) => (el.type === 'table' ? tableEdit(el, op, tableCell.current) : el)),
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
    // Several items line up with each other; one lines up with the slide.
    align: (edge) => {
      const els = selectedEls.filter((el) => !el.locked);
      if (!els.length) return;
      const b = els.length > 1 ? boundsOf(els) : { x: 0, y: 0, w: W, h: H };
      updateSelected((el) => {
        if (el.locked) return el;
        switch (edge) {
          case 'left': return { ...el, x: round(b.x) };
          case 'center': return { ...el, x: round(b.x + b.w / 2 - el.w / 2) };
          case 'right': return { ...el, x: round(b.x + b.w - el.w) };
          case 'top': return { ...el, y: round(b.y) };
          case 'middle': return { ...el, y: round(b.y + b.h / 2 - el.h / 2) };
          default: return { ...el, y: round(b.y + b.h - el.h) };
        }
      });
    },
    // Equal gaps between items, keeping the first and last where they are.
    distribute: (axis) => {
      const els = selectedEls.filter((el) => !el.locked);
      if (els.length < 3) return;
      const [pos, len] = axis === 'x' ? ['x', 'w'] : ['y', 'h'];
      const sorted = [...els].sort((p, q) => p[pos] - q[pos]);
      const span = sorted[sorted.length - 1][pos] + sorted[sorted.length - 1][len] - sorted[0][pos];
      const gap = (span - sorted.reduce((t, el) => t + el[len], 0)) / (sorted.length - 1);
      const at = new Map();
      let cursor = sorted[0][pos];
      for (const el of sorted) {
        at.set(el.id, round(cursor));
        cursor += el[len] + gap;
      }
      updateSelected((el) => (at.has(el.id) ? { ...el, [pos]: at.get(el.id) } : el));
    },
    group: () => {
      if (selectedEls.length < 2) return;
      const g = newId('g');
      updateSelected((el) => ({ ...el, group: g }));
    },
    ungroup: () => updateSelected((el) => {
      const { group, ...rest } = el;
      return rest;
    }),
    toggleLock: () => {
      const lock = !sel.locked;
      updateSelected((el) => {
        const { locked, ...rest } = el;
        return lock ? { ...rest, locked: true } : rest;
      });
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
        if (e.altKey) a.present(deckRef.current.active, true);
        else a.present(e.shiftKey ? deckRef.current.active : 0);
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
        } else if (k === '=' || k === '+' || k === '-' || k === '0') {
          e.preventDefault();
          if (k === '0') a.setZoom(1);
          else a.zoomBy(k === '-' ? -1 : 1);
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
        } else if (k === 'k' && selectedRef.current.size) {
          e.preventDefault();
          a.editLink();
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
        } else if (k === 'g') {
          e.preventDefault();
          if (e.shiftKey) a.ungroup();
          else a.group();
        }
        return;
      }
      if (inField) {
        if (e.key === 'Escape' && editingRef.current) {
          e.preventDefault();
          stopEditing();
          stageRef.current?.focus({ preventScroll: true });
        }
        return;
      }
      if (e.target.closest?.('.slide-panel, .slide-sorter, .dropdown-menu, .modal')) return;

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
        updateSelected((el) => (el.locked ? el : { ...el, x: round(el.x + dx), y: round(el.y + dy) }), 'nudge');
      } else if ((e.key === 'Enter' || e.key === 'F2') && sel.size === 1) {
        const d = deckRef.current;
        const el = d.slides[d.active].elements.find((x) => sel.has(x.id));
        if (el) {
          e.preventDefault();
          openItem(el);
        }
      } else if (e.key === 'Escape') {
        setSelected(EMPTY);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [present, readOnly, selectSlide, deleteSelection, updateSelected, openItem, stopEditing, setSelected]);

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

  // Ctrl + wheel zooms the slide.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      actionsRef.current.zoomBy(e.deltaY < 0 ? 1 : -1);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [view]);

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

  const importFile = async (file) => {
    try {
      const { importPptx } = await import('./importPptx');
      const result = await importPptx(file);
      const { document } = await officeApi.create({ kind: 'slides', title: result.title, content: result.content, folderId: doc.folderId });
      result.warnings.forEach((w) => toast.error(w));
      toast.success(`Opened "${document.title}"`);
      navigate(`/office/slides/${document.id}`);
    } catch (err) {
      toast.error(errorMessage(err, err.message || 'Could not open that file'));
    }
  };

  const onTextChange = (el, value) => {
    const d = deckRef.current;
    commit(withElements(d, d.active, new Set([el.id]), (x) => ({ ...x, text: value.slice(0, LIMITS.text) })), `text:${el.id}`);
  };

  const onCellChange = (el, r, c, value) => {
    const d = deckRef.current;
    commit(withElements(d, d.active, new Set([el.id]), (x) => ({ ...x, cells: x.cells.map((row, i) => (i === r ? row.map((v, j) => (j === c ? value.slice(0, LIMITS.cell) : v)) : row)) })), `cell:${el.id}`);
  };

  const shownBox = (el) => (preview?.boxes[el.id] ? { ...el, ...preview.boxes[el.id] } : el);

  const renderElement = (el, th, surface) => {
    const shown = shownBox(el);
    const isSelected = selected.has(el.id);
    const editing = editingId === el.id;
    return (
      <div
        key={el.id}
        className={`slide-el${readOnly ? '' : ' editable'}${isSelected ? ' selected' : ''}${editing ? ' editing' : ''}${el.locked ? ' locked' : ''}`}
        style={boxStyle(shown)}
        onPointerDown={(e) => onElementPointerDown(e, el)}
        onDoubleClick={() => openItem(el)}
      >
        {editing && el.type === 'table' ? (
          <TableEditor el={el} theme={th} onChange={(r, c, v) => onCellChange(el, r, c, v)} onCell={(cell) => { tableCell.current = cell; }} />
        ) : editing ? (
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
        ) : <SlideElement el={shown} theme={th} placeholders={!readOnly} surface={surface} />}
        {el.anim && !readOnly && <span className="slide-anim-badge" style={{ transform: `scale(${1 / scale})` }}>{animated(slide).findIndex((x) => x.id === el.id) + 1}</span>}
      </div>
    );
  };

  // Selection outlines and handles, turned with their item.
  const single = selectedEls.length === 1 && editingId !== selectedEls[0].id ? selectedEls[0] : null;
  const handleSize = 9 / scale;
  const overlay = (el) => {
    const b = shownBox(el);
    const showHandles = single && single.id === el.id && !readOnly && !el.locked;
    return (
      <div key={`o-${el.id}`} className="slide-overlay" style={{ left: b.x, top: b.y, width: b.w, height: b.h, transform: b.rotation ? `rotate(${b.rotation}deg)` : undefined }}>
        <div className="slide-outline" style={{ borderWidth: 1.5 / scale }} />
        {el.locked && <FontAwesomeIcon icon={faLock} className="slide-lock-badge" style={{ fontSize: 12 / scale }} />}
        {showHandles && HANDLES.map((dir) => (
          <div key={dir} className={`slide-handle h-${dir}`} onPointerDown={(e) => onHandlePointerDown(e, el, dir)}
            style={{
              left: (dir.includes('w') ? 0 : dir.includes('e') ? b.w : b.w / 2) - handleSize / 2,
              top: (dir.includes('n') ? 0 : dir.includes('s') ? b.h : b.h / 2) - handleSize / 2,
              width: handleSize,
              height: handleSize,
              borderWidth: 1.5 / scale,
            }} />
        ))}
        {showHandles && (
          <>
            <div className="slide-rotate-stem" style={{ left: b.w / 2, top: -22 / scale, height: 22 / scale, width: 1.5 / scale }} />
            <div className="slide-rotate" title="Rotate (Shift snaps to 15°)" onPointerDown={(e) => onHandlePointerDown(e, el, 'rotate')}
              style={{ left: b.w / 2 - handleSize * 0.65, top: -22 / scale - handleSize * 1.3, width: handleSize * 1.3, height: handleSize * 1.3, borderWidth: 1.5 / scale }} />
          </>
        )}
      </div>
    );
  };

  const folderPath = folderTree && doc.folderId && folderTree.byId.has(doc.folderId) ? folderTree.pathNames(doc.folderId).join(' / ') : null;
  const modalEl = modal?.id ? slide.elements.find((e) => e.id === modal.id) : null;
  const onMoveSlide = (from, to) => {
    const d = deckRef.current;
    const slides = d.slides.slice();
    const [moved] = slides.splice(from, 1);
    slides.splice(to, 0, moved);
    commit({ ...d, slides, active: to });
  };

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
                {trashed ? 'In the trash' : viewOnly ? 'View only' : STATUS[sync.status]}
              </span>
              {sync.status === 'error' && <button type="button" className="btn btn-link btn-sm p-0" onClick={() => sync.save()}>Retry</button>}
              {folderPath && (
                <button type="button" className="doc-folder d-none d-md-inline-flex" onClick={actions.move} title="Move to another folder">
                  <FontAwesomeIcon icon={faFolder} className="me-1" />{folderPath}
                </button>
              )}
            </div>
            {!readOnly && <SlideMenuBar a={actions} deck={deck} sel={sel} />}
          </div>
        </div>
        {!readOnly && view === 'normal' && <SlideToolbar a={actions} sel={sel} themeFont={theme.font} />}
        {sync.status === 'conflict' && (
          <div className="alert alert-warning d-flex flex-wrap align-items-center gap-2 m-2 py-2" role="alert">
            <FontAwesomeIcon icon={faCircleExclamation} />
            <span className="me-auto">This presentation was changed in another tab or device.</span>
            <button type="button" className="btn btn-sm btn-outline-dark" onClick={sync.takeLatest}>Use the latest version</button>
            <button type="button" className="btn btn-sm btn-dark" onClick={sync.keepMine}>Keep my version</button>
          </div>
        )}
        {viewOnly && <ViewOnlyNotice className="m-2" />}
        {trashed && !viewOnly && (
          <div className="alert alert-secondary d-flex align-items-center gap-2 m-2 py-2" role="alert">
            <span className="me-auto">This presentation is in the trash, so it can&apos;t be edited.</span>
            <button type="button" className="btn btn-sm btn-primary" onClick={restore}><FontAwesomeIcon icon={faRotateLeft} className="me-1" />Restore</button>
          </div>
        )}
      </div>

      {view === 'sorter' ? (
        <div className="slide-main">
          <Thumbnails className="slide-sorter" look={look} deck={deck} readOnly={readOnly} width={220} a={actions}
            onSelect={selectSlide} onMove={onMoveSlide}
            onOpen={(i) => { selectSlide(i); setView('normal'); }} />
        </div>
      ) : (
        <div className="slide-main">
          <Thumbnails className="slide-panel" look={look} deck={deck} readOnly={readOnly} width={168} a={actions}
            onSelect={selectSlide} onMove={onMoveSlide} />

          <div className="slide-work">
            <div
              ref={stageRef}
              className={`slide-stage${zoom > 1 ? ' zoomed' : ''}`}
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
                  <SlideView deck={look} slide={slide} index={si} width={width} renderElement={renderElement} className="slide-canvas-frame">
                    {selectedEls.filter((el) => el.id !== editingId || el.type === 'table').map(overlay)}
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
      )}

      <div className="doc-statusbar">
        <span className="text-truncate">Slide {si + 1} of {deck.slides.length}{slide.hidden ? ' (hidden)' : ''}</span>
        <span className="d-none d-sm-inline text-muted">{theme.label}</span>
        <span className="ms-auto d-flex align-items-center gap-2">
          <button type="button" className={`doc-zoom-btn${view === 'normal' ? ' active' : ''}`} onClick={() => actions.setView('normal')} title="Normal view" aria-pressed={view === 'normal'}>
            <FontAwesomeIcon icon={faSquare} />
          </button>
          <button type="button" className={`doc-zoom-btn${view === 'sorter' ? ' active' : ''}`} onClick={() => actions.setView('sorter')} title="Slide sorter" aria-pressed={view === 'sorter'}>
            <FontAwesomeIcon icon={faTableCells} />
          </button>
          <button type="button" className={`doc-zoom-btn slide-notes-btn${showNotes ? ' active' : ''}`} onClick={() => setShowNotes(!showNotes)}
            aria-pressed={showNotes} title="Speaker notes">
            <FontAwesomeIcon icon={faNoteSticky} className="me-1" />Notes
          </button>
          {view === 'normal' && (
            <>
              <button type="button" className="doc-zoom-btn" onClick={() => actions.zoomBy(-1)} aria-label="Zoom out"><FontAwesomeIcon icon={faMinus} /></button>
              <button type="button" className="doc-zoom-btn" style={{ minWidth: 44 }} onClick={() => setZoom(1)} title="Fit to window">{zoom === 1 ? 'Fit' : `${Math.round(zoom * 100)}%`}</button>
              <button type="button" className="doc-zoom-btn" onClick={() => actions.zoomBy(1)} aria-label="Zoom in"><FontAwesomeIcon icon={faPlus} /></button>
            </>
          )}
          <button type="button" className="doc-zoom-btn" onClick={() => setPresent({ start: si, presenter: false })} title="Present from this slide (Shift+F5)">
            <FontAwesomeIcon icon={faPlay} className="me-1" />Present
          </button>
        </span>
      </div>

      <input ref={fileInput} type="file" className="d-none" accept="image/png,image/jpeg,image/gif,image/webp"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) insertImageFile(file);
          else pictureFor.current = null;
        }} />
      <input ref={pptxInput} type="file" className="d-none" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) importFile(file);
        }} />

      {present && (
        <Present deck={deck} start={present.start} presenter={present.presenter} onClose={() => setPresent(null)}
          onPopupBlocked={() => toast.error('Allow pop-ups for this site to use presenter view.')} />
      )}
      {modal?.type === 'background' && (
        <BackgroundModal slide={slide} onClose={() => setModal(null)}
          onSave={(bg) => {
            const d = deckRef.current;
            commit(withSlide(d, d.active, (s) => ({ ...s, ...bg })));
          }}
          onApplyAll={(bg) => {
            const d = deckRef.current;
            commit({ ...d, slides: d.slides.map((s) => ({ ...s, ...bg })) });
          }} />
      )}
      {modal?.type === 'footer' && (
        <FooterModal footer={deck.footer} onClose={() => setModal(null)} onSave={(footer) => commit({ ...deckRef.current, footer })} />
      )}
      {modal?.type === 'link' && (
        <LinkModal current={first?.link} onClose={() => setModal(null)} onSave={(url) => actions.setProp('link', url ?? undefined)} />
      )}
      {modal?.type === 'icon' && (
        <IconPicker onClose={() => setModal(null)}
          onPick={(icon) => {
            if (modalEl) {
              const d = deckRef.current;
              commit(withElements(d, d.active, new Set([modalEl.id]), (el) => ({ ...el, icon })));
            } else insertCentered({ type: 'icon', icon, color: null }, 96, 96);
          }} />
      )}
      {modal?.type === 'chart' && modalEl && (
        <ChartDataModal el={modalEl} theme={theme} onClose={() => setModal(null)}
          onSave={(chart) => {
            const d = deckRef.current;
            commit(withElements(d, d.active, new Set([modalEl.id]), (el) => ({ ...el, ...chart })));
          }} />
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
