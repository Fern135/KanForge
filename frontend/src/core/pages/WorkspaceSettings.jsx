import { useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBuilding, faCopy, faCubes, faLink, faUsers } from '@fortawesome/free-solid-svg-icons';
import { useAuth } from '../context/AuthContext';
import { useWorkspace } from '../context/WorkspaceContext';
import { useToast } from '../context/ToastContext';
import { workspaceApi } from '../api/endpoints';
import { errorMessage } from '../api/client';
import { goTo, inviteUrl } from '../workspaceUrl';
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
  const [busy, setBusy] = useState('');
  const [removing, setRemoving] = useState(null);

  useEffect(() => {
    workspaceApi.members().then((d) => setMembers(d.members)).catch((err) => toast.error(errorMessage(err)));
  }, [toast]);

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
          {isAdmin && ' To add someone, send them an invite link (below).'}
        </p>
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

const EXPIRY_DAYS = [1, 7, 14, 30];
const fmtDate = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

// Workspace admins only. A link's address is shown once, right after it's made:
// the server keeps only a hash of it.
function Invites() {
  const toast = useToast();
  const [invites, setInvites] = useState(null);
  const [form, setForm] = useState({ role: 'member', expiresInDays: 7, maxUses: '' });
  const [created, setCreated] = useState(null);
  const [busy, setBusy] = useState('');
  const [revoking, setRevoking] = useState(null);

  useEffect(() => {
    workspaceApi.invites().then((d) => setInvites(d.invites)).catch((err) => toast.error(errorMessage(err)));
  }, [toast]);

  const create = async (e) => {
    e.preventDefault();
    setBusy('create');
    try {
      const maxUses = form.maxUses ? Number(form.maxUses) : null;
      const { invite, token } = await workspaceApi.createInvite({ role: form.role, expiresInDays: form.expiresInDays, maxUses });
      setInvites((list) => [invite, ...list]);
      setCreated(inviteUrl(token));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy('');
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(created);
      toast.success('Invite link copied');
    } catch {
      toast.error('Could not copy. Select the link and copy it yourself.');
    }
  };

  const revoke = async (invite) => {
    try {
      await workspaceApi.revokeInvite(invite.id);
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
    setInvites((list) => list.filter((i) => i.id !== invite.id));
    toast.success('Invite link revoked');
  };

  if (!invites) return <Spinner />;

  return (
    <section className="card border-0 shadow-sm mb-4">
      <div className="card-body">
        <h2 className="h6 fw-bold mb-1"><FontAwesomeIcon icon={faLink} className="me-2 text-success" />Invite links</h2>
        <p className="text-muted small mb-3">
          Anyone with a link can join this workspace after signing in or creating an account. Share links privately, and revoke any you no longer need.
        </p>
        <form className="d-flex flex-column flex-sm-row gap-2 mb-3" onSubmit={create}>
          <label className="visually-hidden" htmlFor="invite-role">Role</label>
          <select id="invite-role" className="form-select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="member">Joins as member</option>
            <option value="admin">Joins as admin</option>
          </select>
          <label className="visually-hidden" htmlFor="invite-expiry">Expires</label>
          <select id="invite-expiry" className="form-select" value={form.expiresInDays}
            onChange={(e) => setForm({ ...form, expiresInDays: Number(e.target.value) })}>
            {EXPIRY_DAYS.map((d) => <option key={d} value={d}>Expires in {d} {d === 1 ? 'day' : 'days'}</option>)}
          </select>
          <label className="visually-hidden" htmlFor="invite-uses">Uses</label>
          <select id="invite-uses" className="form-select" value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: e.target.value })}>
            <option value="">Any number of uses</option>
            {[1, 5, 10, 25, 100].map((n) => <option key={n} value={n}>{n === 1 ? 'One use' : `${n} uses`}</option>)}
          </select>
          <button type="submit" className="btn btn-primary flex-shrink-0" disabled={busy === 'create'}>Create link</button>
        </form>
        {created && (
          <div className="alert alert-success py-2 small">
            <div className="fw-semibold mb-1">Copy this link now. It won&apos;t be shown again.</div>
            <div className="input-group input-group-sm">
              <input className="form-control" readOnly value={created} aria-label="Invite link" onFocus={(e) => e.target.select()} />
              <button type="button" className="btn btn-outline-success" onClick={copy}><FontAwesomeIcon icon={faCopy} className="me-1" />Copy</button>
            </div>
          </div>
        )}
        {invites.length ? (
          <ul className="list-group list-group-flush">
            {invites.map((i) => (
              <li className="list-group-item px-0 d-flex align-items-center justify-content-between gap-2" key={i.id}>
                <div className="small">
                  <span className="fw-semibold">{i.role === 'admin' ? 'Admin' : 'Member'} link</span>
                  <div className="text-muted">
                    Expires {fmtDate(i.expiresAt)} · {i.uses} {i.maxUses ? `of ${i.maxUses} uses` : (i.uses === 1 ? 'use' : 'uses')}
                  </div>
                </div>
                <button type="button" className="btn btn-sm btn-outline-danger flex-shrink-0" onClick={() => setRevoking(i)}>Revoke</button>
              </li>
            ))}
          </ul>
        ) : <p className="text-muted small mb-0">No active invite links.</p>}
      </div>
      {revoking && (
        <ConfirmModal
          title="Revoke this invite link?"
          message="It stops working right away. People who already joined stay in the workspace."
          confirmLabel="Revoke"
          onClose={() => setRevoking(null)}
          onConfirm={() => revoke(revoking)}
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
  const { isAdmin } = useWorkspace();
  return (
    <main className="container py-4" style={{ maxWidth: 760 }}>
      <h1 className="h4 fw-bold text-primary mb-4">Workspace settings</h1>
      <General />
      <Members />
      {isAdmin && <Invites />}
      <Apps />
    </main>
  );
}
