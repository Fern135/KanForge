import { useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faRotateLeft, faRotateRight, faPrint, faBold, faItalic, faUnderline, faStrikethrough, faFont, faFillDrip, faBorderAll,
  faAlignLeft, faAlignCenter, faAlignRight, faDollarSign, faPercent, faEraser, faArrowDownAZ, faArrowUpAZ,
} from '@fortawesome/free-solid-svg-icons';
import { DropMenu, ToolButton, ColorGrid } from '../docs/ui';
import { FONTS, SIZES, DEFAULT_SIZE, NUMBER_FORMATS } from './styles';

const fontLabel = (value) => FONTS.find((f) => f.value === value)?.label ?? FONTS[0].label;

function SizeBox({ size, onSet }) {
  const [value, setValue] = useState(String(size));
  useEffect(() => setValue(String(size)), [size]);
  const apply = () => {
    const n = parseFloat(value);
    if (n >= 6 && n <= 96) onSet(Math.round(n * 2) / 2);
    else setValue(String(size));
  };
  return (
    <div className="doc-size-box">
      <input value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, '').slice(0, 4))}
        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), apply())} onBlur={apply} aria-label="Font size" title="Font size" />
      <DropMenu title="Font sizes" buttonClass="doc-size-caret" caret
        items={SIZES.map((s) => ({ label: String(s), checked: s === size, onClick: () => onSet(s) }))} />
    </div>
  );
}

// The Excel / Calc-style formatting toolbar for the selected cells.
export default function SheetToolbar({ a, style }) {
  const fmt = style.fmt ?? 'general';
  return (
    <div className="doc-toolbar" role="toolbar" aria-label="Formatting">
      <div className="doc-tool-group">
        <ToolButton label="Undo" shortcut="Ctrl+Z" disabled={!a.canUndo} onClick={a.undo}><FontAwesomeIcon icon={faRotateLeft} /></ToolButton>
        <ToolButton label="Redo" shortcut="Ctrl+Y" disabled={!a.canRedo} onClick={a.redo}><FontAwesomeIcon icon={faRotateRight} /></ToolButton>
        <ToolButton label="Print" shortcut="Ctrl+P" onClick={a.print}><FontAwesomeIcon icon={faPrint} /></ToolButton>
      </div>

      <div className="doc-tool-group">
        <ToolButton label="Currency" active={fmt === 'currency'} onClick={() => a.setNumberFormat(fmt === 'currency' ? 'general' : 'currency')}><FontAwesomeIcon icon={faDollarSign} /></ToolButton>
        <ToolButton label="Percent" active={fmt === 'percent'} onClick={() => a.setNumberFormat(fmt === 'percent' ? 'general' : 'percent')}><FontAwesomeIcon icon={faPercent} /></ToolButton>
        <ToolButton label="Remove decimal place" onClick={() => a.changeDecimals(-1)}><span className="sheet-dp">.0<sub>←</sub></span></ToolButton>
        <ToolButton label="Add decimal place" onClick={() => a.changeDecimals(1)}><span className="sheet-dp">.00<sub>→</sub></span></ToolButton>
        <DropMenu title="Number format" buttonClass="doc-select sheet-select-fmt" caret
          items={NUMBER_FORMATS.map((f) => ({ label: `${f.label}  ·  ${f.sample}`, checked: fmt === f.id, onClick: () => a.setNumberFormat(f.id) }))}>
          {NUMBER_FORMATS.find((f) => f.id === fmt)?.label ?? 'General'}
        </DropMenu>
      </div>

      <div className="doc-tool-group">
        <DropMenu title="Font" buttonClass="doc-select doc-select-font" caret
          items={FONTS.map((f) => ({ label: f.label, style: { fontFamily: f.value }, checked: f.value === (style.font ?? FONTS[0].value), onClick: () => a.setStyle('font', f.value === FONTS[0].value ? null : f.value) }))}>
          <span style={{ fontFamily: style.font ?? FONTS[0].value }}>{fontLabel(style.font)}</span>
        </DropMenu>
        <SizeBox size={style.size ?? DEFAULT_SIZE} onSet={(n) => a.setStyle('size', n === DEFAULT_SIZE ? null : n)} />
      </div>

      <div className="doc-tool-group">
        <ToolButton label="Bold" shortcut="Ctrl+B" active={style.b} onClick={() => a.toggle('b')}><FontAwesomeIcon icon={faBold} /></ToolButton>
        <ToolButton label="Italic" shortcut="Ctrl+I" active={style.i} onClick={() => a.toggle('i')}><FontAwesomeIcon icon={faItalic} /></ToolButton>
        <ToolButton label="Underline" shortcut="Ctrl+U" active={style.u} onClick={() => a.toggle('u')}><FontAwesomeIcon icon={faUnderline} /></ToolButton>
        <ToolButton label="Strikethrough" shortcut="Ctrl+5" active={style.s} onClick={() => a.toggle('s')}><FontAwesomeIcon icon={faStrikethrough} /></ToolButton>
        <DropMenu title="Text color" buttonClass="doc-tool doc-color-btn"
          render={(close) => <ColorGrid close={close} resetLabel="Automatic" onPick={(c) => a.setStyle('color', c)} />}>
          <span className="doc-color-a"><FontAwesomeIcon icon={faFont} /><span className="doc-color-bar" style={{ background: style.color || '#c00000' }} /></span>
        </DropMenu>
        <DropMenu title="Fill color" buttonClass="doc-tool doc-color-btn"
          render={(close) => <ColorGrid close={close} resetLabel="No fill" onPick={(c) => a.setStyle('fill', c)} />}>
          <span className="doc-color-a"><FontAwesomeIcon icon={faFillDrip} /><span className="doc-color-bar" style={{ background: style.fill || '#ffff00' }} /></span>
        </DropMenu>
        <DropMenu title="Borders" buttonClass="doc-tool" icon={faBorderAll}
          items={[
            { label: 'All borders', onClick: () => a.borders('all') },
            { label: 'Outside borders', onClick: () => a.borders('outer') },
            { label: 'Inside borders', onClick: () => a.borders('inner') },
            { label: 'Top border', onClick: () => a.borders('top') },
            { label: 'Bottom border', onClick: () => a.borders('bottom') },
            { label: 'Left border', onClick: () => a.borders('left') },
            { label: 'Right border', onClick: () => a.borders('right') },
            'divider',
            { label: 'No borders', onClick: () => a.borders('none') },
          ]} />
        <ToolButton label="Clear formatting" onClick={a.clearFormatting}><FontAwesomeIcon icon={faEraser} /></ToolButton>
      </div>

      <div className="doc-tool-group">
        {[['left', faAlignLeft], ['center', faAlignCenter], ['right', faAlignRight]].map(([h, icon]) => (
          <ToolButton key={h} label={`Align ${h}`} active={style.h === h} onClick={() => a.setStyle('h', style.h === h ? null : h)}><FontAwesomeIcon icon={icon} /></ToolButton>
        ))}
        <DropMenu title="Vertical alignment" buttonClass="doc-tool" caret
          items={[
            { label: 'Top', checked: style.v === 'top', onClick: () => a.setStyle('v', 'top') },
            { label: 'Middle', checked: style.v === 'middle', onClick: () => a.setStyle('v', 'middle') },
            { label: 'Bottom', checked: !style.v, onClick: () => a.setStyle('v', null) },
          ]}>
          <span className="sheet-valign">⇕</span>
        </DropMenu>
        <ToolButton label="Wrap text" active={style.wrap} onClick={() => a.toggle('wrap')}><span className="sheet-wrap">↵</span></ToolButton>
      </div>

      <div className="doc-tool-group">
        <DropMenu title="AutoSum and functions" buttonClass="doc-tool" caret
          items={['SUM', 'AVERAGE', 'COUNT', 'MAX', 'MIN'].map((fn) => ({ label: fn === 'SUM' ? 'Sum' : fn[0] + fn.slice(1).toLowerCase(), onClick: () => a.autoSum(fn) }))}>
          <span className="sheet-sigma">Σ</span>
        </DropMenu>
        <ToolButton label="Sort A → Z" onClick={() => a.sort(true)}><FontAwesomeIcon icon={faArrowDownAZ} /></ToolButton>
        <ToolButton label="Sort Z → A" onClick={() => a.sort(false)}><FontAwesomeIcon icon={faArrowUpAZ} /></ToolButton>
      </div>
    </div>
  );
}
