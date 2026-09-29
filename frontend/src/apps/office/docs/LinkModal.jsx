import { useState } from 'react';
import Modal from '../../../core/components/Modal';
import { isSafeUrl } from './extensions';

// Adds https:// when someone types "example.com".
const normalize = (raw) => {
  const url = raw.trim();
  if (!url) return '';
  return /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
};

// Word's Insert Link (Ctrl+K): the address, and the text to show when nothing is selected.
export default function LinkModal({ editor, onClose }) {
  const { from, to, empty } = editor.state.selection;
  const [href, setHref] = useState(editor.getAttributes('link').href || '');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const hasLink = editor.isActive('link');

  const apply = (e) => {
    e?.preventDefault();
    const url = normalize(href);
    if (!url) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      onClose();
      return;
    }
    if (!isSafeUrl(url)) {
      setError('Links must start with http://, https:// or mailto:');
      return;
    }
    if (empty && !hasLink) {
      const label = text.trim() || url;
      editor.chain().focus().insertContent({ type: 'text', text: label, marks: [{ type: 'link', attrs: { href: url } }] }).run();
    } else {
      editor.chain().focus().setTextSelection({ from, to }).extendMarkRange('link').setLink({ href: url }).run();
    }
    onClose();
  };

  return (
    <Modal
      title={hasLink ? 'Edit link' : 'Insert link'}
      onClose={onClose}
      footer={
        <>
          {hasLink && (
            <button type="button" className="btn btn-outline-danger me-auto" onClick={() => { editor.chain().focus().extendMarkRange('link').unsetLink().run(); onClose(); }}>
              Remove link
            </button>
          )}
          <button type="button" className="btn btn-light" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={apply}>OK</button>
        </>
      }
    >
      <form onSubmit={apply}>
        {empty && !hasLink && (
          <>
            <label className="form-label fw-semibold" htmlFor="link-text">Text to display</label>
            <input id="link-text" className="form-control mb-3" value={text} maxLength={500} onChange={(e) => setText(e.target.value)} />
          </>
        )}
        <label className="form-label fw-semibold" htmlFor="link-href">Address</label>
        <input id="link-href" className={`form-control ${error ? 'is-invalid' : ''}`} placeholder="https://example.com" value={href}
          maxLength={2048} onChange={(e) => { setHref(e.target.value); setError(''); }} />
        {error && <div className="invalid-feedback">{error}</div>}
      </form>
    </Modal>
  );
}
