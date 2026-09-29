import { useEffect, useState } from 'react';
import { useEditorState } from '@tiptap/react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faRotateLeft, faRotateRight, faPrint, faBold, faItalic, faUnderline, faStrikethrough, faSuperscript, faSubscript,
  faHighlighter, faEraser, faAlignLeft, faAlignCenter, faAlignRight, faAlignJustify, faListUl, faListOl, faOutdent,
  faIndent, faLink, faImage, faTable, faFileLines, faTextHeight, faFont,
} from '@fortawesome/free-solid-svg-icons';
import { DropMenu, ToolButton, ColorGrid, TableGrid } from './ui';
import { FONTS, SIZES, LINE_SPACINGS, DEFAULT_FONT, DEFAULT_SIZE, fontLabel } from './fonts';

// Default sizes of the built-in styles (pt), as in Word's Normal template.
const STYLE_SIZES = { 1: 16, 2: 13, 3: 12, 4: 11 };

export const STYLES = [
  { id: 'normal', label: 'Normal', preview: { fontSize: '13px' } },
  { id: 'h1', label: 'Heading 1', level: 1, preview: { fontSize: '19px', color: '#2f5496' } },
  { id: 'h2', label: 'Heading 2', level: 2, preview: { fontSize: '16px', color: '#2f5496' } },
  { id: 'h3', label: 'Heading 3', level: 3, preview: { fontSize: '14px', color: '#1f3864' } },
  { id: 'h4', label: 'Heading 4', level: 4, preview: { fontSize: '13px', color: '#2f5496', fontStyle: 'italic' } },
  { id: 'quote', label: 'Quote', preview: { fontSize: '13px', fontStyle: 'italic', color: '#404040' } },
];

export function applyStyle(editor, id) {
  const chain = editor.chain().focus();
  if (editor.isActive('blockquote') && id !== 'quote') chain.lift('blockquote');
  const style = STYLES.find((s) => s.id === id);
  if (style?.level) chain.setHeading({ level: style.level });
  else if (id === 'quote') chain.setParagraph().setBlockquote();
  else chain.setParagraph();
  chain.run();
}

// Line spacing applies to whole paragraphs, like Word, so the selection is
// widened to the paragraphs it touches first.
export function setLineSpacing(editor, value) {
  const { from, to } = editor.state.selection;
  const start = editor.state.doc.resolve(from).start();
  const end = editor.state.doc.resolve(to).end();
  editor.chain().focus().setTextSelection({ from: start, to: end }).setLineHeight(value).setTextSelection({ from, to }).run();
}

export function changeFontSize(editor, direction) {
  const current = parseFloat(editor.getAttributes('textStyle').fontSize) || DEFAULT_SIZE;
  const next = direction > 0 ? SIZES.find((s) => s > current) : [...SIZES].reverse().find((s) => s < current);
  if (next) editor.chain().focus().setFontSize(`${next}pt`).run();
}

function FontSizeBox({ editor, size }) {
  const [value, setValue] = useState(String(size));
  useEffect(() => setValue(String(size)), [size]);
  const apply = () => {
    const n = parseFloat(value);
    if (n >= 1 && n <= 400) editor.chain().focus().setFontSize(`${Math.round(n * 2) / 2}pt`).run();
    else setValue(String(size));
  };
  return (
    <div className="doc-size-box">
      <input value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, '').slice(0, 5))}
        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), apply())} onBlur={apply} aria-label="Font size" title="Font size" />
      <DropMenu title="Font sizes" buttonClass="doc-size-caret" caret
        items={SIZES.map((s) => ({ label: String(s), checked: s === size, onClick: () => editor.chain().focus().setFontSize(`${s}pt`).run() }))} />
    </div>
  );
}

export default function Toolbar({ editor, actions }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const style = e.getAttributes('textStyle');
      const level = [1, 2, 3, 4].find((l) => e.isActive('heading', { level: l }));
      return {
        font: style.fontFamily || DEFAULT_FONT.value,
        size: parseFloat(style.fontSize) || (level ? STYLE_SIZES[level] : DEFAULT_SIZE),
        color: style.color || null,
        style: level ? `h${level}` : e.isActive('blockquote') ? 'quote' : 'normal',
        bold: e.isActive('bold'),
        italic: e.isActive('italic'),
        underline: e.isActive('underline'),
        strike: e.isActive('strike'),
        sup: e.isActive('superscript'),
        sub: e.isActive('subscript'),
        align: ['center', 'right', 'justify'].find((a) => e.isActive({ textAlign: a })) || 'left',
        bullet: e.isActive('bulletList'),
        ordered: e.isActive('orderedList'),
        inList: e.isActive('listItem'),
        link: e.isActive('link'),
        canUndo: e.can().undo(),
        canRedo: e.can().redo(),
        canSink: e.can().sinkListItem('listItem'),
        canLift: e.can().liftListItem('listItem'),
      };
    },
  });
  const run = (fn) => () => fn(editor.chain().focus()).run();
  const styleLabel = STYLES.find((x) => x.id === s.style)?.label;

  return (
    <div className="doc-toolbar" role="toolbar" aria-label="Formatting">
      <div className="doc-tool-group">
        <ToolButton label="Undo" shortcut="Ctrl+Z" disabled={!s.canUndo} onClick={run((c) => c.undo())}><FontAwesomeIcon icon={faRotateLeft} /></ToolButton>
        <ToolButton label="Redo" shortcut="Ctrl+Y" disabled={!s.canRedo} onClick={run((c) => c.redo())}><FontAwesomeIcon icon={faRotateRight} /></ToolButton>
        <ToolButton label="Print" shortcut="Ctrl+P" onClick={actions.print}><FontAwesomeIcon icon={faPrint} /></ToolButton>
      </div>

      <div className="doc-tool-group">
        <DropMenu title="Styles" buttonClass="doc-select doc-select-style" caret
          items={STYLES.map((st) => ({ label: st.label, style: st.preview, checked: st.id === s.style, onClick: () => applyStyle(editor, st.id) }))}>
          {styleLabel}
        </DropMenu>
        <DropMenu title="Font" buttonClass="doc-select doc-select-font" caret
          items={FONTS.map((f) => ({ label: f.label, style: { fontFamily: f.value }, checked: f.value === s.font, onClick: () => editor.chain().focus().setFontFamily(f.value).run() }))}>
          <span style={{ fontFamily: s.font }}>{fontLabel(s.font)}</span>
        </DropMenu>
        <FontSizeBox editor={editor} size={s.size} />
        <ToolButton label="Grow font" shortcut="Ctrl+]" onClick={() => changeFontSize(editor, 1)}><span className="doc-grow">A<sup>▲</sup></span></ToolButton>
        <ToolButton label="Shrink font" shortcut="Ctrl+[" onClick={() => changeFontSize(editor, -1)}><span className="doc-grow small">A<sup>▼</sup></span></ToolButton>
      </div>

      <div className="doc-tool-group">
        <ToolButton label="Bold" shortcut="Ctrl+B" active={s.bold} onClick={run((c) => c.toggleBold())}><FontAwesomeIcon icon={faBold} /></ToolButton>
        <ToolButton label="Italic" shortcut="Ctrl+I" active={s.italic} onClick={run((c) => c.toggleItalic())}><FontAwesomeIcon icon={faItalic} /></ToolButton>
        <ToolButton label="Underline" shortcut="Ctrl+U" active={s.underline} onClick={run((c) => c.toggleUnderline())}><FontAwesomeIcon icon={faUnderline} /></ToolButton>
        <ToolButton label="Strikethrough" active={s.strike} onClick={run((c) => c.toggleStrike())}><FontAwesomeIcon icon={faStrikethrough} /></ToolButton>
        <ToolButton label="Superscript" shortcut="Ctrl+." active={s.sup} onClick={run((c) => c.unsetSubscript().toggleSuperscript())}><FontAwesomeIcon icon={faSuperscript} /></ToolButton>
        <ToolButton label="Subscript" shortcut="Ctrl+," active={s.sub} onClick={run((c) => c.unsetSuperscript().toggleSubscript())}><FontAwesomeIcon icon={faSubscript} /></ToolButton>
        <DropMenu title="Font color" buttonClass="doc-tool doc-color-btn"
          render={(close) => <ColorGrid close={close} resetLabel="Automatic" onPick={(c) => (c ? editor.chain().focus().setColor(c).run() : editor.chain().focus().unsetColor().run())} />}>
          <span className="doc-color-a"><FontAwesomeIcon icon={faFont} /><span className="doc-color-bar" style={{ background: s.color || '#c00000' }} /></span>
        </DropMenu>
        <DropMenu title="Highlight color" buttonClass="doc-tool doc-color-btn"
          render={(close) => <ColorGrid close={close} resetLabel="No color" onPick={(c) => (c ? editor.chain().focus().setHighlight({ color: c }).run() : editor.chain().focus().unsetHighlight().run())} />}>
          <FontAwesomeIcon icon={faHighlighter} />
        </DropMenu>
        <ToolButton label="Clear formatting" onClick={actions.clearFormatting}><FontAwesomeIcon icon={faEraser} /></ToolButton>
      </div>

      <div className="doc-tool-group">
        {[['left', faAlignLeft, 'Ctrl+Shift+L'], ['center', faAlignCenter, 'Ctrl+Shift+E'], ['right', faAlignRight, 'Ctrl+Shift+R'], ['justify', faAlignJustify, 'Ctrl+Shift+J']].map(([a, icon, key]) => (
          <ToolButton key={a} label={`Align ${a}`} shortcut={key} active={s.align === a} onClick={run((c) => c.setTextAlign(a))}><FontAwesomeIcon icon={icon} /></ToolButton>
        ))}
        <DropMenu title="Line spacing" buttonClass="doc-tool" icon={faTextHeight}
          items={LINE_SPACINGS.map((v) => ({ label: v, onClick: () => setLineSpacing(editor, v) }))} />
      </div>

      <div className="doc-tool-group">
        <ToolButton label="Bullets" shortcut="Ctrl+Shift+8" active={s.bullet} onClick={run((c) => c.toggleBulletList())}><FontAwesomeIcon icon={faListUl} /></ToolButton>
        <ToolButton label="Numbering" shortcut="Ctrl+Shift+7" active={s.ordered} onClick={run((c) => c.toggleOrderedList())}><FontAwesomeIcon icon={faListOl} /></ToolButton>
        <ToolButton label="Decrease indent" shortcut="Shift+Tab" disabled={!s.canLift} onClick={run((c) => c.liftListItem('listItem'))}><FontAwesomeIcon icon={faOutdent} /></ToolButton>
        <ToolButton label="Increase indent" shortcut="Tab" disabled={!s.canSink} onClick={run((c) => c.sinkListItem('listItem'))}><FontAwesomeIcon icon={faIndent} /></ToolButton>
      </div>

      <div className="doc-tool-group">
        <ToolButton label="Link" shortcut="Ctrl+K" active={s.link} onClick={actions.link}><FontAwesomeIcon icon={faLink} /></ToolButton>
        <ToolButton label="Picture" onClick={actions.image}><FontAwesomeIcon icon={faImage} /></ToolButton>
        <DropMenu title="Table" buttonClass="doc-tool" icon={faTable}
          render={(close) => <TableGrid close={close} onPick={(rows, cols) => editor.chain().focus().insertTable({ rows, cols, withHeaderRow: false }).run()} />} />
        <ToolButton label="Page break" shortcut="Ctrl+Enter" onClick={run((c) => c.setPageBreak())}><FontAwesomeIcon icon={faFileLines} /></ToolButton>
      </div>
    </div>
  );
}
