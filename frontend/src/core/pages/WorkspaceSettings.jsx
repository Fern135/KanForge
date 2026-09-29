import { useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBuilding, faCubes, faUsers } from '@fortawesome/free-solid-svg-icons';
import { useAuth } from '../context/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { useToast } from '../context/ToastContext';
import { workspaceApi } from '../api/endpoints';
import { errorMessage } from '../api/client';
import { goTo } from '../workspaceUrl';
import Spinner from '../components/Spinner';
import ConfirmModal from '../components/ConfirmModal';

function General() {
  const { workspace, isAdmin, setCurrent, refreshList } = useWorkspace();
  const toast = useToast();
  const [name, setName] = useState(workspace.name);
  const [busy, setBusy] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const data = await workspaceApi.rename(name.trim());
      setCurrent((c) => ({ ...c, workspace: data.workspace }));
      refreshList();
      toast.success('Workspace renamed');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card border-0 shadow-sm mb-4">
      <div className="card-body">
        <h2 className="h6 fw-bold mb-3"><FontAwesomeIcon icon={faBuilding} className="me-2 text-success" />Workspace</h2>
        <form className="d-flex gap-2 mb-3" onSubmit={save}>
          <label className="visually-hidden" htmlFor="ws-name">Name</label>
          <input id="ws-name" className="form-control" maxLength={60} value={name} disabled={!isAdmin}
            onChange={(e) => setName(e.target.value)} required />
          {isAdmin && (
            <button type="submit" className="btn btn-primary flex-shrink-0" disabled={busy || !name.trim() || name.trim() === workspace.name}>Save</button>
          )}
        </form>
        <dl className="row small mb-0">
          <dt className="col-4 col-sm-3 text-muted fw-normal">Address</dt>
          <dd className="col-8 col-sm-9 text-break"><code>/app/w/{workspace.slug}</code></dd>
          <dt className="col-4 col-sm-3 text-muted fw-normal">Plan</dt>
          <dd className="col-8 col-sm-9 mb-0">
            <span className="badge text-bg-success me-2">{workspace.planName}</span>
            {workspace.plan !== 'self-hosted' && <a href="/pricing">Compare plans</a>}
          </dd>
        </dl>
      </div>
    </section>
  );
}

function Members() {
  const { user } = useAuth();
  const { isAdmin } = useWorkspace();
  const toast = useToast();
  const [members, setMembers] = useState(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [busy, setBusy] = useState('');
  const [removing, setRemoving] = useState(null);

  useEffect(() => {
    workspaceApi.members().then((d) => setMembers(d.members)).catch((err) => toast.error(errorMessage(err)));
  }, [toast]);

  const add = async (e) => {
    e.preventDefault();
    setBusy('add');
    try {
      const { member } = await workspaceApi.addMember(email.trim(), role);
      setMembers((list) => [...list, member]);
      setEmail('');
      toast.success(`${member.name} was added`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy('');
    }
  };

  const changeRole = async (m, next) => {
    setBusy(m.id);
    try {
      const { member } = await workspaceApi.setRole(m.id, next);
      setMembers((list) => list.map((x) => (x.id === m.id ? member : x)));
      // Demoting yourself hides the admin controls.
      if (m.id === user.id) goTo(window.location.href);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy('');
    }
  };

  const remove = async (m) => {
    try {
      await workspaceApi.removeMember(m.id);
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
    if (m.id === user.id) {
      goTo('/app/');
      return;
    }
    setMembers((list) => list.filter((x) => x.id !== m.id));
    toast.success(`${m.name} was removed`);
  };

  if (!members) return <Spinner />;
  const self = removing?.id === user.id;

  return (
    <section className="card border-0 shadow-sm mb-4">
      <div className="card-body">
        <h2 className="h6 fw-bold mb-1"><FontAwesomeIcon icon={faUsers} className="me-2 text-success" />Members</h2>
        <p className="text-muted small mb-3">
          Admins manage members, apps and the workspace name. There&apos;s always at least one admin.
        </p>
        {isAdmin && (
          <form className="d-flex flex-column flex-sm-row gap-2 mb-3" onSubmit={add}>
            <label className="visually-hidden" htmlFor="member-email">Email</label>
            <input id="member-email" type="email" className="form-control" maxLength={254} placeholder="Email of someone with an account"
              value={email} onChange={(e) => setEmail(e.target.value)} required />
            <label className="visually-hidden" htmlFor="member-role">Role</label>
            <select id="member-role" className="form-select flex-shrink-0" style={{ width: 'auto' }} value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <button type="submit" className="btn btn-primary flex-shrink-0" disabled={busy === 'add' || !email.trim()}>Add</button>
          </form>
        )}
        <ul className="list-group list-group-flush">
          {members.map((m) => (
            <li className="list-group-item px-0 d-flex flex-column flex-sm-row align-items-sm-center justify-content-between gap-2" key={m.id}>
              <div className="text-truncate">
                <span className="fw-semibold">{m.name}</span>
                {m.id === user.id && <span className="text-muted small"> (you)</span>}
                {m.role === 'admin' && <span className="badge text-bg-success ms-2">Admin</span>}
                <div className="text-muted small text-truncate">{m.email}</div>
              </div>
              <div className="d-flex gap-2 flex-shrink-0">
                {isAdmin && (
                  <select className="form-select form-select-sm" style={{ width: 'auto' }} value={m.role} disabled={busy === m.id}
                    aria-label={`Role for ${m.name}`} onChange={(e) => changeRole(m, e.target.value)}>
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                )}
                {(isAdmin || m.id === user.id) && (
                  <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => setRemoving(m)}>
                    {m.id === user.id ? 'Leave' : 'Remove'}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
      {removing && (
        <ConfirmModal
          title={self ? 'Leave this workspace?' : `Remove ${removing.name}?`}
          message={self
            ? "You'll lose access right away. Boards you own go to one of the workspace's admins."
            : `${removing.name} will lose access right away. Boards they own will be yours.`}
          confirmLabel={self ? 'Leave workspace' : 'Remove'}
          onClose={() => setRemoving(null)}
          onConfirm={() => remove(removing)}
        />
      )}
    </section>
  );
}

function Apps() {
  const { appStates, isAdmin, setCurrent } = useWorkspace();
  const toast = useToast();
  const [busy, setBusy] = useState('');

  const toggle = async (app) => {
    setBusy(app.id);
    try {
      const { apps } = await workspaceApi.setAppEnabled(app.id, !app.enabled);
      setCurrent((c) => ({ ...c, apps }));
      toast.success(`${app.name} turned ${app.enabled ? 'off' : 'on'}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="card border-0 shadow-sm">
      <div className="card-body">
        <h2 className="h6 fw-bold mb-1"><FontAwesomeIcon icon={faCubes} className="me-2 text-success" />Apps</h2>
        <p className="text-muted small mb-3">Turned-off apps are hidden from everyone in this workspace, and their data is kept.</p>
        <ul className="list-group list-group-flush">
          {appStates.map((app) => (
            <li className="list-group-item px-0 d-flex align-items-center justify-content-between gap-3" key={app.id}>
              <div>
                <div className="fw-semibold">{app.name}</div>
                {!app.included && <div className="text-muted small">Included in the Plus plan</div>}
              </div>
              <div className="form-check form-switch m-0">
                <input className="form-check-input" type="checkbox" role="switch" id={`app-${app.id}`}
                  checked={app.enabled} disabled={!isAdmin || !app.included || busy === app.id} onChange={() => toggle(app)}
                  aria-label={`${app.name} ${app.enabled ? 'on' : 'off'}`} />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export default function WorkspaceSettings() {
  return (
    <main className="container py-4" style={{ maxWidth: 760 }}>
      <h1 className="h4 fw-bold text-primary mb-4">Workspace settings</h1>
      <General />
      <Members />
      <Apps />
    </main>
  );
}
