import { useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBuilding, faUsers } from '@fortawesome/free-solid-svg-icons';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { adminApi } from '../api/endpoints';
import { errorMessage } from '../api/client';
import Spinner from '../components/Spinner';

const PLANS = [['self-hosted', 'Self-hosted'], ['standard', 'Standard'], ['plus', 'Plus']];

// Platform admin: runs the whole server. Sees workspace metadata (name, plan,
// seats), never what's inside a workspace.
export default function Admin() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [workspaces, setWorkspaces] = useState(null);
  const [users, setUsers] = useState(null);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    adminApi.workspaces().then((d) => setWorkspaces(d.workspaces)).catch((err) => toast.error(errorMessage(err)));
    adminApi.users().then((d) => setUsers(d.users)).catch((err) => toast.error(errorMessage(err)));
  }, [toast]);

  const updateWorkspace = async (ws, change, message) => {
    setBusy(`ws:${ws.id}`);
    try {
      const { workspace } = await adminApi.updateWorkspace(ws.id, change);
      setWorkspaces((list) => list.map((w) => (w.id === ws.id ? workspace : w)));
      toast.success(message);
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

  if (!workspaces || !users) return <Spinner fullscreen />;

  return (
    <main className="container py-4" style={{ maxWidth: 760 }}>
      <h1 className="h4 fw-bold text-primary mb-4">Platform admin</h1>

      <section className="card border-0 shadow-sm mb-4">
        <div className="card-body">
          <h2 className="h6 fw-bold mb-1"><FontAwesomeIcon icon={faBuilding} className="me-2 text-success" />Workspaces</h2>
          <p className="text-muted small mb-3">
            A plan decides a workspace&apos;s apps and limits. Auto-join adds everyone who signs up on this server to that workspace.
          </p>
          <ul className="list-group list-group-flush">
            {workspaces.map((w) => (
              <li className="list-group-item px-0 d-flex flex-column flex-sm-row align-items-sm-center justify-content-between gap-2" key={w.id}>
                <div className="text-truncate">
                  <span className="fw-semibold">{w.name}</span>
                  <div className="text-muted small text-truncate">
                    /app/w/{w.slug} · {w.seats} {w.seats === 1 ? 'seat' : 'seats'}
                  </div>
                </div>
                <div className="d-flex align-items-center gap-3 flex-shrink-0">
                  <div className="form-check form-switch m-0">
                    <input className="form-check-input" type="checkbox" role="switch" id={`autojoin-${w.id}`}
                      checked={w.autoJoin} disabled={busy === `ws:${w.id}`}
                      onChange={() => updateWorkspace(w, { autoJoin: !w.autoJoin }, `Auto-join turned ${w.autoJoin ? 'off' : 'on'} for ${w.name}`)} />
                    <label className="form-check-label small" htmlFor={`autojoin-${w.id}`}>Auto-join</label>
                  </div>
                  <select className="form-select form-select-sm" style={{ width: 'auto' }} value={w.plan} disabled={busy === `ws:${w.id}`}
                    aria-label={`Plan for ${w.name}`}
                    onChange={(e) => updateWorkspace(w, { plan: e.target.value }, `${w.name} is now on ${PLANS.find(([id]) => id === e.target.value)[1]}`)}>
                    {PLANS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                  </select>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="card border-0 shadow-sm">
        <div className="card-body">
          <h2 className="h6 fw-bold mb-1"><FontAwesomeIcon icon={faUsers} className="me-2 text-success" />Users</h2>
          <p className="text-muted small mb-3">Platform admins manage every workspace's plan and other platform admins. There's always at least one.</p>
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
