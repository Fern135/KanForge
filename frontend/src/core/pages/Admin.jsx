import { useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCubes, faUsers } from '@fortawesome/free-solid-svg-icons';
import { useAuth } from '../context/AuthContext';
import { useApps } from '../context/AppsContext';
import { useToast } from '../context/ToastContext';
import { adminApi } from '../api/endpoints';
import { errorMessage } from '../api/client';
import Spinner from '../components/Spinner';

export default function Admin() {
  const { user, setUser } = useAuth();
  const { refresh: refreshApps } = useApps();
  const toast = useToast();
  const [apps, setApps] = useState(null);
  const [users, setUsers] = useState(null);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    adminApi.apps().then((d) => setApps(d.apps)).catch((err) => toast.error(errorMessage(err)));
    adminApi.users().then((d) => setUsers(d.users)).catch((err) => toast.error(errorMessage(err)));
  }, [toast]);

  const toggleApp = async (app) => {
    setBusy(`app:${app.id}`);
    try {
      const data = await adminApi.setAppEnabled(app.id, !app.enabled);
      setApps(data.apps);
      await refreshApps();
      toast.success(`${app.name} turned ${app.enabled ? 'off' : 'on'}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy('');
    }
  };

  const setRole = async (target, role) => {
    setBusy(`user:${target.id}`);
    try {
      const data = await adminApi.setRole(target.id, role);
      setUsers((list) => list.map((u) => (u.id === target.id ? data.user : u)));
      toast.success(role === 'admin' ? `${target.name} is now an admin` : `${target.name} is no longer an admin`);
      // Demoting yourself takes you out of this page.
      if (target.id === user.id) setUser({ ...user, role });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy('');
    }
  };

  if (!apps || !users) return <Spinner fullscreen />;

  return (
    <main className="container py-4" style={{ maxWidth: 760 }}>
      <h1 className="h4 fw-bold text-primary mb-4">Admin</h1>

      <section className="card border-0 shadow-sm mb-4">
        <div className="card-body">
          <h2 className="h6 fw-bold mb-1"><FontAwesomeIcon icon={faCubes} className="me-2 text-success" />Apps</h2>
          <p className="text-muted small mb-3">Turned-off apps are hidden from everyone, and their data is kept.</p>
          <ul className="list-group list-group-flush">
            {apps.map((app) => (
              <li className="list-group-item px-0 d-flex align-items-center justify-content-between gap-3" key={app.id}>
                <div>
                  <div className="fw-semibold">{app.name}</div>
                  <div className="text-muted small">{app.description}</div>
                </div>
                <div className="form-check form-switch m-0">
                  <input className="form-check-input" type="checkbox" role="switch" id={`app-${app.id}`}
                    checked={app.enabled} disabled={busy === `app:${app.id}`} onChange={() => toggleApp(app)}
                    aria-label={`${app.name} ${app.enabled ? 'on' : 'off'}`} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="card border-0 shadow-sm">
        <div className="card-body">
          <h2 className="h6 fw-bold mb-1"><FontAwesomeIcon icon={faUsers} className="me-2 text-success" />Users</h2>
          <p className="text-muted small mb-3">Admins can turn apps on and off and manage other admins. There's always at least one.</p>
          <ul className="list-group list-group-flush">
            {users.map((u) => (
              <li className="list-group-item px-0 d-flex flex-column flex-sm-row align-items-sm-center justify-content-between gap-2" key={u.id}>
                <div className="text-truncate">
                  <span className="fw-semibold">{u.name}</span>
                  {u.id === user.id && <span className="text-muted small"> (you)</span>}
                  {u.role === 'admin' && <span className="badge text-bg-success ms-2">Admin</span>}
                  <div className="text-muted small text-truncate">{u.email}</div>
                </div>
                {u.role === 'admin' ? (
                  <button type="button" className="btn btn-sm btn-outline-danger flex-shrink-0" disabled={busy === `user:${u.id}`}
                    onClick={() => setRole(u, 'user')}>Remove admin</button>
                ) : (
                  <button type="button" className="btn btn-sm btn-outline-primary flex-shrink-0" disabled={busy === `user:${u.id}`}
                    onClick={() => setRole(u, 'admin')}>Make admin</button>
                )}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}
