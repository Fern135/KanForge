import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark } from '@fortawesome/free-solid-svg-icons';

let openCount = 0;

// A React-controlled Bootstrap modal: Bootstrap markup and styles, React state.
export default function Modal({ title, onClose, children, footer, size, className = '' }) {
  const titleId = useId();
  const dialogRef = useRef(null);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Runs once per mount. Reading onClose through a ref keeps a new callback
  // identity from re-running this effect (and stealing focus) on every render.
  useEffect(() => {
    const prevFocus = document.activeElement;
    openCount += 1;
    document.body.classList.add('modal-open');
    const onKey = (e) => {
      // Only the top-most modal reacts to Escape.
      if (e.key === 'Escape' && dialogRef.current?.closest('.modal') === [...document.querySelectorAll('.modal.tb-open')].pop()) {
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', onKey);
    const first = dialogRef.current?.querySelector('.modal-body input, .modal-body textarea, .modal-body select, .modal-body button');
    first?.focus();
    return () => {
      openCount -= 1;
      if (openCount === 0) document.body.classList.remove('modal-open');
      document.removeEventListener('keydown', onKey);
      prevFocus?.focus?.();
    };
  }, []);

  return createPortal(
    <>
      <div
        className={`modal tb-open ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onMouseDown={(e) => e.target === e.currentTarget && onCloseRef.current()}
      >
        <div className={`modal-dialog modal-dialog-scrollable modal-fullscreen-sm-down ${size ? `modal-${size}` : ''}`} ref={dialogRef}>
          <div className="modal-content">
            <div className="modal-header">
              <h2 className="modal-title fs-5 fw-bold text-primary" id={titleId}>{title}</h2>
              <button type="button" className="icon-btn btn-close-x ms-auto" onClick={onClose} aria-label="Close">
                <FontAwesomeIcon icon={faXmark} size="lg" />
              </button>
            </div>
            <div className="modal-body">{children}</div>
            {footer && <div className="modal-footer">{footer}</div>}
          </div>
        </div>
      </div>
      <div className="modal-backdrop fade show tb-open" />
    </>,
    document.body,
  );
}
