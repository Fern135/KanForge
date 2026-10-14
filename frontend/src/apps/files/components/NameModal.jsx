import { useState } from 'react';
import Modal from '../../../core/components/Modal';

// Asks for a name: a new folder's, or a new name for an item. When renaming a
// file, the part before the extension is selected so typing keeps ".pdf" etc.
export default function NameModal({ title, initial = '', confirmLabel, onSubmit, onClose }) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);

  // onSubmit throws when the server refuses (it has already shown why), so the
  // modal stays open with the name kept, ready to fix and try again.
  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onSubmit(name.trim());
      onClose();
    } catch {
      setBusy(false);
    }
  };

  // On focus: select "report" in "report.pdf" (everything when there's no extension).
  const selectStem = (e) => {
    const dot = initial.lastIndexOf('.');
    e.target.setSelectionRange(0, dot > 0 ? dot : initial.length);
  };

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn-light" onClick={onClose}>Cancel</button>
          <button type="submit" form="files-name-form" className="btn btn-primary" disabled={busy || !name.trim()}>{confirmLabel}</button>
        </>
      )}
    >
      <form id="files-name-form" onSubmit={submit}>
        <label className="visually-hidden" htmlFor="files-name">Name</label>
        <input id="files-name" className="form-control" maxLength={255} value={name} onFocus={selectStem}
          onChange={(e) => setName(e.target.value)} required />
      </form>
    </Modal>
  );
}
