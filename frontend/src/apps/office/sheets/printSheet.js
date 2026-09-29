import { pageBox } from '../docs/fonts';
import { COL_W, ROW_H, cellKey, usedExtent } from './model';
import { formatValue } from './format';
import { cellCss } from './styles';

// Prints a sheet (or saves it as PDF from the print dialog): the used part
// of the sheet, or the selection, as a table on pages of the document's
// paper size. sheets.scss hides everything else while printing.
export function printSheet({ sheet, si, engine, settings, title, range, gridlines = true }) {
  const { maxR, maxC } = usedExtent(sheet);
  const area = range ?? { r1: 0, c1: 0, r2: Math.max(0, maxR), c2: Math.max(0, maxC) };

  const root = document.createElement('div');
  root.className = `sheet-print${gridlines ? ' gridlines' : ''}`;
  const table = document.createElement('table');
  const colgroup = document.createElement('colgroup');
  for (let c = area.c1; c <= area.c2; c += 1) {
    const col = document.createElement('col');
    col.style.width = `${sheet.widths[c] ?? COL_W}px`;
    colgroup.appendChild(col);
  }
  table.appendChild(colgroup);
  const body = document.createElement('tbody');
  for (let r = area.r1; r <= area.r2; r += 1) {
    const tr = document.createElement('tr');
    tr.style.height = `${sheet.heights[r] ?? ROW_H}px`;
    for (let c = area.c1; c <= area.c2; c += 1) {
      const td = document.createElement('td');
      const cell = sheet.cells[cellKey(r, c)];
      if (cell) {
        const value = cell.f !== undefined || cell.v !== undefined ? engine.value(si, r, c) : null;
        const { text, kind } = formatValue(value, cell.s);
        td.textContent = text;
        Object.assign(td.style, cellCss(cell.s, 1) || {});
        td.style.textAlign = cell.s?.h ?? (kind === 'num' ? 'right' : kind === 'bool' || kind === 'err' ? 'center' : 'left');
        td.style.verticalAlign = { top: 'top', middle: 'middle' }[cell.s?.v] ?? 'bottom';
        if (cell.s?.wrap) td.style.whiteSpace = 'pre-wrap';
      }
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
  table.appendChild(body);
  root.appendChild(table);
  document.body.appendChild(root);

  const box = pageBox(settings);
  const m = settings.margins;
  const style = document.createElement('style');
  style.textContent = `@page { size: ${box.width}mm ${box.height}mm; margin: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm; }`;
  document.head.appendChild(style);
  const previousTitle = document.title;
  document.title = title || 'Untitled spreadsheet';
  document.body.classList.add('sheet-printing');
  const done = () => {
    document.body.classList.remove('sheet-printing');
    root.remove();
    style.remove();
    document.title = previousTitle;
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
}
