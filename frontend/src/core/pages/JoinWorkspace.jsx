import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faUserPlus } from '@fortawesome/free-solid-svg-icons';
import { invitesApi } from '../api/endpoints';
import { errorMessage } from '../api/client';
import { goTo, workspaceUrl } from '../workspaceUrl';
import Spinner from '../components/Spinner';

// Opened from an invite link, once signed in: shows which workspace the link is
// for, and joins it only when the person says so.
export default function JoinWorkspace() {
  // The token is in the link's #fragment.
  const token = useLocation().hash.slice(1);
  const [invite, setInvite] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    invitesApi.preview(token).then(setInvite).catch((err) => setError(errorMessage(err, 'This invite link is invalid or has expired')));
  }, [token]);

  const join = async () => {
    setBusy(true);
    try {
      const { workspace } = await invitesApi.accept(token);
      goTo(workspaceUrl(workspace.slug));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  if (!invite && !error) return <Spinner fullscreen />;

  return (
    <main className="container py-5" style={{ maxWidth: 520 }}>
      <div className="card border-0 shadow-sm">
        <div className="card-body p-4 text-center">
          <FontAwesomeIcon icon={faUserPlus} className="text-success mb-3" size="2x" />
          {error ? (
            <>
              <h1 className="h5 fw-bold">Can&apos;t use this invite</h1>
              <p className="text-muted">{error}. Ask a workspace admin for a new link.</p>
              <a href="/app/" className="btn btn-primary">Go to your workspaces</a>
            </>
          ) : invite.member ? (
            <>
              <h1 className="h5 fw-bold">You&apos;re already in {invite.workspace.name}</h1>
              <button type="button" className="btn btn-primary mt-2" onClick={() => goTo(workspaceUrl(invite.workspace.slug))}>
                Open {invite.workspace.name}
              </button>
            </>
          ) : (
            <>
              <h1 className="h5 fw-bold">Join {invite.workspace.name}?</h1>
              <p className="text-muted">
                You&apos;ve been invited as {invite.role === 'admin' ? 'an admin' : 'a member'}. Its members will see your name and email.
              </p>
              <div className="d-flex justify-content-center gap-2">
                <a href="/app/" className="btn btn-light">Not now</a>
                <button type="button" className="btn btn-primary" onClick={join} disabled={busy}>
                  {busy ? <span className="spinner-border spinner-border-sm" /> : `Join ${invite.workspace.name}`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
