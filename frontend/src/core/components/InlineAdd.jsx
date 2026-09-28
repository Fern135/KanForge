import { useEffect, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlus, faXmark } from '@fortawesome/free-solid-svg-icons';

// "+ Add a card" / "+ Add a list": a button that expands into a small form.
export default function InlineAdd({ label, placeholder, maxLength, onSubmit, buttonClass, multiline = false }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const submit = async (e) => {
    e?.preventDefault();
    const v = value.trim();
    if (!v || busy) return;
    setBusy(true);
    try {
      await onSubmit(v);
      setValue('');
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className={buttonClass} onClick={() => setOpen(true)}>
        <FontAwesomeIcon icon={faPlus} className="me-2" />{label}
      </button>
    );
  }

  const Field = multiline ? 'textarea' : 'input';
  return (
    <form onSubmit={submit} className="p-1">
      <Field
        ref={inputRef}
        className="form-control mb-2"
        placeholder={placeholder}
        value={value}
        maxLength={maxLength}
        rows={multiline ? 2 : undefined}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
          if (multiline && e.key === 'Enter' && !e.shiftKey) submit(e);
        }}
      />
      <div className="d-flex align-items-center gap-2">
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !value.trim()}>
          {label}
        </button>
        <button type="button" className="icon-btn" aria-label="Cancel" onClick={() => setOpen(false)}>
          <FontAwesomeIcon icon={faXmark} />
        </button>
      </div>
    </form>
  );
}
