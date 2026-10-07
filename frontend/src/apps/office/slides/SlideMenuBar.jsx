import {
  faFileCirclePlus, faCopy, faDownload, faPrint, faTrashCan, faFolderOpen, faRotateLeft, faRotateRight, faScissors,
  faClipboard, faFilePowerpoint, faFilePdf, faBold, faItalic, faUnderline, faStrikethrough, faAlignLeft, faAlignCenter,
  faAlignRight, faAlignJustify, faListUl, faListOl, faPlay, faFont, faImage, faShapes, faClone, faArrowUp, faArrowDown,
  faPalette, faNoteSticky, faObjectGroup, faObjectUngroup, faLock, faLockOpen, faTable, faChartColumn, faIcons, faLink,
  faFileImport, faDisplay, faTableCells, faMagnifyingGlassPlus, faMagnifyingGlassMinus, faEyeSlash, faWandMagicSparkles,
  faHashtag, faRotate, faLayerGroup,
} from '@fortawesome/free-solid-svg-icons';
import { DropMenu } from '../docs/ui';
import { sourceItem } from '../filesPicker';
import {
  ANIMATIONS, CHARTS, LAYOUTS, SHAPES, SIZES, SPACINGS, THEMES, TRANSITIONS,
} from './model';

const OPACITIES = [1, 0.9, 0.75, 0.5, 0.25];

// PowerPoint / Impress-style menus. Everything they do comes in through `a` (the editor's actions).
export default function SlideMenuBar({ a, deck, sel }) {
  const { style, any, text, many, table, image } = sel;
  const slide = deck.slides[deck.active];
  const menus = [
    {
      label: 'File',
      items: [
        { label: 'New presentation', icon: faFileCirclePlus, onClick: a.newPresentation },
        { label: 'Open…', icon: faFolderOpen, onClick: a.openOffice },
        { label: 'Make a copy', icon: faCopy, onClick: a.copyDoc },
        'divider',
        sourceItem({ label: 'Open PowerPoint file', icon: faFileImport, computer: a.importPptx, files: a.importPptxFromFiles }),
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
        { label: 'Cut', icon: faScissors, shortcut: 'Ctrl+X', disabled: !any, onClick: a.cut },
        { label: 'Copy', icon: faCopy, shortcut: 'Ctrl+C', disabled: !any, onClick: a.copy },
        { label: 'Paste', icon: faClipboard, shortcut: 'Ctrl+V', disabled: !a.canPaste, onClick: a.paste },
        { label: 'Duplicate', icon: faClone, shortcut: 'Ctrl+D', disabled: !any, onClick: a.duplicate },
        { label: 'Delete', icon: faTrashCan, shortcut: 'Del', disabled: !any, onClick: a.deleteSelection },
        'divider',
        { label: 'Select all', shortcut: 'Ctrl+A', onClick: a.selectAll },
      ],
    },
    {
      label: 'View',
      items: [
        { label: 'Normal', checked: a.view === 'normal', onClick: () => a.setView('normal') },
        { label: 'Slide sorter', icon: faTableCells, checked: a.view === 'sorter', onClick: () => a.setView('sorter') },
        'divider',
        { label: 'Zoom in', icon: faMagnifyingGlassPlus, shortcut: 'Ctrl+=', onClick: () => a.zoomBy(1) },
        { label: 'Zoom out', icon: faMagnifyingGlassMinus, shortcut: 'Ctrl+-', onClick: () => a.zoomBy(-1) },
        { label: 'Fit to window', shortcut: 'Ctrl+0', onClick: () => a.setZoom(1) },
        'divider',
        { label: 'Speaker notes', icon: faNoteSticky, checked: a.showNotes, onClick: a.toggleNotes },
        'divider',
        { label: 'Present from the beginning', icon: faPlay, shortcut: 'F5', onClick: () => a.present(0) },
        { label: 'Present from this slide', shortcut: 'Shift+F5', onClick: () => a.present(deck.active) },
        { label: 'Presenter view', icon: faDisplay, shortcut: 'Alt+F5', onClick: () => a.present(deck.active, true) },
      ],
    },
    {
      label: 'Insert',
      items: [
        { label: 'New slide', icon: faFileCirclePlus, items: LAYOUTS.map((l) => ({ label: l.label, onClick: () => a.newSlide(l.id) })) },
        'divider',
        { label: 'Text box', icon: faFont, onClick: a.insertText },
        sourceItem({ label: 'Image', icon: faImage, computer: a.insertImage, files: a.insertImageFromFiles }),
        { label: 'Shape', icon: faShapes, items: SHAPES.map((s) => ({ label: s.label, onClick: () => a.insertShape(s.id) })) },
        { label: 'Table', icon: faTable, items: [[2, 2], [3, 3], [4, 3], [4, 4], [5, 4], [6, 5]].map(([r, c]) => ({ label: `${c} × ${r}`, onClick: () => a.insertTable(r, c) })) },
        { label: 'Chart', icon: faChartColumn, items: CHARTS.map((c) => ({ label: c.label, onClick: () => a.insertChart(c.id) })) },
        { label: 'Icon…', icon: faIcons, onClick: a.insertIcon },
        'divider',
        { label: 'Link…', icon: faLink, shortcut: 'Ctrl+K', disabled: !any, onClick: a.editLink },
        { label: 'Slide number and footer…', icon: faHashtag, onClick: a.editFooter },
      ],
    },
    {
      label: 'Format',
      items: [
        { label: 'Bold', icon: faBold, shortcut: 'Ctrl+B', checked: style.b, disabled: !text, onClick: () => a.toggle('b') },
        { label: 'Italic', icon: faItalic, shortcut: 'Ctrl+I', checked: style.i, disabled: !text, onClick: () => a.toggle('i') },
        { label: 'Underline', icon: faUnderline, shortcut: 'Ctrl+U', checked: style.u, disabled: !text, onClick: () => a.toggle('u') },
        { label: 'Strikethrough', icon: faStrikethrough, checked: style.s, disabled: !text, onClick: () => a.toggle('s') },
        { label: 'Bigger text', shortcut: 'Ctrl+]', disabled: !text, onClick: () => a.growText(1) },
        { label: 'Smaller text', shortcut: 'Ctrl+[', disabled: !text, onClick: () => a.growText(-1) },
        'divider',
        {
          label: 'Align text',
          disabled: !text,
          items: [
            { label: 'Left', icon: faAlignLeft, checked: (style.align ?? 'left') === 'left', onClick: () => a.setStyle('align', null) },
            { label: 'Center', icon: faAlignCenter, checked: style.align === 'center', onClick: () => a.setStyle('align', 'center') },
            { label: 'Right', icon: faAlignRight, checked: style.align === 'right', onClick: () => a.setStyle('align', 'right') },
            { label: 'Justify', icon: faAlignJustify, checked: style.align === 'justify', onClick: () => a.setStyle('align', 'justify') },
          ],
        },
        { label: 'Line spacing', disabled: !text, items: SPACINGS.map((s) => ({ label: String(s), checked: (style.spacing ?? 1) === s, onClick: () => a.setStyle('spacing', s === 1 ? null : s) })) },
        { label: 'Bullets', icon: faListUl, checked: style.list === 'bullet', disabled: !text, onClick: () => a.setStyle('list', style.list === 'bullet' ? null : 'bullet') },
        { label: 'Numbering', icon: faListOl, checked: style.list === 'number', disabled: !text, onClick: () => a.setStyle('list', style.list === 'number' ? null : 'number') },
        'divider',
        { label: 'Transparency', disabled: !any, items: OPACITIES.map((o) => ({ label: o === 1 ? 'None' : `${Math.round((1 - o) * 100)}%`, checked: (sel.opacity ?? 1) === o, onClick: () => a.setProp('opacity', o === 1 ? undefined : o) })) },
        { label: 'Shadow', checked: sel.shadow, disabled: !any, onClick: () => a.setProp('shadow', sel.shadow ? undefined : true) },
        { label: 'Rounded corners', disabled: !image, items: [[0, 'None'], [5, 'Small'], [15, 'Medium'], [50, 'Round']].map(([r, label]) => ({ label, checked: (sel.radius ?? 0) === r, onClick: () => a.setProp('radius', r || undefined, 'image') })) },
        {
          label: 'Rotate',
          icon: faRotate,
          disabled: !any,
          items: [
            { label: 'Rotate right 90°', onClick: () => a.rotateBy(90) },
            { label: 'Rotate left 90°', onClick: () => a.rotateBy(-90) },
            { label: 'Flip horizontal', onClick: () => a.flip('flipH') },
            { label: 'Flip vertical', onClick: () => a.flip('flipV') },
            { label: 'Reset rotation', onClick: () => a.setProp('rotation', undefined) },
          ],
        },
        'divider',
        {
          label: 'Animation',
          icon: faWandMagicSparkles,
          disabled: !any,
          items: [
            { label: 'None', checked: !sel.anim, onClick: () => a.setAnimation(null) },
            ...ANIMATIONS.map((an) => ({ label: an.label, checked: sel.anim === an.id, onClick: () => a.setAnimation(an.id) })),
          ],
        },
        {
          label: 'Table',
          icon: faTable,
          disabled: !table,
          items: [
            { label: 'Insert row above', onClick: () => a.tableOp('rowAbove') },
            { label: 'Insert row below', onClick: () => a.tableOp('rowBelow') },
            { label: 'Insert column left', onClick: () => a.tableOp('colLeft') },
            { label: 'Insert column right', onClick: () => a.tableOp('colRight') },
            'divider',
            { label: 'Delete row', onClick: () => a.tableOp('deleteRow') },
            { label: 'Delete column', onClick: () => a.tableOp('deleteCol') },
            'divider',
            { label: 'Header row', checked: sel.header, onClick: () => a.tableOp('header') },
          ],
        },
      ],
    },
    {
      label: 'Arrange',
      items: [
        { label: 'Bring to front', onClick: () => a.arrange('front'), disabled: !any },
        { label: 'Bring forward', onClick: () => a.arrange('forward'), disabled: !any },
        { label: 'Send backward', onClick: () => a.arrange('backward'), disabled: !any },
        { label: 'Send to back', onClick: () => a.arrange('back'), disabled: !any },
        'divider',
        {
          label: many ? 'Align' : 'Align to slide',
          disabled: !any,
          items: [
            { label: 'Left', onClick: () => a.align('left') },
            { label: 'Center', onClick: () => a.align('center') },
            { label: 'Right', onClick: () => a.align('right') },
            'divider',
            { label: 'Top', onClick: () => a.align('top') },
            { label: 'Middle', onClick: () => a.align('middle') },
            { label: 'Bottom', onClick: () => a.align('bottom') },
          ],
        },
        { label: 'Distribute horizontally', disabled: sel.count < 3, onClick: () => a.distribute('x') },
        { label: 'Distribute vertically', disabled: sel.count < 3, onClick: () => a.distribute('y') },
        'divider',
        { label: 'Group', icon: faObjectGroup, shortcut: 'Ctrl+G', disabled: !many, onClick: a.group },
        { label: 'Ungroup', icon: faObjectUngroup, shortcut: 'Ctrl+Shift+G', disabled: !sel.grouped, onClick: a.ungroup },
        'divider',
        { label: sel.locked ? 'Unlock' : 'Lock', icon: sel.locked ? faLockOpen : faLock, disabled: !any, onClick: a.toggleLock },
      ],
    },
    {
      label: 'Slide',
      items: [
        { label: 'New slide', icon: faFileCirclePlus, shortcut: 'Ctrl+M', onClick: () => a.newSlide('content') },
        { label: 'Duplicate slide', icon: faClone, onClick: a.duplicateSlide },
        { label: 'Delete slide', icon: faTrashCan, disabled: deck.slides.length < 2, onClick: a.deleteSlide },
        { label: slide.hidden ? 'Show slide' : 'Hide slide', icon: faEyeSlash, onClick: a.toggleHidden },
        'divider',
        { label: 'Move slide up', icon: faArrowUp, disabled: deck.active === 0, onClick: () => a.moveSlide(-1) },
        { label: 'Move slide down', icon: faArrowDown, disabled: deck.active === deck.slides.length - 1, onClick: () => a.moveSlide(1) },
        'divider',
        {
          label: 'Transition',
          icon: faLayerGroup,
          items: [
            ...TRANSITIONS.map((t) => ({ label: t.label, checked: (slide.transition ?? 'none') === t.id, onClick: () => a.setTransition(t.id) })),
            'divider',
            { label: 'Apply to all slides', onClick: a.transitionToAll },
          ],
        },
        { label: 'Background…', icon: faPalette, onClick: a.backgroundColor },
        { label: 'Reset background', onClick: a.resetBackground },
      ],
    },
    {
      label: 'Design',
      items: [
        { label: 'Theme', icon: faPalette, items: Object.entries(THEMES).map(([id, t]) => ({ label: t.label, checked: deck.theme === id, onClick: () => a.setTheme(id) })) },
        { label: 'Slide size', items: Object.entries(SIZES).map(([id, s]) => ({ label: s.label, checked: deck.size === id, onClick: () => a.setSize(id) })) },
        { label: 'Slide number and footer…', icon: faHashtag, onClick: a.editFooter },
      ],
    },
  ];

  return (
    <nav className="doc-menubar" aria-label="Menu">
      {menus.map((m) => <DropMenu key={m.label} label={m.label} items={m.items} buttonClass="doc-menubar-btn" />)}
    </nav>
  );
}
