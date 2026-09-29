import { useState } from 'react';
import Modal from '../../../core/components/Modal';
import { PAGE_SIZES } from './fonts';

const US = (size) => size === 'letter' || size === 'legal';
const IN = 25.4;

// Word's margin presets, in inches.
const PRESETS = [
  { label: 'Normal', t: 1, b: 1, l: 1, r: 1 },
  { label: 'Narrow', t: 0.5, b: 0.5, l: 0.5, r: 0.5 },
  { label: 'Moderate', t: 1, b: 1, l: 0.75, r: 0.75 },
  { label: 'Wide', t: 1, b: 1, l: 2, r: 2 },
];

export default function PageSetupModal({ settings, onSave, onClose }) {
  const [pageSize, setPageSize] = useState(settings.pageSize);
  const [orientation, setOrientation] = useState(settings.orientation);
  const [margins, setMargins] = useState(settings.margins);
  // Shown in inches for US paper and centimetres otherwise, stored in millimetres.
  const inches = US(pageSize);
  const factor = inches ? IN : 10;
  const show = (mm) => String(Math.round((mm / factor) * 100) / 100);
  const [draft, setDraft] = useState(() => Object.fromEntries(Object.entries(settings.margins).map(([k, v]) => [k, show(v)])));

  const setOne = (side, text) => {
    setDraft((d) => ({ ...d, [side]: text }));
    const n = parseFloat(text);
    if (n >= 0) setMargins((m) => ({ ...m, [side]: Math.min(100, Math.round(n * factor * 10) / 10) }));
  };
  const preset = (p) => {
    const next = { top: p.t * IN, bottom: p.b * IN, left: p.l * IN, right: p.r * IN };
    setMargins(next);
    setDraft(Object.fromEntries(Object.entries(next).map(([k, v]) => [k, show(v)])));
  };
  const changeSize = (size) => {
    setPageSize(size);
    const f = US(size) ? IN : 10;
    setDraft(Object.fromEntries(Object.entries(margins).map(([k, v]) => [k, String(Math.round((v / f) * 100) / 100)])));
  };

  return (
    <Modal
      title="Page setup"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-light" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => { onSave({ pageSize, orientation, margins }); onClose(); }}>OK</button>
        </>
      }
    >
      <label className="form-label fw-semibold" htmlFor="page-size">Paper size</label>
      <select id="page-size" className="form-select mb-3" value={pageSize} onChange={(e) => changeSize(e.target.value)}>
        {Object.entries(PAGE_SIZES).map(([id, p]) => <option key={id} value={id}>{p.label}</option>)}
      </select>

      <div className="fw-semibold mb-1">Orientation</div>
      <div className="btn-group mb-3" role="group">
        {['portrait', 'landscape'].map((o) => (
          <button key={o} type="button" className={`btn btn-sm ${orientation === o ? 'btn-primary' : 'btn-outline-primary'}`}
            aria-pressed={orientation === o} onClick={() => setOrientation(o)}>
            {o === 'portrait' ? 'Portrait' : 'Landscape'}
          </button>
        ))}
      </div>

      <div className="fw-semibold mb-1">Margins ({inches ? 'inches' : 'cm'})</div>
      <div className="d-flex flex-wrap gap-1 mb-2">
        {PRESETS.map((p) => <button key={p.label} type="button" className="btn btn-sm btn-light" onClick={() => preset(p)}>{p.label}</button>)}
      </div>
      <div className="row g-2">
        {['top', 'bottom', 'left', 'right'].map((side) => (
          <div className="col-6" key={side}>
            <label className="form-label small text-capitalize mb-0" htmlFor={`m-${side}`}>{side}</label>
            <input id={`m-${side}`} className="form-control form-control-sm" inputMode="decimal" value={draft[side]}
              onChange={(e) => setOne(side, e.target.value.replace(/[^\d.]/g, ''))} />
          </div>
        ))}
      </div>
    </Modal>
  );
}
