import { useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faDesktop, faMobileScreen, faRightFromBracket, faTabletScreenButton,
} from '@fortawesome/free-solid-svg-icons';
import { useToast } from '../context/ToastContext';
import { authApi } from '../api/endpoints';
import { errorMessage } from '../api/client';
import { describeDevice } from '../utils/device';
import { shortDate, timeAgo } from '../utils/dates';
import Spinner from '../components/Spinner';

const ICONS = { phone: faMobileScreen, tablet: faTabletScreenButton, computer: faDesktop };

// Every device signed in to this account, each with its own Sign out, and
// "Sign out everywhere" for all of them at once.
export default function AccountDevices({ onSignOutEverywhere }) {
  const toast = useToast();
  const [sessions, setSessions] = useState(null);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    authApi.sessions().then((d) => setSessions(d.sessions)).catch((err) => {
      toast.error(errorMessage(err));
      setSessions([]);
    });
  }, [toast]);

  const signOut = async (s, name) => {
    setBusy(s.id);
    try {
      await authApi.signOutDevice(s.id);
      setSessions((list) => list.filter((x) => x.id !== s.id));
      toast.success(`Signed out of ${name}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="card border-0 shadow-sm mb-4">
      <div className="card-body">
        <h2 className="h6 fw-bold mb-1"><FontAwesomeIcon icon={faDesktop} className="me-2 text-success" />Where you&apos;re signed in</h2>
        <p className="text-muted small mb-3">
          Don&apos;t recognise a device? Sign it out, then change your password.
        </p>
        {!sessions ? <Spinner small /> : (
          <ul className="list-group list-group-flush mb-3">
            {sessions.map((s) => {
              const { name, kind } = describeDevice(s.userAgent);
              return (
                <li className="list-group-item px-0 d-flex align-items-center gap-3" key={s.id}>
                  <FontAwesomeIcon icon={ICONS[kind]} className="text-muted flex-shrink-0" fixedWidth size="lg" />
                  <div className="flex-grow-1 min-w-0">
                    <div className="fw-semibold text-truncate">
                      {name}
                      {s.current && <span className="badge text-bg-success ms-2">This device</span>}
                    </div>
                    <div className="text-muted small text-truncate">
                      {s.ip && <>{s.ip} · </>}
                      Signed in {shortDate(s.signedInAt)} · {s.current ? 'Active now' : `Active ${timeAgo(s.lastActiveAt)}`}
                    </div>
                  </div>
                  {!s.current && (
                    <button type="button" className="btn btn-sm btn-outline-secondary flex-shrink-0" disabled={busy === s.id} onClick={() => signOut(s, name)}>
                      Sign out
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <div className="d-flex flex-column flex-sm-row align-items-sm-center justify-content-between gap-2 border-top pt-3">
          <div>
            <div className="fw-semibold">Sign out everywhere</div>
            <p className="text-muted small mb-0">Ends every session on all your devices, including this one.</p>
          </div>
          <button type="button" className="btn btn-outline-danger flex-shrink-0" onClick={onSignOutEverywhere}>
            <FontAwesomeIcon icon={faRightFromBracket} className="me-2" />Sign out all
          </button>
        </div>
      </div>
    </section>
  );
}
