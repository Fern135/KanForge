import { useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUserXmark } from '@fortawesome/free-solid-svg-icons';
import { useToast } from '../context/ToastContext';
import { adminApi } from '../api/endpoints';
import { errorMessage } from '../api/client';
import { fullDate } from '../utils/dates';
import Spinner from '../components/Spinner';
import ConfirmModal from '../components/ConfirmModal';

// People who asked for their account to be deleted (from Account & security).
// guarded: the admin page's runner, which asks for the password when needed.
export default function AdminDeletionRequests({ guarded, onDeleted }) {
  const toast = useToast();
  const [requests, setRequests] = useState(null);
  const [confirming, setConfirming] = useState(null);

  useEffect(() => {
    adminApi.deletionRequests().then((d) => setRequests(d.requests)).catch((err) => toast.error(errorMessage(err)));
  }, [toast]);

  // From the confirm dialog: it closes unless the deletion failed outright.
  const carryOut = async (r) => {
    const result = await guarded(async () => {
      await adminApi.carryOutDeletion(r.id);
      setRequests((list) => list.filter((x) => x.id !== r.id));
      toast.success(`${r.name}'s account was deleted`);
      onDeleted?.();
    });
    if (result === 'failed') throw new Error('not deleted');
  };

  if (!requests) return <Spinner />;

  return (
    <section className="card border-0 shadow-sm mb-4">
      <div className="card-body">
        <h2 className="h6 fw-bold mb-1">
          <FontAwesomeIcon icon={faUserXmark} className="me-2 text-danger" />Deletion requests
          {requests.length > 0 && <span className="badge text-bg-danger ms-2">{requests.length}</span>}
        </h2>
        <p className="text-muted small mb-3">People who asked for their account to be deleted. They can withdraw the request until you act on it.</p>
        {requests.length === 0 ? (
          <p className="text-muted small mb-0">No requests.</p>
        ) : (
          <ul className="list-group list-group-flush">
            {requests.map((r) => (
              <li className="list-group-item px-0 d-flex flex-column flex-sm-row align-items-sm-center justify-content-between gap-2" key={r.id}>
                <div className="text-truncate">
                  <span className="fw-semibold">{r.name}</span>
                  <div className="text-muted small text-truncate">{r.email} · asked {fullDate(r.requestedAt)}</div>
                  {r.soloWorkspaces.length > 0 && (
                    <div className="text-muted small">Also deletes {r.soloWorkspaces.length === 1 ? 'their workspace' : 'their workspaces'}: {r.soloWorkspaces.join(', ')}</div>
                  )}
                </div>
                <button type="button" className="btn btn-sm btn-outline-danger flex-shrink-0" onClick={() => setConfirming(r)}>Delete account</button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {confirming && (
        <ConfirmModal
          title={`Delete ${confirming.name}'s account?`}
          message={`This can't be undone. Boards they owned pass to an admin of each workspace, and their private notes and documents are deleted${confirming.soloWorkspaces.length ? `, along with ${confirming.soloWorkspaces.map((n) => `"${n}"`).join(', ')}, where they're the only member` : ''}.`}
          confirmLabel="Delete account"
          onClose={() => setConfirming(null)}
          onConfirm={() => carryOut(confirming)}
        />
      )}
    </section>
  );
}
