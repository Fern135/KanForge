import {
  faFileCirclePlus, faCopy, faDownload, faPrint, faTrashCan, faFolderOpen, faRotateLeft, faRotateRight, faScissors,
  faClipboard, faFilePowerpoint, faFilePdf, faBold, faItalic, faUnderline, faAlignLeft, faAlignCenter, faAlignRight,
  faAlignJustify, faListUl, faListOl, faPlay, faFont, faImage, faShapes, faClone, faArrowUp, faArrowDown, faPalette,
  faNoteSticky, faObjectGroup,
} from '@fortawesome/free-solid-svg-icons';
import { DropMenu } from '../docs/ui';
import { LAYOUTS, SHAPES, SIZES, THEMES } from './model';

// PowerPoint / Impress-style menus. Everything they do comes in through `a` (the editor's actions).
export default function SlideMenuBar({ a, deck, style, hasSelection, hasText }) {
  const menus = [
    {
      label: 'File',
      items: [
        { label: 'New presentation', icon: faFileCirclePlus, onClick: a.newPresentation },
        { label: 'Open…', icon: faFolderOpen, onClick: a.openOffice },
        { label: 'Make a copy', icon: faCopy, onClick: a.copyDoc },
        'divider',
        {
          label: 'Download',
          icon: faDownload,
          items: [
            { label: 'PowerPoint (.pptx)', icon: faFilePowerpoint, onClick: a.downloadPptx },
            { label: 'PDF (.pdf)', icon: faFilePdf, onClick: a.downloadPdf },
          ],
        },
        'divider',
        { label: 'Move to folder…', icon: faFolderOpen, onClick: a.move },
        { label: 'Print', icon: faPrint, shortcut: 'Ctrl+P', onClick: a.print },
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
        { label: 'Cut', icon: faScissors, shortcut: 'Ctrl+X', disabled: !hasSelection, onClick: a.cut },
        { label: 'Copy', icon: faCopy, shortcut: 'Ctrl+C', disabled: !hasSelection, onClick: a.copy },
        { label: 'Paste', icon: faClipboard, shortcut: 'Ctrl+V', disabled: !a.canPaste, onClick: a.paste },
        { label: 'Duplicate', icon: faClone, shortcut: 'Ctrl+D', disabled: !hasSelection, onClick: a.duplicate },
        { label: 'Delete', icon: faTrashCan, shortcut: 'Del', disabled: !hasSelection, onClick: a.deleteSelection },
        'divider',
        { label: 'Select all', shortcut: 'Ctrl+A', onClick: a.selectAll },
      ],
    },
    {
      label: 'View',
      items: [
        { label: 'Present from the beginning', icon: faPlay, shortcut: 'F5', onClick: () => a.present(0) },
        { label: 'Present from this slide', shortcut: 'Shift+F5', onClick: () => a.present(deck.active) },
        'divider',
        { label: 'Speaker notes', icon: faNoteSticky, checked: a.showNotes, onClick: a.toggleNotes },
      ],
    },
    {
      label: 'Insert',
      items: [
        {
          label: 'New slide',
          icon: faFileCirclePlus,
          items: LAYOUTS.map((l) => ({ label: l.label, onClick: () => a.newSlide(l.id) })),
        },
        'divider',
        { label: 'Text box', icon: faFont, onClick: a.insertText },
        { label: 'Image…', icon: faImage, onClick: a.insertImage },
        {
          label: 'Shape',
          icon: faShapes,
          items: SHAPES.map((s) => ({ label: s.label, onClick: () => a.insertShape(s.id) })),
        },
      ],
    },
    {
      label: 'Format',
      items: [
        { label: 'Bold', icon: faBold, shortcut: 'Ctrl+B', checked: style.b, disabled: !hasText, onClick: () => a.toggle('b') },
        { label: 'Italic', icon: faItalic, shortcut: 'Ctrl+I', checked: style.i, disabled: !hasText, onClick: () => a.toggle('i') },
        { label: 'Underline', icon: faUnderline, shortcut: 'Ctrl+U', checked: style.u, disabled: !hasText, onClick: () => a.toggle('u') },
        { label: 'Bigger text', shortcut: 'Ctrl+]', disabled: !hasText, onClick: () => a.growText(1) },
        { label: 'Smaller text', shortcut: 'Ctrl+[', disabled: !hasText, onClick: () => a.growText(-1) },
        'divider',
        {
          label: 'Align',
          disabled: !hasText,
          items: [
            { label: 'Left', icon: faAlignLeft, checked: (style.align ?? 'left') === 'left', onClick: () => a.setStyle('align', null) },
            { label: 'Center', icon: faAlignCenter, checked: style.align === 'center', onClick: () => a.setStyle('align', 'center') },
            { label: 'Right', icon: faAlignRight, checked: style.align === 'right', onClick: () => a.setStyle('align', 'right') },
            { label: 'Justify', icon: faAlignJustify, checked: style.align === 'justify', onClick: () => a.setStyle('align', 'justify') },
          ],
        },
        { label: 'Bullets', icon: faListUl, checked: style.list === 'bullet', disabled: !hasText, onClick: () => a.setStyle('list', style.list === 'bullet' ? null : 'bullet') },
        { label: 'Numbering', icon: faListOl, checked: style.list === 'number', disabled: !hasText, onClick: () => a.setStyle('list', style.list === 'number' ? null : 'number') },
        'divider',
        {
          label: 'Arrange',
          icon: faObjectGroup,
          disabled: !hasSelection,
          items: [
            { label: 'Bring to front', onClick: () => a.arrange('front') },
            { label: 'Bring forward', onClick: () => a.arrange('forward') },
            { label: 'Send backward', onClick: () => a.arrange('backward') },
            { label: 'Send to back', onClick: () => a.arrange('back') },
          ],
        },
      ],
    },
    {
      label: 'Slide',
      items: [
        { label: 'New slide', icon: faFileCirclePlus, shortcut: 'Ctrl+M', onClick: () => a.newSlide('content') },
        { label: 'Duplicate slide', icon: faClone, onClick: a.duplicateSlide },
        { label: 'Delete slide', icon: faTrashCan, disabled: deck.slides.length < 2, onClick: a.deleteSlide },
        'divider',
        { label: 'Move slide up', icon: faArrowUp, disabled: deck.active === 0, onClick: () => a.moveSlide(-1) },
        { label: 'Move slide down', icon: faArrowDown, disabled: deck.active === deck.slides.length - 1, onClick: () => a.moveSlide(1) },
        'divider',
        { label: 'Background color…', icon: faPalette, onClick: a.backgroundColor },
        { label: 'Reset background', onClick: () => a.setBackground(null) },
      ],
    },
    {
      label: 'Design',
      items: [
        {
          label: 'Theme',
          icon: faPalette,
          items: Object.entries(THEMES).map(([id, t]) => ({ label: t.label, checked: deck.theme === id, onClick: () => a.setTheme(id) })),
        },
        {
          label: 'Slide size',
          items: Object.entries(SIZES).map(([id, s]) => ({ label: s.label, checked: deck.size === id, onClick: () => a.setSize(id) })),
        },
      ],
    },
  ];

  return (
    <nav className="doc-menubar" aria-label="Menu">
      {menus.map((m) => <DropMenu key={m.label} label={m.label} items={m.items} buttonClass="doc-menubar-btn" />)}
    </nav>
  );
}
