import { fromContent, toContent, countCells, LIMITS } from './model';
import { writeBlock } from './ops';
import { parseDelimited, blockFromRows } from './csv';

// An Excel or CSV file → { title, content, warnings }, ready to save as a new spreadsheet.
export async function importSpreadsheet(file) {
  let result;
  if (/\.(csv|tsv|txt)$/i.test(file.name)) {
    if (file.size > 20 * 1024 * 1024) throw new Error('CSV files can be up to 20 MB');
    const rows = parseDelimited(await file.text(), /\.tsv$/i.test(file.name) ? '\t' : undefined);
    const { block, truncated } = blockFromRows(rows);
    const base = fromContent({ sheets: [{ id: 's1', name: 'Sheet1', cells: {} }], styles: [], active: 0 });
    result = {
      wb: writeBlock(base, 0, { r1: 0, c1: 0, r2: 0, c2: 0 }, block).wb,
      warnings: truncated ? [`Only the first ${LIMITS.rows.toLocaleString()} rows and ${LIMITS.cols} columns were kept.`] : [],
    };
  } else {
    const { importXlsx } = await import('./xlsx');
    result = await importXlsx(file);
  }
  if (countCells(result.wb) > LIMITS.cells) throw new Error(`This file has more than ${LIMITS.cells.toLocaleString()} filled cells, which is more than Sheets can hold`);
  return {
    title: file.name.replace(/\.(xlsx|csv|tsv|txt)$/i, '').slice(0, 200),
    content: toContent(result.wb),
    warnings: result.warnings,
  };
}

export const SPREADSHEET_FILE = /\.(xlsx|csv|tsv)$/i;
