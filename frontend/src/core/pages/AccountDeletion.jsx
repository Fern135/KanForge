import { useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUserXmark } from '@fortawesome/free-solid-svg-icons';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { authApi } from '../api/endpoints';
import { errorMessage } from '../api/client';
import { fullDate } from '../utils/dates';

// Asking a platform admin to delete this account. Everything keeps working until
// they do, and the request can be withdrawn until then.
export default function AccountDeletion() {
  const { user } = useAuth();
  const toast = useToast();
  const [requestedAt, setRequestedAt] = useState(undefined);
  const [asking, setAsking] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    authApi.deletionRequest().then((d) => setRequestedAt(d.requestedAt)).catch(() => setRequestedAt(null));
  }, []);

  const request = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const d = await authApi.requestDeletion(password);
      setRequestedAt(d.requestedAt);
      setAsking(false);
      setPassword('');
      toast.success('Deletion requested');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      await authApi.cancelDeletion();
      setRequestedAt(null);
      toast.success('Deletion request withdrawn');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (requestedAt === undefined) return null;

  return (
    <section className="card border-0 shadow-sm border-danger-subtle">
      <div className="card-body">
        <h2 className="h6 fw-bold mb-1 text-danger"><FontAwesomeIcon icon={faUserXmark} className="me-2" />Delete account</h2>
        {user.role === 'admin' ? (
          <p className="text-muted small mb-0">
            You&apos;re a platform admin. To delete this account, ask another platform admin to remove your admin role first.
          </p>
        ) : requestedAt ? (
          <>
            <p className="small mb-3">
              You asked for your account to be deleted on {fullDate(requestedAt)}. An administrator will delete it, and
              you&apos;ll be signed out when they do. Until then everything keeps working.
            </p>
            <button type="button" className="btn btn-outline-secondary" disabled={busy} onClick={cancel}>Withdraw request</button>
          </>
        ) : (
          <>
            <p className="text-muted small mb-3">
              Ask an administrator to delete your account. Boards you own pass to an admin of each workspace, your private
              notes and documents are deleted, and so are workspaces only you are in. This can&apos;t be undone once it&apos;s done.
            </p>
            {asking ? (
              <form onSubmit={request}>
                <input type="password" className="form-control mb-2" placeholder="Current password" autoComplete="current-password"
                  aria-label="Current password" maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
                <div className="d-flex gap-2">
                  <button type="submit" className="btn btn-danger" disabled={busy || !password}>Request deletion</button>
                  <button type="button" className="btn btn-outline-secondary" onClick={() => { setAsking(false); setPassword(''); }}>Cancel</button>
                </div>
              </form>
            ) : (
              <button type="button" className="btn btn-outline-danger" onClick={() => setAsking(true)}>Request account deletion</button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
