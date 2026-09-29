import { useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faRotateLeft, faRotateRight, faBold, faItalic, faUnderline, faFont, faFillDrip, faAlignLeft, faAlignCenter,
  faAlignRight, faAlignJustify, faListUl, faListOl, faImage, faShapes, faPlay, faFileCirclePlus, faPenNib,
} from '@fortawesome/free-solid-svg-icons';
import { DropMenu, ToolButton, ColorGrid } from '../docs/ui';
import { FONTS } from '../docs/fonts';
import { LAYOUTS, SHAPES } from './model';

const SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 72, 80, 96];
const fontLabel = (value) => FONTS.find((f) => f.value === value)?.label ?? 'Theme font';

function SizeBox({ size, disabled, onSet }) {
  const [value, setValue] = useState(String(size));
  useEffect(() => setValue(String(size)), [size]);
  const apply = () => {
    const n = parseFloat(value);
    if (n >= 6 && n <= 200) onSet(Math.round(n * 2) / 2);
    else setValue(String(size));
  };
  return (
    <div className="doc-size-box">
      <input value={value} disabled={disabled} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, '').slice(0, 5))}
        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), apply())} onBlur={apply} aria-label="Font size" title="Font size" />
      <DropMenu title="Font sizes" buttonClass="doc-size-caret" caret
        items={SIZES.map((s) => ({ label: String(s), checked: s === size, disabled, onClick: () => onSet(s) }))} />
    </div>
  );
}

// The formatting toolbar for the selected text boxes and shapes.
export default function SlideToolbar({ a, style, hasText, hasShape, themeFont }) {
  return (
    <div className="doc-toolbar" role="toolbar" aria-label="Formatting">
      <div className="doc-tool-group">
        <ToolButton label="Undo" shortcut="Ctrl+Z" disabled={!a.canUndo} onClick={a.undo}><FontAwesomeIcon icon={faRotateLeft} /></ToolButton>
        <ToolButton label="Redo" shortcut="Ctrl+Y" disabled={!a.canRedo} onClick={a.redo}><FontAwesomeIcon icon={faRotateRight} /></ToolButton>
      </div>

      <div className="doc-tool-group">
        <DropMenu title="New slide" buttonClass="doc-tool" caret
          items={LAYOUTS.map((l) => ({ label: l.label, onClick: () => a.newSlide(l.id) }))}>
          <FontAwesomeIcon icon={faFileCirclePlus} className="me-1" /><span className="d-none d-lg-inline">New slide</span>
        </DropMenu>
        <ToolButton label="Text box" onClick={a.insertText}><span className="slide-textbox-icon">A</span></ToolButton>
        <ToolButton label="Image" onClick={a.insertImage}><FontAwesomeIcon icon={faImage} /></ToolButton>
        <DropMenu title="Shapes" buttonClass="doc-tool" caret icon={faShapes}
          items={SHAPES.map((s) => ({ label: s.label, onClick: () => a.insertShape(s.id) }))} />
      </div>

      <div className="doc-tool-group">
        <DropMenu title="Font" buttonClass="doc-select doc-select-font" caret
          items={FONTS.map((f) => ({ label: f.label, style: { fontFamily: f.value }, checked: f.value === style.font, disabled: !hasText, onClick: () => a.setStyle('font', f.value) }))}>
          <span style={{ fontFamily: style.font ?? themeFont }}>{style.font ? fontLabel(style.font) : 'Theme font'}</span>
        </DropMenu>
        <SizeBox size={style.size ?? 18} disabled={!hasText} onSet={(n) => a.setStyle('size', n)} />
      </div>

      <div className="doc-tool-group">
        <ToolButton label="Bold" shortcut="Ctrl+B" active={style.b} disabled={!hasText} onClick={() => a.toggle('b')}><FontAwesomeIcon icon={faBold} /></ToolButton>
        <ToolButton label="Italic" shortcut="Ctrl+I" active={style.i} disabled={!hasText} onClick={() => a.toggle('i')}><FontAwesomeIcon icon={faItalic} /></ToolButton>
        <ToolButton label="Underline" shortcut="Ctrl+U" active={style.u} disabled={!hasText} onClick={() => a.toggle('u')}><FontAwesomeIcon icon={faUnderline} /></ToolButton>
        <DropMenu title="Text color" buttonClass="doc-tool doc-color-btn"
          render={(close) => <ColorGrid close={close} resetLabel="Theme color" onPick={(c) => a.setStyle('color', c)} />}>
          <span className="doc-color-a"><FontAwesomeIcon icon={faFont} /><span className="doc-color-bar" style={{ background: style.color || '#c00000' }} /></span>
        </DropMenu>
      </div>

      <div className="doc-tool-group">
        {[['left', faAlignLeft], ['center', faAlignCenter], ['right', faAlignRight], ['justify', faAlignJustify]].map(([h, icon]) => (
          <ToolButton key={h} label={`Align ${h}`} disabled={!hasText} active={(style.align ?? 'left') === h}
            onClick={() => a.setStyle('align', h === 'left' ? null : h)}><FontAwesomeIcon icon={icon} /></ToolButton>
        ))}
        <DropMenu title="Vertical alignment" buttonClass="doc-tool" caret
          items={[['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']].map(([v, label]) => ({
            label, checked: style.valign === v, disabled: !hasText, onClick: () => a.setStyle('valign', v),
          }))}>
          <span className="sheet-valign">⇕</span>
        </DropMenu>
        <ToolButton label="Bullets" active={style.list === 'bullet'} disabled={!hasText} onClick={() => a.setStyle('list', style.list === 'bullet' ? null : 'bullet')}><FontAwesomeIcon icon={faListUl} /></ToolButton>
        <ToolButton label="Numbering" active={style.list === 'number'} disabled={!hasText} onClick={() => a.setStyle('list', style.list === 'number' ? null : 'number')}><FontAwesomeIcon icon={faListOl} /></ToolButton>
      </div>

      <div className="doc-tool-group">
        <DropMenu title="Shape fill" buttonClass="doc-tool doc-color-btn"
          render={(close) => (
            <>
              <button type="button" className="dropdown-item small px-2" disabled={!hasShape} onMouseDown={(e) => e.preventDefault()}
                onClick={() => { close(); a.setShape('fill', 'none'); }}>No fill</button>
              <ColorGrid close={close} resetLabel="Theme color" onPick={(c) => hasShape && a.setShape('fill', c)} />
            </>
          )}>
          <span className="doc-color-a"><FontAwesomeIcon icon={faFillDrip} /><span className="doc-color-bar" style={{ background: '#4472c4' }} /></span>
        </DropMenu>
        <DropMenu title="Shape outline" buttonClass="doc-tool doc-color-btn"
          render={(close) => (
            <>
              <button type="button" className="dropdown-item small px-2" disabled={!hasShape} onMouseDown={(e) => e.preventDefault()}
                onClick={() => { close(); a.setShape('stroke', 'none'); }}>No outline</button>
              <ColorGrid close={close} resetLabel="Automatic" onPick={(c) => hasShape && a.setShape('stroke', c)} />
              <div className="small text-muted px-1 mt-2">Weight</div>
              <div className="d-flex gap-1 px-1">
                {[1, 2, 3, 4, 6, 8].map((w) => (
                  <button key={w} type="button" className="btn btn-sm btn-light" disabled={!hasShape} onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { close(); a.setShape('strokeWidth', w); }}>{w}</button>
                ))}
              </div>
            </>
          )}>
          <span className="doc-color-a"><FontAwesomeIcon icon={faPenNib} /><span className="doc-color-bar" style={{ background: '#262626' }} /></span>
        </DropMenu>
      </div>

      <div className="doc-tool-group">
        <ToolButton label="Present from this slide" shortcut="Shift+F5" onClick={a.presentHere} className="slide-present-btn">
          <FontAwesomeIcon icon={faPlay} className="me-1" />Present
        </ToolButton>
      </div>
    </div>
  );
}
