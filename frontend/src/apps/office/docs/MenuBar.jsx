import { useEditorState } from '@tiptap/react';
import {
  faFileCirclePlus, faCopy, faFileImport, faDownload, faPrint, faTrashCan, faFolderOpen, faRotateLeft, faRotateRight,
  faScissors, faClipboard, faMagnifyingGlass, faRuler, faImage, faLink, faTable, faFileLines, faMinus, faEraser,
  faBold, faItalic, faUnderline, faStrikethrough, faSuperscript, faSubscript, faAlignLeft, faAlignCenter,
  faAlignRight, faAlignJustify, faListUl, faListOl, faFileWord, faFilePdf, faFileLines as faText, faExpand,
} from '@fortawesome/free-solid-svg-icons';
import { DropMenu } from './ui';
import { sourceItem } from '../filesPicker';
import { STYLES, applyStyle, setLineSpacing } from './Toolbar';
import { LINE_SPACINGS } from './fonts';

const ZOOMS = [50, 75, 90, 100, 125, 150, 200];

// Word-style menus. Anything that needs the page (dialogs, files) comes in through `actions`.
export default function MenuBar({ editor, actions, zoom, showRuler }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
      inTable: e.isActive('table'),
      canMerge: e.can().mergeCells(),
      canSplit: e.can().splitCell(),
    }),
  });
  const c = () => editor.chain().focus();
  const table = (fn) => ({ disabled: !s.inTable, onClick: () => fn(c()).run() });

  const menus = [
    {
      label: 'File',
      items: [
        { label: 'New document', icon: faFileCirclePlus, onClick: actions.newDocument },
        { label: 'Open…', icon: faFolderOpen, onClick: actions.openOffice },
        { label: 'Make a copy', icon: faCopy, onClick: actions.copy },
        'divider',
        sourceItem({ label: 'Import Word document', icon: faFileImport, computer: actions.importDocx, files: actions.importDocxFromFiles }),
        {
          label: 'Download',
          icon: faDownload,
          items: [
            { label: 'Word document (.docx)', icon: faFileWord, onClick: actions.downloadDocx },
            { label: 'PDF (.pdf)', icon: faFilePdf, onClick: actions.downloadPdf },
            { label: 'Plain text (.txt)', icon: faText, onClick: actions.downloadText },
          ],
        },
        'divider',
        { label: 'Move to folder…', icon: faFolderOpen, onClick: actions.move },
        { label: 'Page setup…', onClick: actions.pageSetup },
        { label: 'Print', icon: faPrint, shortcut: 'Ctrl+P', onClick: actions.print },
        'divider',
        { label: 'Move to trash', icon: faTrashCan, onClick: actions.trash },
      ],
    },
    {
      label: 'Edit',
      items: [
        { label: 'Undo', icon: faRotateLeft, shortcut: 'Ctrl+Z', disabled: !s.canUndo, onClick: () => c().undo().run() },
        { label: 'Redo', icon: faRotateRight, shortcut: 'Ctrl+Y', disabled: !s.canRedo, onClick: () => c().redo().run() },
        'divider',
        { label: 'Cut', icon: faScissors, shortcut: 'Ctrl+X', onClick: () => { editor.commands.focus(); document.execCommand('cut'); } },
        { label: 'Copy', icon: faCopy, shortcut: 'Ctrl+C', onClick: () => { editor.commands.focus(); document.execCommand('copy'); } },
        { label: 'Paste', icon: faClipboard, shortcut: 'Ctrl+V', onClick: actions.pasteHint },
        { label: 'Select all', shortcut: 'Ctrl+A', onClick: () => c().selectAll().run() },
        'divider',
        { label: 'Find and replace', icon: faMagnifyingGlass, shortcut: 'Ctrl+H', onClick: actions.find },
      ],
    },
    {
      label: 'View',
      items: [
        { label: 'Ruler', icon: faRuler, checked: showRuler, onClick: actions.toggleRuler },
        { label: 'Zoom', icon: faExpand, items: ZOOMS.map((z) => ({ label: `${z}%`, checked: z === zoom, onClick: () => actions.setZoom(z) })) },
      ],
    },
    {
      label: 'Insert',
      items: [
        sourceItem({ label: 'Picture', icon: faImage, computer: actions.image, files: actions.imageFromFiles }),
        { label: 'Table', icon: faTable, onClick: () => c().insertTable({ rows: 3, cols: 3, withHeaderRow: false }).run() },
        { label: 'Link…', icon: faLink, shortcut: 'Ctrl+K', onClick: actions.link },
        'divider',
        { label: 'Page break', icon: faFileLines, shortcut: 'Ctrl+Enter', onClick: () => c().setPageBreak().run() },
        { label: 'Horizontal line', icon: faMinus, onClick: () => c().setHorizontalRule().run() },
      ],
    },
    {
      label: 'Format',
      items: [
        {
          label: 'Text',
          items: [
            { label: 'Bold', icon: faBold, shortcut: 'Ctrl+B', onClick: () => c().toggleBold().run() },
            { label: 'Italic', icon: faItalic, shortcut: 'Ctrl+I', onClick: () => c().toggleItalic().run() },
            { label: 'Underline', icon: faUnderline, shortcut: 'Ctrl+U', onClick: () => c().toggleUnderline().run() },
            { label: 'Strikethrough', icon: faStrikethrough, onClick: () => c().toggleStrike().run() },
            { label: 'Superscript', icon: faSuperscript, shortcut: 'Ctrl+.', onClick: () => c().unsetSubscript().toggleSuperscript().run() },
            { label: 'Subscript', icon: faSubscript, shortcut: 'Ctrl+,', onClick: () => c().unsetSuperscript().toggleSubscript().run() },
          ],
        },
        { label: 'Paragraph styles', items: STYLES.map((st) => ({ label: st.label, style: st.preview, onClick: () => applyStyle(editor, st.id) })) },
        {
          label: 'Align',
          items: [
            { label: 'Left', icon: faAlignLeft, shortcut: 'Ctrl+Shift+L', onClick: () => c().setTextAlign('left').run() },
            { label: 'Center', icon: faAlignCenter, shortcut: 'Ctrl+Shift+E', onClick: () => c().setTextAlign('center').run() },
            { label: 'Right', icon: faAlignRight, shortcut: 'Ctrl+Shift+R', onClick: () => c().setTextAlign('right').run() },
            { label: 'Justify', icon: faAlignJustify, shortcut: 'Ctrl+Shift+J', onClick: () => c().setTextAlign('justify').run() },
          ],
        },
        { label: 'Line spacing', items: LINE_SPACINGS.map((v) => ({ label: v, onClick: () => setLineSpacing(editor, v) })) },
        {
          label: 'Bullets and numbering',
          items: [
            { label: 'Bulleted list', icon: faListUl, shortcut: 'Ctrl+Shift+8', onClick: () => c().toggleBulletList().run() },
            { label: 'Numbered list', icon: faListOl, shortcut: 'Ctrl+Shift+7', onClick: () => c().toggleOrderedList().run() },
          ],
        },
        'divider',
        { label: 'Clear formatting', icon: faEraser, onClick: actions.clearFormatting },
      ],
    },
    {
      label: 'Table',
      items: [
        { label: 'Insert table', icon: faTable, onClick: () => c().insertTable({ rows: 3, cols: 3, withHeaderRow: false }).run() },
        'divider',
        { label: 'Insert row above', ...table((x) => x.addRowBefore()) },
        { label: 'Insert row below', ...table((x) => x.addRowAfter()) },
        { label: 'Insert column left', ...table((x) => x.addColumnBefore()) },
        { label: 'Insert column right', ...table((x) => x.addColumnAfter()) },
        'divider',
        { label: 'Merge cells', disabled: !s.canMerge, onClick: () => c().mergeCells().run() },
        { label: 'Split cell', disabled: !s.canSplit, onClick: () => c().splitCell().run() },
        { label: 'Header row', ...table((x) => x.toggleHeaderRow()) },
        'divider',
        { label: 'Delete row', ...table((x) => x.deleteRow()) },
        { label: 'Delete column', ...table((x) => x.deleteColumn()) },
        { label: 'Delete table', ...table((x) => x.deleteTable()) },
      ],
    },
  ];

  return (
    <nav className="doc-menubar" aria-label="Menu">
      {menus.map((m) => <DropMenu key={m.label} label={m.label} items={m.items} buttonClass="doc-menubar-btn" />)}
    </nav>
  );
}
