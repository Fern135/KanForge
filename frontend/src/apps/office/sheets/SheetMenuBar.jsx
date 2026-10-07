import {
  faFileCirclePlus, faCopy, faFileImport, faDownload, faPrint, faTrashCan, faFolderOpen, faRotateLeft, faRotateRight,
  faScissors, faClipboard, faMagnifyingGlass, faExpand, faFileExcel, faFilePdf, faFileCsv, faBold, faItalic, faUnderline,
  faStrikethrough, faAlignLeft, faAlignCenter, faAlignRight, faArrowDownAZ, faArrowUpAZ, faTableCells, faEraser,
  faSnowflake, faSquarePlus, faCalendarDay, faClock, faCalculator, faTextWidth, faTextHeight, faBorderAll,
} from '@fortawesome/free-solid-svg-icons';
import { DropMenu } from '../docs/ui';
import { sourceItem } from '../filesPicker';
import { NUMBER_FORMATS } from './styles';
import { colName } from './model';

const ZOOMS = [50, 75, 90, 100, 125, 150, 200];
export const FUNCTION_GROUPS = [
  { label: 'Math', names: ['SUM', 'AVERAGE', 'COUNT', 'COUNTA', 'MIN', 'MAX', 'ROUND', 'ABS', 'SUMPRODUCT', 'MOD', 'POWER', 'SQRT'] },
  { label: 'Logical', names: ['IF', 'IFS', 'IFERROR', 'AND', 'OR', 'NOT', 'SWITCH'] },
  { label: 'Lookup', names: ['VLOOKUP', 'XLOOKUP', 'HLOOKUP', 'INDEX', 'MATCH', 'CHOOSE'] },
  { label: 'Conditional', names: ['SUMIF', 'SUMIFS', 'COUNTIF', 'COUNTIFS', 'AVERAGEIF', 'AVERAGEIFS', 'MAXIFS', 'MINIFS'] },
  { label: 'Text', names: ['CONCAT', 'TEXTJOIN', 'LEFT', 'RIGHT', 'MID', 'LEN', 'UPPER', 'LOWER', 'PROPER', 'TRIM', 'SUBSTITUTE', 'FIND', 'TEXT', 'VALUE'] },
  { label: 'Date and time', names: ['TODAY', 'NOW', 'DATE', 'YEAR', 'MONTH', 'DAY', 'WEEKDAY', 'EDATE', 'EOMONTH', 'DATEDIF', 'NETWORKDAYS'] },
  { label: 'Statistics', names: ['MEDIAN', 'MODE', 'STDEV', 'VAR', 'LARGE', 'SMALL', 'RANK'] },
  { label: 'Finance', names: ['PMT', 'FV', 'PV', 'NPV'] },
];

// Excel / Calc-style menus. Everything they do comes in through `a` (the editor's actions).
export default function SheetMenuBar({ a, sheet, active, style }) {
  const fr = sheet.freeze.rows;
  const fc = sheet.freeze.cols;
  const menus = [
    {
      label: 'File',
      items: [
        { label: 'New spreadsheet', icon: faFileCirclePlus, onClick: a.newSpreadsheet },
        { label: 'Open…', icon: faFolderOpen, onClick: a.openOffice },
        { label: 'Make a copy', icon: faCopy, onClick: a.copyDoc },
        'divider',
        sourceItem({ label: 'Import Excel or CSV file', icon: faFileImport, computer: a.importFile, files: a.importFileFromFiles }),
        {
          label: 'Download',
          icon: faDownload,
          items: [
            { label: 'Excel workbook (.xlsx)', icon: faFileExcel, onClick: a.downloadXlsx },
            { label: 'CSV, this sheet (.csv)', icon: faFileCsv, onClick: a.downloadCsv },
            { label: 'PDF (.pdf)', icon: faFilePdf, onClick: a.downloadPdf },
          ],
        },
        'divider',
        { label: 'Move to folder…', icon: faFolderOpen, onClick: a.move },
        { label: 'Page setup…', onClick: a.pageSetup },
        { label: 'Print', icon: faPrint, shortcut: 'Ctrl+P', onClick: a.print },
        { label: 'Print selection', onClick: a.printSelection },
        'divider',
        { label: 'Move to trash', icon: faTrashCan, onClick: a.trash },
      ],
    },
    {
      label: 'Edit',
      items: [
        { label: 'Undo', icon: faRotateLeft, shortcut: 'Ctrl+Z', disabled: !a.canUndo, onClick: a.undo },
        { label: 'Redo', icon: faRotateRight, shortcut: 'Ctrl+Y', disabled: !a.canRedo, onClick: a.redo },
        'divider',
        { label: 'Cut', icon: faScissors, shortcut: 'Ctrl+X', onClick: a.cut },
        { label: 'Copy', icon: faCopy, shortcut: 'Ctrl+C', onClick: a.copy },
        { label: 'Paste', icon: faClipboard, shortcut: 'Ctrl+V', onClick: a.paste },
        { label: 'Paste values only', onClick: a.pasteValues },
        'divider',
        { label: 'Fill down', shortcut: 'Ctrl+D', onClick: a.fillDown },
        { label: 'Fill right', shortcut: 'Ctrl+R', onClick: a.fillRight },
        { label: 'Clear contents', icon: faEraser, shortcut: 'Del', onClick: () => a.clear('contents') },
        { label: 'Clear formatting', onClick: () => a.clear('formats') },
        { label: 'Clear all', onClick: () => a.clear('all') },
        'divider',
        { label: 'Select all', shortcut: 'Ctrl+A', onClick: a.selectAll },
        { label: 'Find and replace', icon: faMagnifyingGlass, shortcut: 'Ctrl+H', onClick: () => a.find(true) },
      ],
    },
    {
      label: 'View',
      items: [
        {
          label: 'Freeze',
          icon: faSnowflake,
          items: [
            { label: 'No rows or columns', checked: !fr && !fc, onClick: () => a.freeze(0, 0) },
            { label: '1 row', checked: fr === 1 && !fc, onClick: () => a.freeze(1, fc) },
            { label: '2 rows', checked: fr === 2, onClick: () => a.freeze(2, fc) },
            { label: `Up to row ${active.r}`, hidden: active.r < 3 || active.r > 50, onClick: () => a.freeze(active.r, fc) },
            'divider',
            { label: '1 column', checked: fc === 1, onClick: () => a.freeze(fr, 1) },
            { label: '2 columns', checked: fc === 2, onClick: () => a.freeze(fr, 2) },
            { label: `Up to column ${colName(active.c - 1)}`, hidden: active.c < 3 || active.c > 20, onClick: () => a.freeze(fr, active.c) },
            'divider',
            { label: 'Freeze panes at the selected cell', onClick: a.freezeHere },
          ],
        },
        { label: 'Gridlines', icon: faTableCells, checked: a.gridlines, onClick: a.toggleGridlines },
        { label: 'Zoom', icon: faExpand, items: ZOOMS.map((z) => ({ label: `${z}%`, checked: z === a.zoom, onClick: () => a.setZoom(z) })) },
      ],
    },
    {
      label: 'Insert',
      items: [
        { label: 'Row above', onClick: () => a.insertRows('above') },
        { label: 'Row below', onClick: () => a.insertRows('below') },
        { label: 'Column left', onClick: () => a.insertCols('left') },
        { label: 'Column right', onClick: () => a.insertCols('right') },
        { label: 'Sheet', icon: faSquarePlus, onClick: a.addSheet },
        'divider',
        {
          label: 'Function',
          icon: faCalculator,
          items: FUNCTION_GROUPS.map((g) => ({ label: g.label, items: g.names.map((n) => ({ label: n, onClick: () => a.insertFunction(n) })) })),
        },
        { label: 'Today\'s date', icon: faCalendarDay, shortcut: 'Ctrl+;', onClick: a.insertDate },
        { label: 'Current time', icon: faClock, shortcut: 'Ctrl+Shift+:', onClick: a.insertTime },
      ],
    },
    {
      label: 'Format',
      items: [
        {
          label: 'Number',
          items: NUMBER_FORMATS.map((f) => ({ label: `${f.label}  ·  ${f.sample}`, checked: (style.fmt ?? 'general') === f.id, onClick: () => a.setNumberFormat(f.id) })),
        },
        { label: 'Add decimal place', onClick: () => a.changeDecimals(1) },
        { label: 'Remove decimal place', onClick: () => a.changeDecimals(-1) },
        'divider',
        { label: 'Bold', icon: faBold, shortcut: 'Ctrl+B', checked: style.b, onClick: () => a.toggle('b') },
        { label: 'Italic', icon: faItalic, shortcut: 'Ctrl+I', checked: style.i, onClick: () => a.toggle('i') },
        { label: 'Underline', icon: faUnderline, shortcut: 'Ctrl+U', checked: style.u, onClick: () => a.toggle('u') },
        { label: 'Strikethrough', icon: faStrikethrough, shortcut: 'Ctrl+5', checked: style.s, onClick: () => a.toggle('s') },
        'divider',
        {
          label: 'Align',
          items: [
            { label: 'Left', icon: faAlignLeft, checked: style.h === 'left', onClick: () => a.setStyle('h', 'left') },
            { label: 'Center', icon: faAlignCenter, checked: style.h === 'center', onClick: () => a.setStyle('h', 'center') },
            { label: 'Right', icon: faAlignRight, checked: style.h === 'right', onClick: () => a.setStyle('h', 'right') },
            { label: 'Automatic', checked: !style.h, onClick: () => a.setStyle('h', null) },
            'divider',
            { label: 'Top', checked: style.v === 'top', onClick: () => a.setStyle('v', 'top') },
            { label: 'Middle', checked: style.v === 'middle', onClick: () => a.setStyle('v', 'middle') },
            { label: 'Bottom', checked: !style.v, onClick: () => a.setStyle('v', null) },
          ],
        },
        { label: 'Wrap text', checked: style.wrap, onClick: () => a.toggle('wrap') },
        {
          label: 'Borders',
          icon: faBorderAll,
          items: [
            { label: 'All borders', onClick: () => a.borders('all') },
            { label: 'Outside borders', onClick: () => a.borders('outer') },
            { label: 'Inside borders', onClick: () => a.borders('inner') },
            { label: 'Top border', onClick: () => a.borders('top') },
            { label: 'Bottom border', onClick: () => a.borders('bottom') },
            { label: 'Left border', onClick: () => a.borders('left') },
            { label: 'Right border', onClick: () => a.borders('right') },
            { label: 'No borders', onClick: () => a.borders('none') },
          ],
        },
        'divider',
        { label: 'Column width…', icon: faTextWidth, onClick: a.colWidth },
        { label: 'Fit column width to contents', onClick: a.autoFitCols },
        { label: 'Row height…', icon: faTextHeight, onClick: a.rowHeight },
        'divider',
        { label: 'Clear formatting', icon: faEraser, onClick: a.clearFormatting },
      ],
    },
    {
      label: 'Data',
      items: [
        { label: 'Sort A → Z', icon: faArrowDownAZ, onClick: () => a.sort(true) },
        { label: 'Sort Z → A', icon: faArrowUpAZ, onClick: () => a.sort(false) },
        'divider',
        { label: 'AutoSum (Σ)', icon: faCalculator, shortcut: 'Alt+=', onClick: () => a.autoSum('SUM') },
      ],
    },
  ];

  return (
    <nav className="doc-menubar" aria-label="Menu">
      {menus.map((m) => <DropMenu key={m.label} label={m.label} items={m.items} buttonClass="doc-menubar-btn" />)}
    </nav>
  );
}
