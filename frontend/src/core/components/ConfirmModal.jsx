import { useState } from 'react';
import Modal from './Modal';

export default function ConfirmModal({ title, message, confirmLabel = 'Delete', variant = 'danger', onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } catch {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-light" onClick={onClose}>Cancel</button>
          <button type="button" className={`btn btn-${variant}`} onClick={go} disabled={busy}>{confirmLabel}</button>
        </>
      }
    >
      <p className="mb-0">{message}</p>
    </Modal>
  );
}
