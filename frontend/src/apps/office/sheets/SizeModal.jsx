import { useState } from 'react';
import Modal from '../../../core/components/Modal';

// Column width or row height, in pixels.
export default function SizeModal({ axis, current, onSave, onClose }) {
  const [value, setValue] = useState(String(Math.round(current)));
  const n = Number(value);
  const valid = Number.isFinite(n) && n >= 2 && n <= 2000;
  const save = () => {
    if (!valid) return;
    onSave(Math.round(n));
    onClose();
  };
  return (
    <Modal
      title={axis === 'c' ? 'Column width' : 'Row height'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-light" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={!valid}>OK</button>
        </>
      }
    >
      <label className="form-label" htmlFor="sheet-size">{axis === 'c' ? 'Width' : 'Height'} in pixels (2 to 2000)</label>
      <input id="sheet-size" className="form-control" inputMode="numeric" value={value}
        onChange={(e) => setValue(e.target.value.replace(/\D/g, '').slice(0, 4))}
        onKeyDown={(e) => e.key === 'Enter' && save()} />
    </Modal>
  );
}
