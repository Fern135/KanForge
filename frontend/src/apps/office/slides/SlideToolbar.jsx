import { useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faRotateLeft, faRotateRight, faBold, faItalic, faUnderline, faStrikethrough, faFont, faFillDrip, faAlignLeft,
  faAlignCenter, faAlignRight, faAlignJustify, faListUl, faListOl, faImage, faShapes, faPlay, faFileCirclePlus, faPenNib,
  faHighlighter, faTable, faChartColumn, faIcons, faObjectGroup, faRotate, faWandMagicSparkles, faTextHeight,
} from '@fortawesome/free-solid-svg-icons';
import {
  DropMenu, ToolButton, ColorGrid, TableGrid,
} from '../docs/ui';
import { FONTS } from '../docs/fonts';
import {
  ANIMATIONS, CHARTS, LAYOUTS, SHAPES, SPACINGS, shapePath,
} from './model';

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

// The formatting toolbar for the selected items.
export default function SlideToolbar({ a, sel, themeFont }) {
  const { style, text, any, fillable } = sel;
  return (
    <div className="doc-toolbar" role="toolbar" aria-label="Formatting">
      <div className="doc-tool-group">
        <ToolButton label="Undo" shortcut="Ctrl+Z" disabled={!a.canUndo} onClick={a.undo}><FontAwesomeIcon icon={faRotateLeft} /></ToolButton>
        <ToolButton label="Redo" shortcut="Ctrl+Y" disabled={!a.canRedo} onClick={a.redo}><FontAwesomeIcon icon={faRotateRight} /></ToolButton>
      </div>

      <div className="doc-tool-group">
        <DropMenu title="New slide" buttonClass="doc-tool" caret items={LAYOUTS.map((l) => ({ label: l.label, onClick: () => a.newSlide(l.id) }))}>
          <FontAwesomeIcon icon={faFileCirclePlus} className="me-1" /><span className="d-none d-xl-inline">New slide</span>
        </DropMenu>
        <ToolButton label="Text box" onClick={a.insertText}><span className="slide-textbox-icon">A</span></ToolButton>
        <ToolButton label="Image" onClick={a.insertImage}><FontAwesomeIcon icon={faImage} /></ToolButton>
        <DropMenu title="Shapes" buttonClass="doc-tool" caret icon={faShapes}
          render={(close) => (
            <div className="slide-shape-grid">
              {SHAPES.map((s) => (
                <button key={s.id} type="button" className="slide-shape-pick" title={s.label} aria-label={s.label}
                  onMouseDown={(e) => e.preventDefault()} onClick={() => { close(); a.insertShape(s.id); }}>
                  <ShapeIcon shape={s.id} />
                </button>
              ))}
            </div>
          )} />
        <DropMenu title="Table" buttonClass="doc-tool" caret icon={faTable}
          render={(close) => <TableGrid close={close} onPick={(r, c) => a.insertTable(r, c)} />} />
        <DropMenu title="Chart" buttonClass="doc-tool" caret icon={faChartColumn}
          items={CHARTS.map((c) => ({ label: c.label, onClick: () => a.insertChart(c.id) }))} />
        <ToolButton label="Icon" onClick={a.insertIcon}><FontAwesomeIcon icon={faIcons} /></ToolButton>
      </div>

      <div className="doc-tool-group">
        <DropMenu title="Font" buttonClass="doc-select doc-select-font" caret
          items={FONTS.map((f) => ({ label: f.label, style: { fontFamily: f.value }, checked: f.value === style.font, disabled: !text, onClick: () => a.setStyle('font', f.value) }))}>
          <span style={{ fontFamily: style.font ?? themeFont }}>{style.font ? fontLabel(style.font) : 'Theme font'}</span>
        </DropMenu>
        <SizeBox size={style.size ?? 18} disabled={!text} onSet={(n) => a.setStyle('size', n)} />
      </div>

      <div className="doc-tool-group">
        <ToolButton label="Bold" shortcut="Ctrl+B" active={style.b} disabled={!text} onClick={() => a.toggle('b')}><FontAwesomeIcon icon={faBold} /></ToolButton>
        <ToolButton label="Italic" shortcut="Ctrl+I" active={style.i} disabled={!text} onClick={() => a.toggle('i')}><FontAwesomeIcon icon={faItalic} /></ToolButton>
        <ToolButton label="Underline" shortcut="Ctrl+U" active={style.u} disabled={!text} onClick={() => a.toggle('u')}><FontAwesomeIcon icon={faUnderline} /></ToolButton>
        <ToolButton label="Strikethrough" active={style.s} disabled={!text} onClick={() => a.toggle('s')}><FontAwesomeIcon icon={faStrikethrough} /></ToolButton>
        <DropMenu title="Text color" buttonClass="doc-tool doc-color-btn"
          render={(close) => <ColorGrid close={close} resetLabel="Theme color" onPick={(c) => a.setStyle('color', c)} />}>
          <span className="doc-color-a"><FontAwesomeIcon icon={faFont} /><span className="doc-color-bar" style={{ background: style.color || '#c00000' }} /></span>
        </DropMenu>
        <DropMenu title="Highlight" buttonClass="doc-tool doc-color-btn"
          render={(close) => <ColorGrid close={close} resetLabel="No highlight" onPick={(c) => a.setStyle('highlight', c)} />}>
          <span className="doc-color-a"><FontAwesomeIcon icon={faHighlighter} /><span className="doc-color-bar" style={{ background: style.highlight || '#ffff00' }} /></span>
        </DropMenu>
      </div>

      <div className="doc-tool-group">
        {[['left', faAlignLeft], ['center', faAlignCenter], ['right', faAlignRight], ['justify', faAlignJustify]].map(([h, icon]) => (
          <ToolButton key={h} label={`Align ${h}`} disabled={!text} active={(style.align ?? 'left') === h}
            onClick={() => a.setStyle('align', h === 'left' ? null : h)}><FontAwesomeIcon icon={icon} /></ToolButton>
        ))}
        <DropMenu title="Vertical alignment" buttonClass="doc-tool" caret
          items={[['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']].map(([v, label]) => ({
            label, checked: style.valign === v, disabled: !text, onClick: () => a.setStyle('valign', v),
          }))}>
          <span className="sheet-valign">⇕</span>
        </DropMenu>
        <ToolButton label="Bullets" active={style.list === 'bullet'} disabled={!text} onClick={() => a.setStyle('list', style.list === 'bullet' ? null : 'bullet')}><FontAwesomeIcon icon={faListUl} /></ToolButton>
        <ToolButton label="Numbering" active={style.list === 'number'} disabled={!text} onClick={() => a.setStyle('list', style.list === 'number' ? null : 'number')}><FontAwesomeIcon icon={faListOl} /></ToolButton>
        <DropMenu title="Line spacing" buttonClass="doc-tool" caret icon={faTextHeight}
          items={SPACINGS.map((s) => ({ label: String(s), checked: (style.spacing ?? 1) === s, disabled: !text, onClick: () => a.setStyle('spacing', s === 1 ? null : s) }))} />
      </div>

      <div className="doc-tool-group">
        <DropMenu title="Fill" buttonClass="doc-tool doc-color-btn"
          render={(close) => (
            <>
              <button type="button" className="dropdown-item small px-2" disabled={!fillable} onMouseDown={(e) => e.preventDefault()}
                onClick={() => { close(); a.setFill('none'); }}>No fill</button>
              <ColorGrid close={close} resetLabel="Theme color" onPick={(c) => fillable && a.setFill(c)} />
            </>
          )}>
          <span className="doc-color-a"><FontAwesomeIcon icon={faFillDrip} /><span className="doc-color-bar" style={{ background: '#4472c4' }} /></span>
        </DropMenu>
        <DropMenu title="Outline" buttonClass="doc-tool doc-color-btn"
          render={(close) => (
            <>
              <button type="button" className="dropdown-item small px-2" disabled={!fillable} onMouseDown={(e) => e.preventDefault()}
                onClick={() => { close(); a.setOutline('none'); }}>No outline</button>
              <ColorGrid close={close} resetLabel="Automatic" onPick={(c) => fillable && a.setOutline(c)} />
              <div className="small text-muted px-1 mt-2">Weight</div>
              <div className="d-flex gap-1 px-1">
                {[1, 2, 3, 4, 6, 8].map((w) => (
                  <button key={w} type="button" className="btn btn-sm btn-light" disabled={!fillable} onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { close(); a.setOutline(undefined, w); }}>{w}</button>
                ))}
              </div>
            </>
          )}>
          <span className="doc-color-a"><FontAwesomeIcon icon={faPenNib} /><span className="doc-color-bar" style={{ background: '#262626' }} /></span>
        </DropMenu>
      </div>

      <div className="doc-tool-group">
        <DropMenu title="Arrange" buttonClass="doc-tool" caret icon={faObjectGroup}
          items={[
            { label: 'Bring to front', disabled: !any, onClick: () => a.arrange('front') },
            { label: 'Send to back', disabled: !any, onClick: () => a.arrange('back') },
            'divider',
            { label: 'Align left', disabled: !any, onClick: () => a.align('left') },
            { label: 'Align center', disabled: !any, onClick: () => a.align('center') },
            { label: 'Align right', disabled: !any, onClick: () => a.align('right') },
            { label: 'Align top', disabled: !any, onClick: () => a.align('top') },
            { label: 'Align middle', disabled: !any, onClick: () => a.align('middle') },
            { label: 'Align bottom', disabled: !any, onClick: () => a.align('bottom') },
            'divider',
            { label: 'Distribute horizontally', disabled: sel.count < 3, onClick: () => a.distribute('x') },
            { label: 'Distribute vertically', disabled: sel.count < 3, onClick: () => a.distribute('y') },
            'divider',
            { label: 'Group', disabled: !sel.many, onClick: a.group },
            { label: 'Ungroup', disabled: !sel.grouped, onClick: a.ungroup },
          ]} />
        <DropMenu title="Rotate" buttonClass="doc-tool" caret icon={faRotate}
          items={[
            { label: 'Rotate right 90°', disabled: !any, onClick: () => a.rotateBy(90) },
            { label: 'Rotate left 90°', disabled: !any, onClick: () => a.rotateBy(-90) },
            { label: 'Flip horizontal', disabled: !any, onClick: () => a.flip('flipH') },
            { label: 'Flip vertical', disabled: !any, onClick: () => a.flip('flipV') },
          ]} />
        <DropMenu title="Animation" buttonClass="doc-tool" caret icon={faWandMagicSparkles}
          items={[
            { label: 'None', checked: any && !sel.anim, disabled: !any, onClick: () => a.setAnimation(null) },
            ...ANIMATIONS.map((an) => ({ label: an.label, checked: sel.anim === an.id, disabled: !any, onClick: () => a.setAnimation(an.id) })),
          ]} />
      </div>

      <div className="doc-tool-group">
        <ToolButton label="Present from this slide" shortcut="Shift+F5" onClick={a.presentHere} className="slide-present-btn">
          <FontAwesomeIcon icon={faPlay} className="me-1" />Present
        </ToolButton>
      </div>
    </div>
  );
}

// A small outline of a shape for the shape picker.
function ShapeIcon({ shape }) {
  if (shape === 'line') return <svg viewBox="0 0 24 24" width="22" height="22"><line x1="2" y1="12" x2="22" y2="12" stroke="currentColor" strokeWidth="2" /></svg>;
  return (
    <svg viewBox="-1 -1 26 26" width="22" height="22" aria-hidden="true">
      <path d={shapePath(shape, 24, 24)} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}
