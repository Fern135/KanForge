import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCircleCheck, faCircleExclamation, faXmark } from '@fortawesome/free-solid-svg-icons';

const ToastContext = createContext(null);
let nextId = 1;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (message, variant = 'danger') => {
      const id = nextId++;
      setToasts((t) => [...t.slice(-3), { id, message, variant }]);
      setTimeout(() => dismiss(id), 4500);
    },
    [dismiss],
  );
  const api = useMemo(() => ({ error: (m) => push(m, 'danger'), success: (m) => push(m, 'success') }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast show align-items-center border-0 text-bg-${t.variant}`} role="status">
            <div className="d-flex">
              <div className="toast-body">
                <FontAwesomeIcon icon={t.variant === 'success' ? faCircleCheck : faCircleExclamation} className="me-2" />
                {t.message}
              </div>
              <button type="button" className="btn me-2 m-auto text-white" aria-label="Close" onClick={() => dismiss(t.id)}>
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
