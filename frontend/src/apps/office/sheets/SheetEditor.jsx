import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFileExcel, faFolder, faCircleExclamation, faMinus, faPlus, faRotateLeft, faArrowLeft } from '@fortawesome/free-solid-svg-icons';
import { officeApi } from '../api';
import useDocumentSync from '../useDocumentSync';
import Grid from './Grid';
import FormulaBar from './FormulaBar';
import SheetMenuBar from './SheetMenuBar';
import SheetToolbar from './SheetToolbar';
import SheetTabs from './SheetTabs';
import SheetFind from './SheetFind';
import SizeModal from './SizeModal';
import ContextMenu from './ContextMenu';
import {
  fromContent, toContent, countCells, cellKey, normRange, rangeLabel, internStyle, usedExtent, LIMITS, COL_W, ROW_H, colName,
} from './model';
import { parseInput, toEditText, formatValue, nowSerial } from './format';
import { Engine, formulaProblem } from './formula/engine';
import { normalizeFormula } from './formula/parser';
import { offsetFormula } from './formula/refs';
import { compare } from './formula/values';
import {
  setCells, formatRange, setBorders, clearRange, readBlock, writeBlock, fillRange, sortRange, shiftGrid, resize,
  addSheet, renameSheet, deleteSheet, duplicateSheet, moveSheet, setFreeze, cellsIn,
} from './ops';
import { parseDelimited, blockFromRows, toDelimited } from './csv';
import { printSheet } from './printSheet';
import PageSetupModal from '../docs/PageSetupModal';
import MoveToFolderModal from '../../../core/components/folders/MoveToFolderModal';
import { buildTree } from '../../../core/components/folders/tree';
import Spinner from '../../../core/components/Spinner';
import { errorMessage } from '../../../core/api/client';
import { useToast } from '../../../core/context/ToastContext';
import { downloadBlob } from '../../../core/utils/download';
import '../docs/docs.scss';
import './sheets.scss';

const STATUS = { saved: 'Saved', unsaved: 'Editing…', saving: 'Saving…', error: 'Not saved', conflict: 'Not saved' };
const safeFileName = (title) => (title || 'Untitled spreadsheet').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim().slice(0, 100) || 'Untitled spreadsheet';
const MAX_HISTORY = 100;
const ONE = { anchor: { r: 0, c: 0 }, focus: { r: 0, c: 0 } };
const NO_STYLE = Object.freeze({});
const POINT_AFTER = '=(,;+-*/^&<>:';

function usePref(key, fallback) {
  const storageKey = `kanforge.sheets.${key}`;
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

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function SheetWorkspace({ sync }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { doc, settings } = sync;
  const readOnly = Boolean(doc.trashedAt);

  const [wb, setWbState] = useState(() => fromContent(doc.content));
  const wbRef = useRef(wb);
  const history = useRef({ past: [], future: [] });
  const [, setHistoryTick] = useState(0);
  const [sel, setSelState] = useState(ONE);
  const selRef = useRef(sel);
  const sheetSel = useRef(new Map());
  const [editing, setEditingState] = useState(null);
  const editingRef = useRef(null);
  const [point, setPoint] = useState(null);
  const pointRef = useRef(null);
  const pendingCaret = useRef(null);
  const [copied, setCopied] = useState(null);
  const clip = useRef(null);
  const [menu, setMenu] = useState(null);
  const [modal, setModal] = useState(null);
  const [find, setFind] = useState(null);
  const [folderTree, setFolderTree] = useState(null);
  const [zoom, setZoom] = usePref('zoom', 100);
  const [gridlines, setGridlines] = usePref('gridlines', true);
  const inputRef = useRef(null);
  const barRef = useRef(null);
  const fileInput = useRef(null);

  const si = wb.active;
  const sheet = wb.sheets[si];
  const engine = useMemo(() => new Engine(wb), [wb]);
  const range = normRange(sel.anchor, sel.focus);
  const active = sel.anchor;
  const activeCell = sheet.cells[cellKey(active.r, active.c)];
  const activeStyle = activeCell?.s || NO_STYLE;

  const syncRef = useRef(sync);
  syncRef.current = sync;
  useEffect(() => {
    syncRef.current.setContentGetter(() => toContent(wbRef.current));
  }, []);

  useEffect(() => {
    officeApi.folders().then((data) => setFolderTree(buildTree(data.folders))).catch(() => {});
    if (!readOnly) inputRef.current?.focus({ preventScroll: true });
    // Only on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setSel = useCallback((next) => {
    selRef.current = next;
    setSelState(next);
  }, []);

  const setEditing = useCallback((next) => {
    editingRef.current = typeof next === 'function' ? next(editingRef.current) : next;
    setEditingState(editingRef.current);
  }, []);

  // Every change goes through here: it's checked, remembered for undo and saved.
  const commit = useCallback((next, nextSel) => {
    const prev = wbRef.current;
    if (next === prev) return false;
    if (countCells(next) > LIMITS.cells) {
      toast.error(`A spreadsheet can have up to ${LIMITS.cells.toLocaleString()} filled cells.`);
      return false;
    }
    const h = history.current;
    h.past.push({ wb: prev, sel: selRef.current });
    if (h.past.length > MAX_HISTORY) h.past.shift();
    h.future = [];
    wbRef.current = next;
    setWbState(next);
    if (nextSel) setSel(nextSel);
    setHistoryTick((t) => t + 1);
    syncRef.current.markDirty();
    return true;
  }, [toast, setSel]);

  // Switching sheets is saved but isn't something to undo.
  const switchSheet = useCallback((index) => {
    const cur = wbRef.current;
    if (index === cur.active || !cur.sheets[index]) return;
    sheetSel.current.set(cur.sheets[cur.active].id, selRef.current);
    const next = { ...cur, active: index };
    wbRef.current = next;
    setWbState(next);
    setSel(sheetSel.current.get(next.sheets[index].id) || ONE);
    setCopied(null);
    syncRef.current.markDirty();
  }, [setSel]);

  const undo = useCallback(() => {
    const h = history.current;
    const entry = h.past.pop();
    if (!entry) return;
    h.future.push({ wb: wbRef.current, sel: selRef.current });
    wbRef.current = entry.wb;
    setWbState(entry.wb);
    setSel(entry.sel);
    setHistoryTick((t) => t + 1);
    syncRef.current.markDirty();
  }, [setSel]);

  const redo = useCallback(() => {
    const h = history.current;
    const entry = h.future.pop();
    if (!entry) return;
    h.past.push({ wb: wbRef.current, sel: selRef.current });
    wbRef.current = entry.wb;
    setWbState(entry.wb);
    setSel(entry.sel);
    setHistoryTick((t) => t + 1);
    syncRef.current.markDirty();
  }, [setSel]);

  const focusGrid = useCallback(() => {
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  }, []);

  // ---- Editing a cell ----

  const startEdit = useCallback((at, { text, mode = 'edit', from = 'cell' } = {}) => {
    if (readOnly) return;
    const w = wbRef.current;
    const cell = w.sheets[w.active].cells[cellKey(at.r, at.c)];
    const value = text ?? toEditText(cell);
    pointRef.current = null;
    setPoint(null);
    setEditing({ si: w.active, r: at.r, c: at.c, text: value, mode, from });
    pendingCaret.current = { pos: value.length, from };
  }, [readOnly, setEditing]);

  useLayoutEffect(() => {
    const p = pendingCaret.current;
    if (!p || !editing) return;
    pendingCaret.current = null;
    const el = p.from === 'bar' ? barRef.current : inputRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(p.pos, p.pos);
  }, [editing]);

  const cancelEdit = useCallback(() => {
    setEditing(null);
    pointRef.current = null;
    setPoint(null);
    focusGrid();
  }, [setEditing, focusGrid]);

  // The cell `text` would make, keeping the cell's format (and taking a format from what was typed).
  const cellFromText = (text, existing) => {
    const style = existing?.s;
    if (style?.fmt === 'text' && text && text[0] !== '=') return { v: text, s: style };
    const { cell, fmt, dp } = parseInput(text);
    if (!cell) return style ? { s: style } : null;
    const next = { ...cell };
    if (next.f !== undefined) next.f = normalizeFormula(next.f);
    let s = style;
    if (fmt && (!s?.fmt || s.fmt === 'general')) s = internStyle({ ...s, fmt, ...(dp !== undefined ? { dp } : {}) });
    if (s) next.s = s;
    return next;
  };

  const checkText = (text) => {
    if (text[0] === '=' && text.length > 1) {
      if (text.length - 1 > LIMITS.formula) return `Formulas can be up to ${LIMITS.formula.toLocaleString()} characters.`;
      const problem = formulaProblem(text.slice(1));
      if (problem) return `There's a problem with this formula: ${problem}.`;
    } else if (text.length > LIMITS.text) return `A cell can hold up to ${LIMITS.text.toLocaleString()} characters.`;
    return null;
  };

  // Saves the cell being edited. `move` is where to go next; `all` fills the whole selection (Ctrl+Enter).
  const commitEdit = useCallback((move = null, { all = false } = {}) => {
    const e = editingRef.current;
    if (!e) return true;
    const problem = checkText(e.text);
    if (problem) {
      toast.error(problem);
      return false;
    }
    const w = wbRef.current;
    const target = w.sheets[e.si];
    const changes = [];
    const cur = selRef.current;
    const area = all ? normRange(cur.anchor, cur.focus) : { r1: e.r, c1: e.c, r2: e.r, c2: e.c };
    const base = cellFromText(e.text, target.cells[cellKey(e.r, e.c)]);
    for (let r = area.r1; r <= area.r2; r += 1) {
      for (let c = area.c1; c <= area.c2; c += 1) {
        const existing = target.cells[cellKey(r, c)];
        let next = r === e.r && c === e.c ? base : cellFromText(e.text, existing);
        if (next?.f !== undefined && (r !== e.r || c !== e.c)) next = { ...next, f: offsetFormula(base.f, r - e.r, c - e.c) };
        const same = (next?.v ?? null) === (existing?.v ?? null) && next?.f === existing?.f && next?.s === existing?.s;
        if (!same) changes.push([cellKey(r, c), next]);
      }
    }
    setEditing(null);
    pointRef.current = null;
    setPoint(null);
    let nextSel = null;
    if (move && !all) {
      const s = w.sheets[e.si];
      const r = Math.max(0, Math.min(s.rows - 1, e.r + move.dr));
      const c = Math.max(0, Math.min(s.cols - 1, e.c + move.dc));
      nextSel = { anchor: { r, c }, focus: { r, c } };
    }
    if (changes.length) commit(setCells(w, e.si, changes), nextSel);
    else if (nextSel) setSel(nextSel);
    focusGrid();
    return true;
    // cellFromText and checkText only read their arguments.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commit, setEditing, setSel, focusGrid, toast]);

  const activeInput = () => (editingRef.current?.from === 'bar' ? barRef.current : inputRef.current);

  // While typing a formula, clicking a cell adds its reference at the cursor.
  const pointMode = useCallback(() => {
    const e = editingRef.current;
    if (!e || e.text[0] !== '=' || e.si !== wbRef.current.active) return false;
    const el = activeInput();
    const caret = el?.selectionStart ?? e.text.length;
    if (pointRef.current && caret === pointRef.current.end) return true;
    const before = e.text.slice(0, caret).trimEnd();
    return POINT_AFTER.includes(before[before.length - 1]);
  }, []);

  const onPointRef = useCallback((r, finished) => {
    const e = editingRef.current;
    if (!e) return;
    if (finished) {
      const el = activeInput();
      el?.focus({ preventScroll: true });
      return;
    }
    const label = rangeLabel(r);
    const el = activeInput();
    const caret = el?.selectionStart ?? e.text.length;
    const p = pointRef.current;
    const start = p && caret === p.end ? p.start : caret;
    const end = p && caret === p.end ? p.end : caret;
    const text = e.text.slice(0, start) + label + e.text.slice(end);
    pointRef.current = { start, end: start + label.length };
    setPoint(r);
    setEditing({ ...e, text });
    pendingCaret.current = { pos: start + label.length, from: e.from };
  }, [setEditing]);

  const onInputChange = useCallback((value, caret, selectOnly) => {
    if (selectOnly) return;
    const e = editingRef.current;
    if (!e) {
      if (value === '' || readOnly) return;
      const cur = selRef.current;
      setEditing({ si: wbRef.current.active, r: cur.anchor.r, c: cur.anchor.c, text: value, mode: 'enter', from: 'cell' });
      return;
    }
    pointRef.current = null;
    setPoint(null);
    setEditing({ ...e, text: value });
  }, [readOnly, setEditing]);

  // ---- Selection ----

  const select = useCallback((next) => {
    if (editingRef.current) {
      if (!commitEdit()) return;
    }
    setSel(next);
  }, [commitEdit, setSel]);

  const moveBy = (dr, dc, extend) => {
    const s = wbRef.current.sheets[wbRef.current.active];
    const cur = selRef.current;
    const from = extend ? cur.focus : cur.anchor;
    const r = Math.max(0, Math.min(s.rows - 1, from.r + dr));
    const c = Math.max(0, Math.min(s.cols - 1, from.c + dc));
    setSel(extend ? { anchor: cur.anchor, focus: { r, c } } : { anchor: { r, c }, focus: { r, c } });
  };

  // Ctrl+arrow: to the edge of the current block of data, or to the next one.
  const jump = (dr, dc, extend) => {
    const s = wbRef.current.sheets[wbRef.current.active];
    const cur = selRef.current;
    const from = extend ? cur.focus : cur.anchor;
    const filled = (r, c) => {
      const cell = s.cells[cellKey(r, c)];
      return Boolean(cell && (cell.v !== undefined || cell.f !== undefined));
    };
    const inside = (r, c) => r >= 0 && c >= 0 && r < s.rows && c < s.cols;
    let { r, c } = from;
    if (filled(r, c) && inside(r + dr, c + dc) && filled(r + dr, c + dc)) {
      while (inside(r + dr, c + dc) && filled(r + dr, c + dc)) {
        r += dr;
        c += dc;
      }
    } else {
      r += dr;
      c += dc;
      while (inside(r, c) && !filled(r, c)) {
        r += dr;
        c += dc;
      }
      if (!inside(r, c)) {
        r -= dr;
        c -= dc;
      }
    }
    r = Math.max(0, Math.min(s.rows - 1, r));
    c = Math.max(0, Math.min(s.cols - 1, c));
    setSel(extend ? { anchor: cur.anchor, focus: { r, c } } : { anchor: { r, c }, focus: { r, c } });
  };

  // ---- Clipboard ----

  const displayMatrix = (w, sIndex, area, eng) => {
    const s = w.sheets[sIndex];
    const rows = [];
    for (let r = area.r1; r <= area.r2; r += 1) {
      const row = [];
      for (let c = area.c1; c <= area.c2; c += 1) {
        const cell = s.cells[cellKey(r, c)];
        row.push(cell && (cell.v !== undefined || cell.f !== undefined) ? formatValue(eng.value(sIndex, r, c), cell.s).text : '');
      }
      rows.push(row);
    }
    return rows;
  };

  const copySelection = (e, cut) => {
    const w = wbRef.current;
    const area = normRange(selRef.current.anchor, selRef.current.focus);
    const cellsCount = (area.r2 - area.r1 + 1) * (area.c2 - area.c1 + 1);
    if (cellsCount > 200_000) {
      toast.error('That selection is too large to copy.');
      return;
    }
    const text = displayMatrix(w, w.active, area, engine);
    const tsv = toDelimited(text, '\t');
    const html = `<table>${text.map((row) => `<tr>${row.map((v) => `<td>${escapeHtml(v)}</td>`).join('')}</tr>`).join('')}</table>`;
    const values = [];
    for (let r = area.r1; r <= area.r2; r += 1) {
      const row = [];
      for (let c = area.c1; c <= area.c2; c += 1) row.push(engine.value(w.active, r, c));
      values.push(row);
    }
    clip.current = { tsv, block: readBlock(w.sheets[w.active], area), values, cut, si: w.active, sheetId: w.sheets[w.active].id, range: area };
    setCopied({ sheetId: w.sheets[w.active].id, range: area });
    if (e?.clipboardData) {
      e.clipboardData.setData('text/plain', tsv);
      e.clipboardData.setData('text/html', html);
      e.preventDefault();
    } else {
      navigator.clipboard?.writeText(tsv).catch(() => {});
    }
  };

  const pasteText = (text, { valuesOnly = false } = {}) => {
    if (readOnly) return;
    const w = wbRef.current;
    const area = normRange(selRef.current.anchor, selRef.current.focus);
    const c = clip.current;
    let result;
    if (c && c.tsv.replace(/\r\n/g, '\n') === text.replace(/\r\n/g, '\n')) {
      result = writeBlock(w, w.active, area, c.block, { valuesOnly, values: c.values });
      if (c.cut && !valuesOnly) {
        const srcIndex = result.wb.sheets.findIndex((s) => s.id === c.sheetId);
        if (srcIndex >= 0) {
          const moved = srcIndex === result.wb.active ? result.range : null;
          // Clear the cut cells that the paste didn't land on.
          const src = c.range;
          const changes = [];
          for (let r = src.r1; r <= src.r2; r += 1) {
            for (let cc = src.c1; cc <= src.c2; cc += 1) {
              const covered = moved && r >= moved.r1 && r <= moved.r2 && cc >= moved.c1 && cc <= moved.c2;
              if (!covered) changes.push([cellKey(r, cc), null]);
            }
          }
          result = { ...result, wb: setCells(result.wb, srcIndex, changes) };
        }
        clip.current = null;
        setCopied(null);
      }
    } else {
      const rows = parseDelimited(text, '\t');
      if (!rows.length) return;
      const { block, truncated } = blockFromRows(rows);
      if (truncated) toast.error('Only part of the pasted data fits in the sheet.');
      result = writeBlock(w, w.active, area, block);
    }
    const r = result.range;
    commit(result.wb, { anchor: { r: r.r1, c: r.c1 }, focus: { r: r.r2, c: r.c2 } });
  };

  // Browsers only copy (and fire the copy event) when something is selected,
  // so the empty text box on the active cell gets a placeholder selection first.
  const nativeClipboard = (kind) => {
    const el = inputRef.current;
    if (!el) return false;
    el.focus({ preventScroll: true });
    el.value = '\u200b';
    el.select();
    return kind ? document.execCommand(kind) : true;
  };

  const onClipboard = (kind, e) => {
    if (kind === 'copy') copySelection(e, false);
    else if (kind === 'cut') {
      if (readOnly) return;
      copySelection(e, true);
    } else {
      e.preventDefault();
      pasteText(e.clipboardData.getData('text/plain'));
    }
  };

  // ---- Changes to the selection ----

  const applyFormat = (patch) => {
    if (readOnly) return;
    const w = wbRef.current;
    commit(formatRange(w, w.active, normRange(selRef.current.anchor, selRef.current.focus), patch));
  };
  const toggle = (key) => {
    const on = !activeStyle[key];
    applyFormat((s) => ({ ...s, [key]: on || undefined }));
  };
  const setStyle = (key, value) => applyFormat((s) => ({ ...s, [key]: value ?? undefined }));
  const setNumberFormat = (fmt) => applyFormat((s) => {
    const next = { ...s, fmt: fmt === 'general' ? undefined : fmt };
    delete next.dp;
    return next;
  });
  const changeDecimals = (delta) => {
    const cur = activeCell;
    let base = activeStyle.dp;
    if (base === undefined) {
      const v = cur ? engine.value(si, active.r, active.c) : null;
      const shown = typeof v === 'number' ? formatValue(v, activeStyle).text : '';
      base = shown.includes('.') ? shown.split('.')[1].replace(/\D.*$/, '').length : 0;
    }
    const dp = Math.max(0, Math.min(10, base + delta));
    applyFormat((s) => ({ ...s, dp, fmt: s.fmt && s.fmt !== 'general' ? s.fmt : 'number' }));
  };

  const clear = (what = 'contents') => {
    if (readOnly) return;
    const w = wbRef.current;
    commit(clearRange(w, w.active, normRange(selRef.current.anchor, selRef.current.focus), what));
  };

  const fill = (src, dest) => {
    if (readOnly) return;
    const w = wbRef.current;
    commit(fillRange(w, w.active, src, dest), { anchor: { r: dest.r1, c: dest.c1 }, focus: { r: dest.r2, c: dest.c2 } });
  };

  const fillDown = () => {
    const area = normRange(selRef.current.anchor, selRef.current.focus);
    if (area.r1 === area.r2) {
      if (area.r1 === 0) return;
      const w = wbRef.current;
      const src = { ...area, r1: area.r1 - 1, r2: area.r1 - 1 };
      commit(writeBlock(w, w.active, area, readBlock(w.sheets[w.active], src)).wb);
      return;
    }
    const w = wbRef.current;
    const block = readBlock(w.sheets[w.active], { ...area, r2: area.r1 });
    commit(writeBlock(w, w.active, { ...area, r1: area.r1 + 1 }, block).wb);
  };
  const fillRight = () => {
    const area = normRange(selRef.current.anchor, selRef.current.focus);
    const w = wbRef.current;
    if (area.c1 === area.c2) {
      if (area.c1 === 0) return;
      commit(writeBlock(w, w.active, area, readBlock(w.sheets[w.active], { ...area, c1: area.c1 - 1, c2: area.c1 - 1 })).wb);
      return;
    }
    commit(writeBlock(w, w.active, { ...area, c1: area.c1 + 1 }, readBlock(w.sheets[w.active], { ...area, c2: area.c1 })).wb);
  };

  const insertRows = (where) => {
    const w = wbRef.current;
    const s = w.sheets[w.active];
    const area = normRange(selRef.current.anchor, selRef.current.focus);
    const count = area.r2 - area.r1 + 1;
    if (s.rows + count > LIMITS.rows && Object.keys(s.cells).some((k) => Number(k.replace(/^[A-Z]+/, '')) > LIMITS.rows - count)) {
      toast.error(`A sheet can have up to ${LIMITS.rows.toLocaleString()} rows.`);
      return;
    }
    const at = where === 'above' ? area.r1 : area.r2 + 1;
    const r = where === 'above' ? area.r1 : area.r2 + 1;
    commit(shiftGrid(w, w.active, 'r', at, count), { anchor: { r, c: area.c1 }, focus: { r: r + count - 1, c: area.c2 } });
  };
  const insertCols = (where) => {
    const w = wbRef.current;
    const s = w.sheets[w.active];
    const area = normRange(selRef.current.anchor, selRef.current.focus);
    const count = area.c2 - area.c1 + 1;
    if (s.cols + count > LIMITS.cols && usedExtent(s).maxC >= LIMITS.cols - count) {
      toast.error(`A sheet can have up to ${LIMITS.cols} columns.`);
      return;
    }
    const at = where === 'left' ? area.c1 : area.c2 + 1;
    commit(shiftGrid(w, w.active, 'c', at, count), { anchor: { r: area.r1, c: at }, focus: { r: area.r2, c: at + count - 1 } });
  };
  const deleteRows = () => {
    const w = wbRef.current;
    const area = normRange(selRef.current.anchor, selRef.current.focus);
    if (area.r2 - area.r1 + 1 >= w.sheets[w.active].rows) return clear('all');
    commit(shiftGrid(w, w.active, 'r', area.r1, -(area.r2 - area.r1 + 1)), { anchor: { r: area.r1, c: area.c1 }, focus: { r: area.r1, c: area.c1 } });
    return undefined;
  };
  const deleteCols = () => {
    const w = wbRef.current;
    const area = normRange(selRef.current.anchor, selRef.current.focus);
    if (area.c2 - area.c1 + 1 >= w.sheets[w.active].cols) return clear('all');
    commit(shiftGrid(w, w.active, 'c', area.c1, -(area.c2 - area.c1 + 1)), { anchor: { r: area.r1, c: area.c1 }, focus: { r: area.r1, c: area.c1 } });
    return undefined;
  };

  // Sorting the selection, or (with one cell selected) the block of data around it.
  const sort = (ascending) => {
    const w = wbRef.current;
    const s = w.sheets[w.active];
    let area = normRange(selRef.current.anchor, selRef.current.focus);
    const byCol = selRef.current.anchor.c;
    const { maxR, maxC } = usedExtent(s);
    if (maxR < 0) return;
    if (area.r1 === area.r2 && area.c1 === area.c2) {
      area = { r1: s.freeze.rows, c1: 0, r2: maxR, c2: maxC };
    } else {
      area = { ...area, r2: Math.min(area.r2, maxR), c2: Math.min(area.c2, maxC) };
    }
    if (area.r2 <= area.r1) return;
    commit(sortRange(w, w.active, area, byCol, ascending, engine, compare));
  };

  const autoSum = (fn = 'SUM') => {
    if (readOnly) return;
    const w = wbRef.current;
    const s = w.sheets[w.active];
    const area = normRange(selRef.current.anchor, selRef.current.focus);
    const isNum = (r, c) => typeof engine.value(w.active, r, c) === 'number' && s.cells[cellKey(r, c)];
    if (area.r1 === area.r2 && area.c1 === area.c2) {
      let top = area.r1 - 1;
      while (top >= 0 && isNum(top, area.c1)) top -= 1;
      let left = area.c1 - 1;
      while (left >= 0 && isNum(area.r1, left)) left -= 1;
      let text = `=${fn}()`;
      if (top < area.r1 - 1) text = `=${fn}(${rangeLabel({ r1: top + 1, c1: area.c1, r2: area.r1 - 1, c2: area.c1 })})`;
      else if (left < area.c1 - 1) text = `=${fn}(${rangeLabel({ r1: area.r1, c1: left + 1, r2: area.r1, c2: area.c1 - 1 })})`;
      startEdit({ r: area.r1, c: area.c1 }, { text, mode: 'edit' });
      if (text.endsWith('()')) pendingCaret.current = { pos: text.length - 1, from: 'cell' };
      return;
    }
    // A block selected: totals go in the row under it.
    const row = Math.min(s.rows - 1, area.r2 + 1);
    const changes = [];
    for (let c = area.c1; c <= area.c2; c += 1) {
      const next = { f: `${fn}(${rangeLabel({ r1: area.r1, c1: c, r2: area.r2, c2: c })})` };
      const style = s.cells[cellKey(row, c)]?.s;
      if (style) next.s = style;
      changes.push([cellKey(row, c), next]);
    }
    commit(setCells(w, w.active, changes));
  };

  const autoFit = (axis, index) => {
    const w = wbRef.current;
    const s = w.sheets[w.active];
    const cur = normRange(selRef.current.anchor, selRef.current.focus);
    const whole = axis === 'c' ? cur.r1 === 0 && cur.r2 === s.rows - 1 : cur.c1 === 0 && cur.c2 === s.cols - 1;
    const indexes = whole && index >= (axis === 'c' ? cur.c1 : cur.r1) && index <= (axis === 'c' ? cur.c2 : cur.r2)
      ? Array.from({ length: (axis === 'c' ? cur.c2 - cur.c1 : cur.r2 - cur.r1) + 1 }, (_, i) => (axis === 'c' ? cur.c1 : cur.r1) + i)
      : [index];
    if (axis === 'r') {
      commit(resize(w, w.active, 'r', indexes, null));
      return;
    }
    const ctx = document.createElement('canvas').getContext('2d');
    let next = w;
    for (const col of indexes) {
      let widest = 0;
      for (const [key, cell] of Object.entries(s.cells)) {
        if (!key.startsWith(colName(col)) || !/^\d/.test(key.slice(colName(col).length))) continue;
        const r = Number(key.slice(colName(col).length)) - 1;
        const { text } = formatValue(engine.value(w.active, r, col), cell.s);
        if (!text) continue;
        ctx.font = `${cell.s?.i ? 'italic ' : ''}${cell.s?.b ? 'bold ' : ''}${cell.s?.size ?? 11}pt ${cell.s?.font ?? 'Calibri, Carlito, Arial, sans-serif'}`;
        const longest = text.split('\n').reduce((m, line) => Math.max(m, ctx.measureText(line).width), 0);
        widest = Math.max(widest, longest);
      }
      next = resize(next, w.active, 'c', [col], widest ? Math.ceil(widest + 10) : null);
    }
    commit(next);
  };

  // ---- Keyboard ----

  const onKeyDown = (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key;
    const edit = editingRef.current;

    if (edit) {
      if (key === 'Enter' && e.altKey) {
        e.preventDefault();
        const el = e.currentTarget;
        const { selectionStart: a, selectionEnd: b } = el;
        const text = edit.text.slice(0, a) + '\n' + edit.text.slice(b);
        setEditing({ ...edit, text });
        pendingCaret.current = { pos: a + 1, from: edit.from };
        return;
      }
      if (key === 'Enter') {
        e.preventDefault();
        if (mod) commitEdit(null, { all: true });
        else commitEdit({ dr: e.shiftKey ? -1 : 1, dc: 0 });
        return;
      }
      if (key === 'Tab') {
        e.preventDefault();
        commitEdit({ dr: 0, dc: e.shiftKey ? -1 : 1 });
        return;
      }
      if (key === 'Escape') {
        e.preventDefault();
        cancelEdit();
        return;
      }
      if (key === 'F2') {
        e.preventDefault();
        setEditing({ ...edit, mode: edit.mode === 'enter' ? 'edit' : 'enter' });
        return;
      }
      // Arrows move to the next cell while entering (not while editing, or in a formula).
      const arrows = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
      if (arrows[key] && edit.mode === 'enter' && edit.from === 'cell' && edit.text[0] !== '=' && !e.shiftKey && !mod) {
        e.preventDefault();
        commitEdit({ dr: arrows[key][0], dc: arrows[key][1] });
      }
      return;
    }

    const s = wbRef.current.sheets[wbRef.current.active];
    const cur = selRef.current;
    const handled = () => e.preventDefault();

    if (mod && !e.altKey) {
      const k = key.toLowerCase();
      // Let the browser copy or cut; the clipboard event handler fills in the cells.
      if ((k === 'c' || k === 'x') && !e.shiftKey) {
        nativeClipboard(null);
        return;
      }
      const map = {
        z: () => (e.shiftKey ? redo() : undo()),
        y: redo,
        b: () => toggle('b'),
        i: () => toggle('i'),
        u: () => toggle('u'),
        '5': () => toggle('s'),
        d: fillDown,
        r: fillRight,
        a: () => setSel({ anchor: { r: 0, c: 0 }, focus: { r: s.rows - 1, c: s.cols - 1 } }),
        home: () => setSel(ONE),
        end: () => {
          const { maxR, maxC } = usedExtent(s);
          const r = Math.max(0, maxR);
          const c = Math.max(0, maxC);
          setSel(e.shiftKey ? { anchor: cur.anchor, focus: { r, c } } : { anchor: { r, c }, focus: { r, c } });
        },
        ';': () => startEdit(cur.anchor, { text: toEditText({ v: Math.floor(nowSerial()), s: { fmt: 'date' } }), mode: 'enter' }),
        ':': () => startEdit(cur.anchor, { text: toEditText({ v: nowSerial() % 1, s: { fmt: 'time' } }), mode: 'enter' }),
        ' ': () => setSel({ anchor: { r: 0, c: cur.anchor.c }, focus: { r: s.rows - 1, c: cur.focus.c } }),
        '$': () => setNumberFormat('currency'),
        '%': () => setNumberFormat('percent'),
      };
      const arrows = { arrowup: [-1, 0], arrowdown: [1, 0], arrowleft: [0, -1], arrowright: [0, 1] };
      if (arrows[k]) {
        handled();
        jump(arrows[k][0], arrows[k][1], e.shiftKey);
        return;
      }
      if (map[k] && !(readOnly && 'bius5dr$%;:'.includes(k))) {
        handled();
        map[k]();
      }
      return;
    }
    if (e.altKey && key === '=') {
      handled();
      autoSum('SUM');
      return;
    }
    switch (key) {
      case 'ArrowUp': handled(); moveBy(-1, 0, e.shiftKey); return;
      case 'ArrowDown': handled(); moveBy(1, 0, e.shiftKey); return;
      case 'ArrowLeft': handled(); moveBy(0, -1, e.shiftKey); return;
      case 'ArrowRight': handled(); moveBy(0, 1, e.shiftKey); return;
      case 'Enter': handled(); moveBy(e.shiftKey ? -1 : 1, 0, false); return;
      case 'Tab': handled(); moveBy(0, e.shiftKey ? -1 : 1, false); return;
      case 'Home': handled(); setSel(e.shiftKey ? { anchor: cur.anchor, focus: { r: cur.focus.r, c: 0 } } : { anchor: { r: cur.anchor.r, c: 0 }, focus: { r: cur.anchor.r, c: 0 } }); return;
      case 'PageDown': handled(); moveBy(20, 0, e.shiftKey); return;
      case 'PageUp': handled(); moveBy(-20, 0, e.shiftKey); return;
      case 'F2': handled(); startEdit(cur.anchor); return;
      case 'Delete': case 'Backspace': handled(); clear('contents'); return;
      case 'Escape': setCopied(null); clip.current = clip.current && { ...clip.current, cut: false }; return;
      case ' ':
        if (e.shiftKey) {
          handled();
          setSel({ anchor: { r: cur.anchor.r, c: 0 }, focus: { r: cur.focus.r, c: s.cols - 1 } });
        }
        return;
      default:
    }
  };

  // Word-style shortcuts that should work wherever the focus is.
  const globalKeys = useRef(null);
  globalKeys.current = (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
    const k = e.key.toLowerCase();
    if (k === 's') {
      e.preventDefault();
      syncRef.current.save();
    } else if (k === 'p') {
      e.preventDefault();
      actions.print();
    } else if (k === 'f' || k === 'h') {
      e.preventDefault();
      setFind({ replace: k === 'h' && !readOnly });
    }
  };
  useEffect(() => {
    const onKey = (e) => globalKeys.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---- Files and menus ----

  const importFile = async (file) => {
    try {
      const { importSpreadsheet } = await import('./importSheet');
      const result = await importSpreadsheet(file);
      const { document } = await officeApi.create({ kind: 'sheet', title: result.title, content: result.content, folderId: doc.folderId });
      result.warnings.forEach((w) => toast.error(w));
      toast.success(`Opened "${document.title}"`);
      navigate(`/office/sheets/${document.id}`);
    } catch (err) {
      toast.error(errorMessage(err, err.message || 'Could not open that file'));
    }
  };

  const actions = {
    canUndo: history.current.past.length > 0,
    canRedo: history.current.future.length > 0,
    undo, redo,
    print: () => printSheet({ sheet, si, engine, settings, title: sync.title, gridlines }),
    printSelection: () => printSheet({ sheet, si, engine, settings, title: sync.title, gridlines, range }),
    pageSetup: () => setModal({ type: 'pageSetup' }),
    downloadPdf: () => {
      toast.success('Choose "Save as PDF" in the print dialog.');
      setTimeout(() => printSheet({ sheet, si, engine, settings, title: sync.title, gridlines }), 300);
    },
    downloadXlsx: async () => {
      try {
        const { exportXlsx } = await import('./xlsx');
        downloadBlob(exportXlsx(wbRef.current, engine, sync.title), `${safeFileName(sync.title)}.xlsx`);
      } catch (err) {
        toast.error(errorMessage(err, 'Could not create the Excel file'));
      }
    },
    downloadCsv: () => {
      const { maxR, maxC } = usedExtent(sheet);
      const rows = maxR < 0 ? [] : displayMatrix(wbRef.current, si, { r1: 0, c1: 0, r2: maxR, c2: maxC }, engine);
      const name = wb.sheets.length > 1 ? `${safeFileName(sync.title)} - ${safeFileName(sheet.name)}` : safeFileName(sync.title);
      downloadBlob(new Blob([`﻿${toDelimited(rows)}`], { type: 'text/csv;charset=utf-8' }), `${name}.csv`);
    },
    importFile: () => fileInput.current?.click(),
    newSpreadsheet: async () => {
      try {
        const { document } = await officeApi.create({ kind: 'sheet', folderId: doc.folderId });
        navigate(`/office/sheets/${document.id}`);
      } catch (err) {
        toast.error(errorMessage(err));
      }
    },
    openOffice: () => navigate('/office'),
    copyDoc: async () => {
      try {
        await sync.save();
        const { document } = await officeApi.copy(doc.id);
        toast.success(`Created "${document.title}"`);
        navigate(`/office/sheets/${document.id}`);
      } catch (err) {
        toast.error(errorMessage(err));
      }
    },
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
    copy: () => {
      if (!nativeClipboard('copy')) copySelection(null, false);
    },
    cut: () => {
      if (!nativeClipboard('cut')) copySelection(null, true);
    },
    paste: async () => {
      try {
        const text = await navigator.clipboard.readText();
        pasteText(text);
      } catch {
        toast.success('Press Ctrl+V (⌘V on a Mac) to paste.');
      }
    },
    pasteValues: () => {
      if (!clip.current) {
        toast.success('Copy some cells first, then paste their values here.');
        return;
      }
      pasteText(clip.current.tsv, { valuesOnly: true });
    },
    clear,
    selectAll: () => setSel({ anchor: { r: 0, c: 0 }, focus: { r: sheet.rows - 1, c: sheet.cols - 1 } }),
    find: (replace) => setFind({ replace: replace && !readOnly }),
    freeze: (rows, cols) => commit(setFreeze(wbRef.current, si, rows, cols)),
    freezeHere: () => commit(setFreeze(wbRef.current, si, Math.min(50, active.r), Math.min(20, active.c))),
    zoom, setZoom, gridlines, toggleGridlines: () => setGridlines(!gridlines),
    insertRows, insertCols, deleteRows, deleteCols,
    addSheet: () => commit(addSheet(wbRef.current, si + 1), ONE),
    insertFunction: (name) => startEdit(active, { text: `=${name}(`, mode: 'edit' }),
    insertDate: () => startEdit(active, { text: toEditText({ v: Math.floor(nowSerial()), s: { fmt: 'date' } }), mode: 'enter' }),
    insertTime: () => startEdit(active, { text: toEditText({ v: nowSerial() % 1, s: { fmt: 'time' } }), mode: 'enter' }),
    toggle, setStyle, setNumberFormat, changeDecimals,
    borders: (kind) => !readOnly && commit(setBorders(wbRef.current, si, range, kind)),
    clearFormatting: () => clear('formats'),
    colWidth: () => setModal({ type: 'size', axis: 'c' }),
    rowHeight: () => setModal({ type: 'size', axis: 'r' }),
    autoFitCols: () => autoFit('c', range.c1),
    sort,
    autoSum,
    fillDown, fillRight,
  };

  const onImport = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) importFile(file);
  };

  // ---- Status bar: sum, average and count of the selection ----

  const stats = useMemo(() => {
    if (range.r1 === range.r2 && range.c1 === range.c2) return null;
    let count = 0;
    let nums = 0;
    let sum = 0;
    const cells = cellsIn(sheet, range);
    if (cells.length > 50_000) return null;
    for (const [, cell, r, c] of cells) {
      if (cell.v === undefined && cell.f === undefined) continue;
      const v = engine.value(si, r, c);
      if (v === null || v === '') continue;
      count += 1;
      if (typeof v === 'number') {
        nums += 1;
        sum += v;
      }
    }
    if (!count) return null;
    const style = activeStyle.fmt && activeStyle.fmt !== 'text' ? activeStyle : undefined;
    const show = (n) => formatValue(Number(n.toPrecision(15)), style).text;
    return { count, sum: nums ? show(sum) : null, avg: nums ? show(sum / nums) : null };
  }, [sheet, range.r1, range.c1, range.r2, range.c2, engine, si, activeStyle]);

  // ---- Rendering ----

  const restore = async () => {
    try {
      await officeApi.restore(doc.id);
      await sync.takeLatest();
      toast.success('Spreadsheet restored');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const folderPath = folderTree && doc.folderId && folderTree.byId.has(doc.folderId) ? folderTree.pathNames(doc.folderId).join(' / ') : null;
  const barText = editing ? editing.text : toEditText(activeCell);

  return (
    <div className={`doc-app sheet-app${gridlines ? '' : ' no-gridlines'}`}>
      <div className="doc-chrome">
        <div className="doc-titlebar">
          <Link to="/office" className="doc-home sheet-home" title="Back to Office" aria-label="Back to Office">
            <FontAwesomeIcon icon={faArrowLeft} className="d-sm-none" />
            <FontAwesomeIcon icon={faFileExcel} className="d-none d-sm-inline" />
          </Link>
          <div className="min-w-0 flex-grow-1">
            <div className="d-flex align-items-center gap-2">
              <input className="doc-title" value={sync.title} placeholder="Untitled spreadsheet" maxLength={200}
                readOnly={readOnly} onChange={(e) => sync.setTitle(e.target.value)} aria-label="Spreadsheet title" />
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
            {!readOnly && <SheetMenuBar a={actions} sheet={sheet} active={active} style={activeStyle} />}
          </div>
        </div>
        {!readOnly && <SheetToolbar a={actions} style={activeStyle} />}
        {sync.status === 'conflict' && (
          <div className="alert alert-warning d-flex flex-wrap align-items-center gap-2 m-2 py-2" role="alert">
            <FontAwesomeIcon icon={faCircleExclamation} />
            <span className="me-auto">This spreadsheet was changed in another tab or device.</span>
            <button type="button" className="btn btn-sm btn-outline-dark" onClick={sync.takeLatest}>Use the latest version</button>
            <button type="button" className="btn btn-sm btn-dark" onClick={sync.keepMine}>Keep my version</button>
          </div>
        )}
        {readOnly && (
          <div className="alert alert-secondary d-flex align-items-center gap-2 m-2 py-2" role="alert">
            <span className="me-auto">This spreadsheet is in the trash, so it can't be edited.</span>
            <button type="button" className="btn btn-sm btn-primary" onClick={restore}><FontAwesomeIcon icon={faRotateLeft} className="me-1" />Restore</button>
          </div>
        )}
        <FormulaBar
          barRef={barRef}
          label={range.r1 === range.r2 && range.c1 === range.c2 ? cellKey(active.r, active.c) : rangeLabel(range)}
          text={barText}
          readOnly={readOnly}
          editing={editing?.from === 'bar'}
          onGoto={(target) => {
            if (!commitEdit()) return;
            setSel(target);
            focusGrid();
          }}
          sheet={sheet}
          onFocusEdit={() => {
            if (readOnly) return;
            const e = editingRef.current;
            if (e) setEditing({ ...e, from: 'bar' });
            else {
              const w = wbRef.current;
              const cur = selRef.current;
              setEditing({ si: w.active, r: cur.anchor.r, c: cur.anchor.c, text: toEditText(w.sheets[w.active].cells[cellKey(cur.anchor.r, cur.anchor.c)]), mode: 'edit', from: 'bar' });
            }
          }}
          onChange={(text) => {
            pointRef.current = null;
            setPoint(null);
            setEditing((e) => (e ? { ...e, text } : e));
          }}
          onKeyDown={onKeyDown}
        />
      </div>

      <div className="sheet-main">
        {find && (
          <SheetFind
            key={String(find.replace)}
            wb={wb}
            engine={engine}
            showReplace={find.replace}
            onGoto={(sheetIndex, r, c) => {
              if (sheetIndex !== wbRef.current.active) switchSheet(sheetIndex);
              setSel({ anchor: { r, c }, focus: { r, c } });
            }}
            onReplace={(changesBySheet) => {
              let next = wbRef.current;
              for (const [sIndex, changes] of changesBySheet) next = setCells(next, sIndex, changes);
              commit(next);
            }}
            cellFromText={cellFromText}
            onClose={() => { setFind(null); focusGrid(); }}
          />
        )}
        <Grid
          sheet={sheet}
          si={si}
          engine={engine}
          zoom={zoom}
          sel={sel}
          editing={editing && editing.si === si ? editing : null}
          point={point}
          copied={copied && copied.sheetId === sheet.id ? copied.range : null}
          readOnly={readOnly}
          inputRef={inputRef}
          onSelect={select}
          onStartEdit={(at) => startEdit(at)}
          onInputChange={onInputChange}
          onInputKeyDown={onKeyDown}
          onClipboard={onClipboard}
          onResize={(axis, indexes, px) => commit(resize(wbRef.current, si, axis, indexes, px))}
          onAutoFit={autoFit}
          onFill={fill}
          onContextMenu={(m) => !readOnly && setMenu(m)}
          pointMode={pointMode}
          onPointRef={onPointRef}
        />
      </div>

      <SheetTabs
        sheets={wb.sheets}
        active={si}
        readOnly={readOnly}
        onSelect={(i) => {
          if (!commitEdit()) return;
          switchSheet(i);
          focusGrid();
        }}
        onAdd={() => {
          if (!commitEdit()) return;
          if (wb.sheets.length >= LIMITS.sheets) toast.error(`A spreadsheet can have up to ${LIMITS.sheets} sheets.`);
          else commit(addSheet(wbRef.current, wbRef.current.sheets.length), ONE);
        }}
        onRename={(i, name) => commit(renameSheet(wbRef.current, i, name))}
        onDuplicate={(i) => commit(duplicateSheet(wbRef.current, i), ONE)}
        onDelete={(i) => commit(deleteSheet(wbRef.current, i), ONE)}
        onMove={(from, to) => commit(moveSheet(wbRef.current, from, to))}
      />

      <div className="doc-statusbar">
        <span className="text-truncate">{editing ? (editing.mode === 'enter' ? 'Enter' : 'Edit') : 'Ready'}</span>
        {stats && (
          <span className="sheet-stats text-truncate">
            {stats.avg !== null && <span className="d-none d-md-inline">Average: {stats.avg}</span>}
            <span>Count: {stats.count}</span>
            {stats.sum !== null && <span>Sum: {stats.sum}</span>}
          </span>
        )}
        <span className="ms-auto d-flex align-items-center gap-2">
          <button type="button" className="doc-zoom-btn" onClick={() => setZoom(Math.max(50, zoom - 10))} aria-label="Zoom out"><FontAwesomeIcon icon={faMinus} /></button>
          <input type="range" min={50} max={200} step={10} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Zoom" className="doc-zoom-range sheet-zoom-range" />
          <button type="button" className="doc-zoom-btn" onClick={() => setZoom(Math.min(200, zoom + 10))} aria-label="Zoom in"><FontAwesomeIcon icon={faPlus} /></button>
          <button type="button" className="doc-zoom-btn" style={{ minWidth: 44 }} onClick={() => setZoom(100)} title="Reset zoom">{zoom}%</button>
        </span>
      </div>

      <input ref={fileInput} type="file" className="d-none" onChange={onImport}
        accept=".xlsx,.csv,.tsv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" />

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          area={menu.area}
          a={actions}
          range={range}
          onClose={() => { setMenu(null); focusGrid(); }}
        />
      )}
      {modal?.type === 'pageSetup' && <PageSetupModal settings={settings} onSave={sync.setSettings} onClose={() => setModal(null)} />}
      {modal?.type === 'size' && (
        <SizeModal
          axis={modal.axis}
          current={modal.axis === 'c' ? sheet.widths[range.c1] ?? COL_W : sheet.heights[range.r1] ?? ROW_H}
          onSave={(px) => {
            const from = modal.axis === 'c' ? range.c1 : range.r1;
            const to = modal.axis === 'c' ? range.c2 : range.r2;
            commit(resize(wbRef.current, si, modal.axis, Array.from({ length: to - from + 1 }, (_, i) => from + i), px));
          }}
          onClose={() => { setModal(null); focusGrid(); }}
        />
      )}
      {modal?.type === 'move' && folderTree && (
        <MoveToFolderModal
          tree={folderTree}
          title="Move spreadsheet to…"
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

export default function SheetEditor() {
  const { docId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const onError = useCallback((err, when) => {
    toast.error(errorMessage(err, when === 'load' ? 'Could not open the spreadsheet' : 'Could not save the spreadsheet'));
    if (when === 'load') navigate('/office', { replace: true });
  }, [toast, navigate]);
  const sync = useDocumentSync(docId, { onError });

  if (!sync.doc || !sync.settings) return <Spinner fullscreen />;
  if (sync.doc.kind !== 'sheet') return <Navigate to={`/office/docs/${docId}`} replace />;
  return <SheetWorkspace key={`${docId}:${sync.loadKey}`} sync={sync} />;
}

