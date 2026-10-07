import { importSpreadsheet } from '../../../office/sheets/importSheet';
import {
  fromContent, cellKey, colName, COL_W, ROW_H, HEADER_W, HEADER_H,
} from '../../../office/sheets/model';
import { Engine } from '../../../office/sheets/formula/engine';
import { formatValue } from '../../../office/sheets/format';
import { DEFAULT_FONT_STACK, DEFAULT_SIZE, BORDER_COLOR } from '../../../office/sheets/styles';
import {
  THUMB_WIDTH, PAGE_HEIGHT, NoThumbnail, makeCanvas, canvasToThumb,
} from '../thumbnails';

// A spreadsheet's preview (Excel, CSV or TSV): the top-left corner of the sheet
// that was open when it was saved, drawn like the grid in Excel or Office's
// Sheets. The file is read with Office's own spreadsheet import, and formulas
// are worked out with its formula engine, so cells show the same values and
// number formats as when the file is opened in Office.

// The grid is drawn at this fraction of its on-screen size, which fits about
// eight normal columns and forty rows on the preview.
const SCALE = 0.62;
const GRIDLINE = '#e1e1e1';
const HEADER_BG = '#f3f3f3';
const HEADER_LINE = '#d4d4d4';
const HEADER_INK = '#444444';

export async function sheetThumb(file, name) {
  let wb;
  try {
    // Office's import tells CSV from Excel by the file name.
    wb = fromContent((await importSpreadsheet(new File([file], name))).content);
  } catch {
    throw new NoThumbnail('This isn\'t a spreadsheet that can be read');
  }
  const si = Math.min(Math.max(0, wb.active ?? 0), wb.sheets.length - 1);
  const sheet = wb.sheets[si];
  const engine = new Engine(wb);

  const { canvas, ctx } = makeCanvas(THUMB_WIDTH, PAGE_HEIGHT);
  ctx.scale(SCALE, SCALE);
  const W = THUMB_WIDTH / SCALE;
  const H = PAGE_HEIGHT / SCALE;

  // Column and row edges, as far as the preview reaches. Custom widths and
  // heights are kept, as in the file.
  const colX = [HEADER_W];
  for (let c = 0; colX[c] < W && c < sheet.cols; c += 1) colX.push(colX[c] + (sheet.widths?.[c] ?? COL_W));
  const rowY = [HEADER_H];
  for (let r = 0; rowY[r] < H && r < sheet.rows; r += 1) rowY.push(rowY[r] + (sheet.heights?.[r] ?? ROW_H));
  const cols = colX.length - 1;
  const rows = rowY.length - 1;

  // Gridlines first, so cell fills and text sit on top of them.
  ctx.strokeStyle = GRIDLINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const x of colX) { ctx.moveTo(x + 0.5, HEADER_H); ctx.lineTo(x + 0.5, H); }
  for (const y of rowY) { ctx.moveTo(HEADER_W, y + 0.5); ctx.lineTo(W, y + 0.5); }
  ctx.stroke();

  const filled = (r, c) => {
    const cell = sheet.cells[cellKey(r, c)];
    return cell && (cell.v !== undefined || cell.f !== undefined);
  };

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const cell = sheet.cells[cellKey(r, c)];
      if (!cell) continue;
      const style = cell.s;
      const [x, y, w, h] = [colX[c], rowY[r], colX[c + 1] - colX[c], rowY[r + 1] - rowY[r]];
      if (style?.fill) {
        ctx.fillStyle = style.fill;
        ctx.fillRect(x, y, w, h);
      }
      // Borders: black lines on whichever sides the cell has them.
      if (style && (style.bt || style.bb || style.bl || style.br)) {
        ctx.strokeStyle = BORDER_COLOR;
        ctx.beginPath();
        if (style.bt) { ctx.moveTo(x, y + 0.5); ctx.lineTo(x + w, y + 0.5); }
        if (style.bb) { ctx.moveTo(x, y + h - 0.5); ctx.lineTo(x + w, y + h - 0.5); }
        if (style.bl) { ctx.moveTo(x + 0.5, y); ctx.lineTo(x + 0.5, y + h); }
        if (style.br) { ctx.moveTo(x + w - 0.5, y); ctx.lineTo(x + w - 0.5, y + h); }
        ctx.stroke();
      }
      if (!filled(r, c)) continue;
      const { text, kind } = formatValue(engine.value(si, r, c), style);
      if (!text) continue;
      // Numbers right, text left, TRUE/FALSE and errors centred, unless the cell says otherwise.
      const align = style?.h ?? (kind === 'num' ? 'right' : kind === 'bool' || kind === 'err' ? 'center' : 'left');
      // Left-aligned text runs on over empty cells to its right, as in Excel.
      let right = c + 1;
      if (align === 'left' && kind === 'text') while (right < cols && !filled(r, right)) right += 1;
      const clipW = colX[right] - x;
      const size = ((style?.size ?? DEFAULT_SIZE) * 4) / 3;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, clipW, h);
      ctx.clip();
      ctx.font = `${style?.i ? 'italic ' : ''}${style?.b ? '700' : '400'} ${size}px ${style?.font ?? DEFAULT_FONT_STACK}`;
      ctx.fillStyle = kind === 'err' ? '#c00000' : style?.color ?? '#000000';
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = align === 'right' ? 'right' : align === 'center' ? 'center' : 'left';
      const tx = align === 'right' ? x + w - 3 : align === 'center' ? x + w / 2 : x + 3;
      const ty = style?.v === 'top' ? y + size + 2 : style?.v === 'middle' ? y + h / 2 + size / 3 : y + h - 5;
      ctx.fillText(text, tx, ty);
      ctx.restore();
    }
  }

  // Column letters and row numbers, drawn last so nothing spills over them.
  ctx.fillStyle = HEADER_BG;
  ctx.fillRect(0, 0, W, HEADER_H);
  ctx.fillRect(0, 0, HEADER_W, H);
  ctx.strokeStyle = HEADER_LINE;
  ctx.beginPath();
  for (const x of colX) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, HEADER_H); }
  for (const y of rowY) { ctx.moveTo(0, y + 0.5); ctx.lineTo(HEADER_W, y + 0.5); }
  ctx.moveTo(0, HEADER_H + 0.5); ctx.lineTo(W, HEADER_H + 0.5);
  ctx.moveTo(HEADER_W + 0.5, 0); ctx.lineTo(HEADER_W + 0.5, H);
  ctx.stroke();
  ctx.fillStyle = HEADER_INK;
  ctx.font = `400 12px ${DEFAULT_FONT_STACK}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let c = 0; c < cols; c += 1) ctx.fillText(colName(c), (colX[c] + colX[c + 1]) / 2, HEADER_H / 2);
  for (let r = 0; r < rows; r += 1) ctx.fillText(String(r + 1), HEADER_W / 2, (rowY[r] + rowY[r + 1]) / 2);

  return canvasToThumb(canvas);
}
