import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { COL_W, ROW_H, HEADER_W, HEADER_H, colName, cellKey, normRange } from './model';
import { formatValue } from './format';
import { cellCss, DEFAULT_FONT_STACK } from './styles';

// The sheet grid. Only the cells in view are drawn: the grid is split into
// four panes (frozen corner, frozen rows, frozen columns and the scrolling
// part), each holding a layer of absolutely placed cells in sheet
// coordinates. Scrolling just moves the layers; cells are redrawn when the
// view reaches a new block of rows or columns.
//
// Keyboard input goes to one textarea that always sits on the active cell:
// typing into it starts editing, and copy, cut and paste arrive there as
// normal clipboard events.

const BLOCK_R = 20;
const BLOCK_C = 6;
const RESIZE_GRAB = 4;

// Offsets of each row or column: prefix[i] is where index i starts.
function prefixSizes(count, sizes, base, z) {
  const out = new Float64Array(count + 1);
  for (let i = 0; i < count; i += 1) out[i + 1] = out[i] + (sizes[i] ?? base) * z;
  return out;
}

// The index whose span contains `pos`.
function indexAt(prefix, pos) {
  let lo = 0;
  let hi = prefix.length - 2;
  if (pos <= 0) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (prefix[mid] <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

const Lines = memo(function Lines({ colX, rowY, c0, c1, r0, r1 }) {
  const top = rowY[r0];
  const height = rowY[r1 + 1] - top;
  const left = colX[c0];
  const width = colX[c1 + 1] - left;
  const out = [];
  for (let c = c0; c <= c1; c += 1) out.push(<div key={`c${c}`} className="sheet-vline" style={{ left: colX[c + 1] - 1, top, height }} />);
  for (let r = r0; r <= r1; r += 1) out.push(<div key={`r${r}`} className="sheet-hline" style={{ top: rowY[r + 1] - 1, left, width }} />);
  return out;
});

function Cells({ sheet, si, engine, colX, rowY, c0, c1, r0, r1, z, editingKey }) {
  const out = [];
  const { cells } = sheet;
  for (let r = r0; r <= r1; r += 1) {
    for (let c = c0; c <= c1; c += 1) {
      const key = cellKey(r, c);
      const cell = cells[key];
      if (!cell || key === editingKey) continue;
      const style = cell.s;
      const value = cell.f !== undefined || cell.v !== undefined ? engine.value(si, r, c) : null;
      const { text, kind } = formatValue(value, style);
      const w = colX[c + 1] - colX[c];
      const h = rowY[r + 1] - rowY[r];
      const align = style?.h ?? (kind === 'num' ? 'right' : kind === 'bool' || kind === 'err' ? 'center' : 'left');
      // Left-aligned text runs on over empty cells to its right, as in Excel.
      let textW = w;
      if (text && align === 'left' && !style?.wrap && kind === 'text') {
        let n = c + 1;
        const limit = Math.min(sheet.cols - 1, c1 + 12);
        while (n <= limit) {
          const next = cells[cellKey(r, n)];
          if (next && (next.v !== undefined || next.f !== undefined)) break;
          n += 1;
        }
        textW = colX[n] - colX[c];
      }
      out.push(
        <div
          key={key}
          className={`sheet-cell${textW > w ? ' spill' : ''}${kind === 'err' ? ' err' : ''}`}
          style={{ left: colX[c], top: rowY[r], width: w, height: h, ...cellCss(style, z) }}
        >
          {text && (
            <div className={`sheet-text v-${style?.v ?? 'bottom'}${style?.wrap ? ' wrap' : ''}`} style={{ width: textW, textAlign: align }}>
              {text}
            </div>
          )}
        </div>,
      );
    }
  }
  return out;
}

function Overlay({ colX, rowY, range, active, fill, showHandle, point, copied }) {
  const box = (r) => ({ left: colX[r.c1], top: rowY[r.r1], width: colX[r.c2 + 1] - colX[r.c1], height: rowY[r.r2 + 1] - rowY[r.r1] });
  const multi = range.r1 !== range.r2 || range.c1 !== range.c2;
  return (
    <>
      {multi && <div className="sheet-sel" style={box(range)} />}
      <div className="sheet-active" style={box({ r1: active.r, c1: active.c, r2: active.r, c2: active.c })} />
      {multi && <div className="sheet-sel-border" style={box(range)} />}
      {fill && <div className="sheet-fill-preview" style={box(fill)} />}
      {point && <div className="sheet-point" style={box(point)} />}
      {copied && <div className="sheet-copied" style={box(copied)} />}
      {showHandle && (
        <div className="sheet-fill-handle" data-fill="1" style={{ left: colX[range.c2 + 1] - 4, top: rowY[range.r2 + 1] - 4 }} />
      )}
    </>
  );
}

export default function Grid({
  sheet, si, engine, zoom, sel, editing, point, copied, readOnly, inputRef,
  onSelect, onStartEdit, onInputChange, onInputKeyDown, onClipboard, onResize, onAutoFit, onFill,
  onContextMenu, pointMode, onPointRef,
}) {
  const z = zoom / 100;
  const viewportRef = useRef(null);
  const paneRef = useRef(null);
  const layers = useRef({});
  const [size, setSize] = useState({ w: 800, h: 500 });
  const [win, setWin] = useState({ r0: 0, r1: 40, c0: 0, c1: 12 });
  const [guide, setGuide] = useState(null);
  const [fillPreview, setFillPreview] = useState(null);
  const drag = useRef(null);
  const scrollPos = useRef({ left: 0, top: 0 });

  const colX = useMemo(() => prefixSizes(sheet.cols, sheet.widths, COL_W, z), [sheet.cols, sheet.widths, z]);
  const rowY = useMemo(() => prefixSizes(sheet.rows, sheet.heights, ROW_H, z), [sheet.rows, sheet.heights, z]);
  const fr = Math.min(sheet.freeze.rows, sheet.rows - 1);
  const fc = Math.min(sheet.freeze.cols, sheet.cols - 1);
  const frozenW = colX[fc];
  const frozenH = rowY[fr];
  const headW = Math.round(HEADER_W * z);
  const headH = Math.round(HEADER_H * z);
  const mainW = Math.max(0, size.w - headW - frozenW);
  const mainH = Math.max(0, size.h - headH - frozenH);

  const range = normRange(sel.anchor, sel.focus);
  const active = sel.anchor;

  // Which block of rows and columns to draw for the current scroll position.
  const computeWindow = useCallback((left, top) => {
    const firstR = Math.max(fr, indexAt(rowY, frozenH + top));
    const lastR = indexAt(rowY, frozenH + top + mainH);
    const firstC = Math.max(fc, indexAt(colX, frozenW + left));
    const lastC = indexAt(colX, frozenW + left + mainW);
    return {
      r0: Math.max(fr, Math.floor(firstR / BLOCK_R) * BLOCK_R - BLOCK_R),
      r1: Math.min(sheet.rows - 1, Math.ceil((lastR + 1) / BLOCK_R) * BLOCK_R + BLOCK_R),
      c0: Math.max(fc, Math.floor(firstC / BLOCK_C) * BLOCK_C - BLOCK_C),
      c1: Math.min(sheet.cols - 1, Math.ceil((lastC + 1) / BLOCK_C) * BLOCK_C + BLOCK_C),
    };
  }, [rowY, colX, fr, fc, frozenH, frozenW, mainH, mainW, sheet.rows, sheet.cols]);

  const placeLayers = useCallback(() => {
    const { left, top } = scrollPos.current;
    const L = layers.current;
    const set = (el, x, y) => {
      if (el) el.style.transform = `translate(${x}px, ${y}px)`;
    };
    set(L.main, -(left + frozenW), -(top + frozenH));
    set(L.top, -(left + frozenW), 0);
    set(L.left, 0, -(top + frozenH));
    set(L.colHead, -(left + frozenW), 0);
    set(L.rowHead, 0, -(top + frozenH));
  }, [frozenW, frozenH]);

  const onScroll = useCallback(() => {
    const vp = viewportRef.current;
    scrollPos.current = { left: vp.scrollLeft, top: vp.scrollTop };
    placeLayers();
    const next = computeWindow(vp.scrollLeft, vp.scrollTop);
    setWin((w) => (w.r0 === next.r0 && w.r1 === next.r1 && w.c0 === next.c0 && w.c1 === next.c1 ? w : next));
  }, [placeLayers, computeWindow]);

  useLayoutEffect(() => {
    placeLayers();
    const vp = viewportRef.current;
    setWin(computeWindow(vp.scrollLeft, vp.scrollTop));
  }, [placeLayers, computeWindow]);

  useEffect(() => {
    const vp = viewportRef.current;
    const ro = new ResizeObserver(() => setSize({ w: vp.clientWidth, h: vp.clientHeight }));
    ro.observe(vp);
    return () => ro.disconnect();
  }, []);

  // Keep the active end of the selection in view (but not when a whole
  // column or row is selected, which would scroll to its far end).
  useEffect(() => {
    const vp = viewportRef.current;
    const { r, c } = sel.focus;
    if (!vp || r >= sheet.rows || c >= sheet.cols) return;
    const allRows = Math.min(sel.anchor.r, r) === 0 && Math.max(sel.anchor.r, r) === sheet.rows - 1;
    const allCols = Math.min(sel.anchor.c, c) === 0 && Math.max(sel.anchor.c, c) === sheet.cols - 1;
    if (r >= fr && !allRows) {
      const top = rowY[r] - frozenH;
      const bottom = rowY[r + 1] - frozenH;
      if (top < vp.scrollTop) vp.scrollTop = top;
      else if (bottom > vp.scrollTop + mainH) vp.scrollTop = bottom - mainH;
    }
    if (c >= fc && !allCols) {
      const left = colX[c] - frozenW;
      const right = colX[c + 1] - frozenW;
      if (left < vp.scrollLeft) vp.scrollLeft = left;
      else if (right > vp.scrollLeft + mainW) vp.scrollLeft = Math.min(left, right - mainW);
    }
  }, [sel.focus, sel.anchor, rowY, colX, fr, fc, frozenH, frozenW, mainH, mainW, sheet.rows, sheet.cols]);

  // ---- Pointer ----

  // Sheet position under a point in the pane: { r, c, area: 'cell' | 'col' | 'row' | 'corner', x, y }.
  const hit = useCallback((clientX, clientY) => {
    const rect = paneRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const { left, top } = scrollPos.current;
    const gx = x - headW < frozenW ? x - headW : x - headW + left;
    const gy = y - headH < frozenH ? y - headH : y - headH + top;
    const c = Math.min(sheet.cols - 1, indexAt(colX, Math.max(0, gx)));
    const r = Math.min(sheet.rows - 1, indexAt(rowY, Math.max(0, gy)));
    const area = x < headW && y < headH ? 'corner' : y < headH ? 'col' : x < headW ? 'row' : 'cell';
    return { r, c, area, x, y, gx, gy };
  }, [headW, headH, frozenW, frozenH, colX, rowY, sheet.cols, sheet.rows]);

  // A column or row edge within grabbing distance, for resizing.
  const edgeAt = (h) => {
    if (h.area === 'col') {
      const c = indexAt(colX, h.gx);
      if (Math.abs(colX[c + 1] - h.gx) <= RESIZE_GRAB) return { axis: 'c', index: c };
      if (c > 0 && Math.abs(colX[c] - h.gx) <= RESIZE_GRAB) return { axis: 'c', index: c - 1 };
    }
    if (h.area === 'row') {
      const r = indexAt(rowY, h.gy);
      if (Math.abs(rowY[r + 1] - h.gy) <= RESIZE_GRAB) return { axis: 'r', index: r };
      if (r > 0 && Math.abs(rowY[r] - h.gy) <= RESIZE_GRAB) return { axis: 'r', index: r - 1 };
    }
    return null;
  };

  const lastRow = sheet.rows - 1;
  const lastCol = sheet.cols - 1;

  const selectFor = (h, start) => {
    if (h.area === 'col') return { anchor: { r: 0, c: start.c }, focus: { r: lastRow, c: h.c } };
    if (h.area === 'row') return { anchor: { r: start.r, c: 0 }, focus: { r: h.r, c: lastCol } };
    return { anchor: start, focus: { r: h.r, c: h.c } };
  };

  // While dragging past the edge of the grid, keep scrolling.
  const autoScroll = useRef(null);
  const stopAutoScroll = () => {
    cancelAnimationFrame(autoScroll.current);
    autoScroll.current = null;
  };

  const moveDrag = (clientX, clientY) => {
    const d = drag.current;
    if (!d) return;
    const h = hit(clientX, clientY);
    if (d.kind === 'select') {
      const next = selectFor({ ...h, area: d.area }, d.start);
      onSelect(next);
    } else if (d.kind === 'point') {
      onPointRef(normRange(d.start, h), false);
    } else if (d.kind === 'fill') {
      const src = d.range;
      const down = h.r > src.r2 ? h.r - src.r2 : h.r < src.r1 ? h.r - src.r1 : 0;
      const across = h.c > src.c2 ? h.c - src.c2 : h.c < src.c1 ? h.c - src.c1 : 0;
      if (!down && !across) setFillPreview(null);
      else if (Math.abs(down) >= Math.abs(across)) setFillPreview(down > 0 ? { ...src, r2: h.r } : { ...src, r1: h.r });
      else setFillPreview(across > 0 ? { ...src, c2: h.c } : { ...src, c1: h.c });
    } else if (d.kind === 'resize') {
      const delta = (d.axis === 'c' ? clientX - d.startX : clientY - d.startY) / z;
      const px = Math.max(4, d.startSize + delta);
      setGuide({ axis: d.axis, index: d.index, px });
    }
  };

  const onPointerDown = (e) => {
    if (e.button !== 0 && e.button !== undefined) return;
    const h = hit(e.clientX, e.clientY);
    // Touch scrolls the grid; a tap (handled on pointer up) selects.
    if (e.pointerType === 'touch') {
      drag.current = { kind: 'tap', x: e.clientX, y: e.clientY, h };
      return;
    }
    if (e.target.dataset.fill && !readOnly) {
      e.preventDefault();
      drag.current = { kind: 'fill', range };
      paneRef.current.setPointerCapture(e.pointerId);
      return;
    }
    const edge = edgeAt(h);
    if (edge && !readOnly) {
      e.preventDefault();
      const startSize = (edge.axis === 'c' ? sheet.widths[edge.index] ?? COL_W : sheet.heights[edge.index] ?? ROW_H);
      drag.current = { kind: 'resize', ...edge, startX: e.clientX, startY: e.clientY, startSize };
      setGuide({ axis: edge.axis, index: edge.index, px: startSize });
      paneRef.current.setPointerCapture(e.pointerId);
      return;
    }
    if (h.area === 'corner') {
      e.preventDefault();
      onSelect({ anchor: { r: 0, c: 0 }, focus: { r: lastRow, c: lastCol } });
      return;
    }
    if (h.area === 'cell' && pointMode?.()) {
      // Clicking cells while typing a formula adds references to it.
      e.preventDefault();
      drag.current = { kind: 'point', start: { r: h.r, c: h.c } };
      onPointRef({ r1: h.r, c1: h.c, r2: h.r, c2: h.c }, false);
      paneRef.current.setPointerCapture(e.pointerId);
      return;
    }
    e.preventDefault();
    const start = e.shiftKey ? sel.anchor : { r: h.area === 'col' ? 0 : h.r, c: h.area === 'row' ? 0 : h.c };
    onSelect(selectFor(h, start));
    drag.current = { kind: 'select', start, area: h.area };
    paneRef.current.setPointerCapture(e.pointerId);
    inputRef.current?.focus({ preventScroll: true });
  };

  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) {
      if (!readOnly && e.pointerType !== 'touch') {
        const edge = edgeAt(hit(e.clientX, e.clientY));
        paneRef.current.style.cursor = edge ? (edge.axis === 'c' ? 'col-resize' : 'row-resize') : '';
      }
      return;
    }
    if (d.kind === 'tap') {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8) drag.current = null;
      return;
    }
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    moveDrag(e.clientX, e.clientY);
    if (d.kind === 'select' || d.kind === 'fill' || d.kind === 'point') {
      const rect = paneRef.current.getBoundingClientRect();
      const outside = e.clientX > rect.right - 10 || e.clientY > rect.bottom - 10 || e.clientX < rect.left + headW || e.clientY < rect.top + headH;
      if (outside && !autoScroll.current) {
        const step = () => {
          const dd = drag.current;
          const vp = viewportRef.current;
          if (!dd || !vp) return stopAutoScroll();
          const r = paneRef.current.getBoundingClientRect();
          const dx = dd.lastX > r.right - 10 ? 12 : dd.lastX < r.left + headW ? -12 : 0;
          const dy = dd.lastY > r.bottom - 10 ? 12 : dd.lastY < r.top + headH ? -12 : 0;
          if (!dx && !dy) return stopAutoScroll();
          vp.scrollLeft += dx;
          vp.scrollTop += dy;
          moveDrag(dd.lastX, dd.lastY);
          autoScroll.current = requestAnimationFrame(step);
          return undefined;
        };
        autoScroll.current = requestAnimationFrame(step);
      }
    }
  };

  const onPointerUp = (e) => {
    const d = drag.current;
    drag.current = null;
    stopAutoScroll();
    if (!d) return;
    if (d.kind === 'tap') {
      const { h } = d;
      if (h.area === 'corner') onSelect({ anchor: { r: 0, c: 0 }, focus: { r: lastRow, c: lastCol } });
      else onSelect(selectFor(h, { r: h.area === 'col' ? 0 : h.r, c: h.area === 'row' ? 0 : h.c }));
      return;
    }
    if (d.kind === 'fill') {
      if (fillPreview) onFill(d.range, fillPreview);
      setFillPreview(null);
    } else if (d.kind === 'resize') {
      const delta = (d.axis === 'c' ? e.clientX - d.startX : e.clientY - d.startY) / z;
      if (Math.abs(delta) >= 1) {
        const selected = d.axis === 'c'
          ? range.r1 === 0 && range.r2 === lastRow && d.index >= range.c1 && d.index <= range.c2
          : range.c1 === 0 && range.c2 === lastCol && d.index >= range.r1 && d.index <= range.r2;
        const from = d.axis === 'c' ? range.c1 : range.r1;
        const to = d.axis === 'c' ? range.c2 : range.r2;
        const indexes = selected ? Array.from({ length: to - from + 1 }, (_, i) => from + i) : [d.index];
        onResize(d.axis, indexes, Math.max(4, d.startSize + delta));
      }
      setGuide(null);
    } else if (d.kind === 'point') {
      onPointRef(null, true);
    }
  };

  const onDoubleClick = (e) => {
    const h = hit(e.clientX, e.clientY);
    const edge = edgeAt(h);
    if (edge && !readOnly) {
      onAutoFit(edge.axis, edge.index);
      return;
    }
    if (h.area === 'cell' && !readOnly) onStartEdit({ r: h.r, c: h.c });
  };

  const onContext = (e) => {
    const h = hit(e.clientX, e.clientY);
    if (h.area === 'corner') return;
    e.preventDefault();
    const inside = h.r >= range.r1 && h.r <= range.r2 && h.c >= range.c1 && h.c <= range.c2;
    if (!inside) onSelect(selectFor(h, { r: h.area === 'col' ? 0 : h.r, c: h.area === 'row' ? 0 : h.c }));
    onContextMenu({ x: e.clientX, y: e.clientY, area: h.area });
  };

  // ---- Drawing ----

  const frozenRows = fr > 0 ? { r0: 0, r1: fr - 1 } : null;
  const frozenCols = fc > 0 ? { c0: 0, c1: fc - 1 } : null;
  const editingKey = editing ? cellKey(editing.r, editing.c) : null;
  const common = { sheet, si, engine, colX, rowY, z, editingKey };
  const overlay = { colX, rowY, range, active, fill: fillPreview, showHandle: !readOnly && !editing, point, copied };

  const quadrant = (name, rows, cols, style) => (
    <div className="sheet-quad" style={style}>
      <div className="sheet-layer" ref={(el) => { layers.current[name] = el; }}>
        <Lines colX={colX} rowY={rowY} c0={cols.c0} c1={cols.c1} r0={rows.r0} r1={rows.r1} />
        <Cells {...common} c0={cols.c0} c1={cols.c1} r0={rows.r0} r1={rows.r1} />
        <Overlay {...overlay} />
        {name === quadName && input}
      </div>
    </div>
  );

  // The quadrant holding the active cell gets the text box.
  const quadName = active.r < fr ? (active.c < fc ? 'corner' : 'top') : active.c < fc ? 'left' : 'main';
  const editStyle = editing ? cellCss(sheet.cells[cellKey(active.r, active.c)]?.s, z) : null;
  const input = (
    <textarea
      ref={inputRef}
      className={`sheet-input${editing ? ' editing' : ''}`}
      style={{
        left: colX[active.c],
        top: rowY[active.r],
        minWidth: colX[active.c + 1] - colX[active.c],
        height: editing ? undefined : rowY[active.r + 1] - rowY[active.r],
        minHeight: rowY[active.r + 1] - rowY[active.r],
        fontFamily: editStyle?.fontFamily ?? DEFAULT_FONT_STACK,
        fontSize: editStyle?.fontSize ?? `${11 * z}pt`,
        fontWeight: editStyle?.fontWeight,
        fontStyle: editStyle?.fontStyle,
        color: editStyle?.color,
        background: editing ? editStyle?.background ?? '#fff' : 'transparent',
      }}
      value={editing ? editing.text : ''}
      readOnly={readOnly}
      spellCheck={false}
      autoCapitalize="off"
      autoComplete="off"
      inputMode={editing ? 'text' : 'none'}
      aria-label={`Cell ${cellKey(active.r, active.c)}`}
      rows={1}
      wrap="off"
      onChange={(e) => onInputChange(e.target.value, e.target.selectionStart)}
      onKeyDown={onInputKeyDown}
      onSelect={(e) => editing && onInputChange(e.target.value, e.target.selectionStart, true)}
      onCopy={(e) => !editing && onClipboard('copy', e)}
      onCut={(e) => !editing && onClipboard('cut', e)}
      onPaste={(e) => !editing && onClipboard('paste', e)}
    />
  );

  const colHeaders = (c0, c1) => {
    const out = [];
    for (let c = c0; c <= c1; c += 1) {
      const on = c >= range.c1 && c <= range.c2;
      const full = on && range.r1 === 0 && range.r2 === lastRow;
      out.push(
        <div key={c} className={`sheet-colhead${on ? ' on' : ''}${full ? ' full' : ''}`} style={{ left: colX[c], width: colX[c + 1] - colX[c], height: headH }}>
          {colName(c)}
        </div>,
      );
    }
    return out;
  };
  const rowHeaders = (r0, r1) => {
    const out = [];
    for (let r = r0; r <= r1; r += 1) {
      const on = r >= range.r1 && r <= range.r2;
      const full = on && range.c1 === 0 && range.c2 === lastCol;
      out.push(
        <div key={r} className={`sheet-rowhead${on ? ' on' : ''}${full ? ' full' : ''}`} style={{ top: rowY[r], height: rowY[r + 1] - rowY[r], width: headW }}>
          {r + 1}
        </div>,
      );
    }
    return out;
  };

  const guideLine = guide && (() => {
    const { left, top } = scrollPos.current;
    if (guide.axis === 'c') {
      const start = colX[guide.index];
      const x = headW + (guide.index < fc ? start : start - left) + guide.px * z;
      return <div className="sheet-guide v" style={{ left: x }} />;
    }
    const start = rowY[guide.index];
    const y = headH + (guide.index < fr ? start : start - top) + guide.px * z;
    return <div className="sheet-guide h" style={{ top: y }} />;
  })();

  const main = { r0: win.r0, r1: win.r1 };
  const mainCols = { c0: win.c0, c1: win.c1 };

  return (
    <div
      className="sheet-viewport"
      ref={viewportRef}
      onScroll={onScroll}
      style={{ '--z': z, fontSize: `${11 * z}pt` }}
    >
      <div className="sheet-sizer" style={{ width: headW + colX[sheet.cols] + 80, height: headH + rowY[sheet.rows] + 80 }}>
        <div
          className="sheet-pane"
          ref={paneRef}
          style={{ width: size.w, height: size.h }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => { drag.current = null; stopAutoScroll(); setGuide(null); setFillPreview(null); }}
          onDoubleClick={onDoubleClick}
          onContextMenu={onContext}
        >
          {quadrant('main', main, mainCols, { left: headW + frozenW, top: headH + frozenH, width: mainW, height: mainH })}
          {frozenRows && quadrant('top', frozenRows, mainCols, { left: headW + frozenW, top: headH, width: mainW, height: frozenH })}
          {frozenCols && quadrant('left', main, frozenCols, { left: headW, top: headH + frozenH, width: frozenW, height: mainH })}
          {frozenRows && frozenCols && quadrant('corner', frozenRows, frozenCols, { left: headW, top: headH, width: frozenW, height: frozenH })}

          <div className="sheet-heads-top" style={{ left: headW, width: size.w - headW, height: headH }}>
            {frozenCols && <div className="sheet-quad" style={{ left: 0, top: 0, width: frozenW, height: headH }}><div className="sheet-layer">{colHeaders(0, fc - 1)}</div></div>}
            <div className="sheet-quad" style={{ left: frozenW, top: 0, width: mainW, height: headH }}>
              <div className="sheet-layer" ref={(el) => { layers.current.colHead = el; }}>{colHeaders(win.c0, win.c1)}</div>
            </div>
          </div>
          <div className="sheet-heads-left" style={{ top: headH, width: headW, height: size.h - headH }}>
            {frozenRows && <div className="sheet-quad" style={{ left: 0, top: 0, width: headW, height: frozenH }}><div className="sheet-layer">{rowHeaders(0, fr - 1)}</div></div>}
            <div className="sheet-quad" style={{ left: 0, top: frozenH, width: headW, height: mainH }}>
              <div className="sheet-layer" ref={(el) => { layers.current.rowHead = el; }}>{rowHeaders(win.r0, win.r1)}</div>
            </div>
          </div>
          <div className="sheet-corner" style={{ width: headW, height: headH }} title="Select all" />
          {fc > 0 && <div className="sheet-freeze-line v" style={{ left: headW + frozenW - 1, top: 0, height: size.h }} />}
          {fr > 0 && <div className="sheet-freeze-line h" style={{ top: headH + frozenH - 1, left: 0, width: size.w }} />}
          {guideLine}
        </div>
      </div>
    </div>
  );
}
