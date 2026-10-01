import { Fragment, useEffect, useMemo, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faBan, faCircleCheck, faCopy, faKey, faTrashCan, faUserPlus, faUsers,
} from '@fortawesome/free-solid-svg-icons';
import { useToast } from '../context/ToastContext';
import { adminApi } from '../api/endpoints';
import { errorMessage } from '../api/client';
import { inviteUrl } from '../workspaceUrl';
import Spinner from '../components/Spinner';
import Modal from '../components/Modal';
import ConfirmModal from '../components/ConfirmModal';

// What someone can do in an app. Only restrictions are stored: no entry is Edit.
const LEVELS = [['none', 'None'], ['view', 'View'], ['edit', 'Edit']];
const EXPIRY_DAYS = [1, 7, 14, 30];
const levelOf = (access, appId) => access?.[appId] ?? 'edit';

// None / View / Edit for one app.
function AccessControl({ app, value, onChange, disabled, idPrefix }) {
  return (
    <div className="admin-access" role="radiogroup" aria-label={`${app.name} access`}>
      <span className="admin-access-app">{app.name}</span>
      <div className="btn-group btn-group-sm">
        {LEVELS.map(([level, label]) => {
          const id = `${idPrefix}-${app.id}-${level}`;
          return (
            <Fragment key={level}>
              <input type="radio" className="btn-check" id={id} name={`${idPrefix}-${app.id}`} autoComplete="off"
                checked={value === level} disabled={disabled} onChange={() => onChange(level)} />
              <label className={`btn btn-outline-${level === 'none' ? 'danger' : level === 'view' ? 'secondary' : 'success'}`} htmlFor={id}>{label}</label>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

// Shown once: a temporary password or an invite link to hand to someone.
function SecretModal({ secret, onClose }) {
  const toast = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(secret.value);
      toast.success(`${secret.label} copied`);
    } catch {
      toast.error('Could not copy. Select it and copy it yourself.');
    }
  };
  return (
    <Modal title={secret.title} onClose={onClose} footer={<button type="button" className="btn btn-primary" onClick={onClose}>Done</button>}>
      <p className="small">{secret.intro}</p>
      <div className="input-group mb-2">
        <input className="form-control font-monospace" readOnly value={secret.value} aria-label={secret.label} onFocus={(e) => e.target.select()} />
        <button type="button" className="btn btn-outline-success" onClick={copy}><FontAwesomeIcon icon={faCopy} className="me-1" />Copy</button>
      </div>
      <p className="small text-muted mb-0">Copy it now: it won&apos;t be shown again. {secret.note}</p>
    </Modal>
  );
}

function AddPerson({ apps, workspaces, guarded, onAdded, onClose }) {
  const [method, setMethod] = useState('password');
  const [form, setForm] = useState({
    name: '', email: '', workspaceId: workspaces[0]?.id ?? '', role: 'member', expiresInDays: 7, maxUses: 1,
  });
  const [access, setAccess] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const base = { workspaceId: form.workspaceId, role: form.role, access };
    const result = await guarded(async () => {
      if (method === 'password') {
        const { person, password } = await adminApi.addPerson({ ...base, name: form.name.trim(), email: form.email.trim() });
        onAdded(person, {
          title: `${person.name} can sign in now`,
          intro: `Give ${person.name} this temporary password to sign in as ${person.email}.`,
          label: 'Temporary password',
          value: password,
          note: 'They choose their own password the first time they sign in.',
        });
      } else {
        const maxUses = form.maxUses ? Number(form.maxUses) : null;
        const { token, workspace } = await adminApi.invitePerson({ ...base, expiresInDays: Number(form.expiresInDays), maxUses });
        onAdded(null, {
          title: 'Invite link ready',
          intro: `Whoever opens this link can create an account and join ${workspace.name} with the access you chose.`,
          label: 'Invite link',
          value: inviteUrl(token),
          note: maxUses === 1 ? 'It works once.' : '',
        });
      }
    });
    // The password prompt takes over when the server asks for it; the change runs after it.
    if (result !== 'done') setBusy(false);
  };

  const ready = form.workspaceId && (method === 'invite' || (form.name.trim() && form.email.trim()));
  return (
    <Modal
      title="Add a person"
      onClose={onClose}
      size="lg"
      footer={(
        <>
          <button type="button" className="btn btn-light" onClick={onClose}>Cancel</button>
          <button type="submit" form="add-person" className="btn btn-primary" disabled={busy || !ready}>
            {method === 'password' ? 'Add person' : 'Create invite link'}
          </button>
        </>
      )}
    >
      <form id="add-person" onSubmit={submit}>
        <div className="btn-group w-100 mb-3" role="radiogroup" aria-label="How they get in">
          {[['password', 'Temporary password'], ['invite', 'Invite link']].map(([id, label]) => (
            <Fragment key={id}>
              <input type="radio" className="btn-check" id={`add-method-${id}`} name="add-method" checked={method === id} onChange={() => setMethod(id)} />
              <label className="btn btn-outline-primary" htmlFor={`add-method-${id}`}>{label}</label>
            </Fragment>
          ))}
        </div>
        <p className="small text-muted">
          {method === 'password'
            ? 'Makes the account now. You get a one-time password to hand them, and they pick their own at first sign-in.'
            : 'Makes a link they open to create their own account. Access is applied when they join.'}
        </p>

        {method === 'password' && (
          <div className="row g-2 mb-2">
            <div className="col-sm-6">
              <label className="form-label fw-semibold small" htmlFor="person-name">Name</label>
              <input id="person-name" className="form-control" maxLength={60} value={form.name} onChange={set('name')} required />
            </div>
            <div className="col-sm-6">
              <label className="form-label fw-semibold small" htmlFor="person-email">Email</label>
              <input id="person-email" type="email" className="form-control" maxLength={254} value={form.email} onChange={set('email')} required />
            </div>
          </div>
        )}

        <div className="row g-2 mb-3">
          <div className="col-sm-6">
            <label className="form-label fw-semibold small" htmlFor="person-workspace">Workspace</label>
            <select id="person-workspace" className="form-select" value={form.workspaceId} onChange={set('workspaceId')} required>
              {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div className="col-sm-6">
            <label className="form-label fw-semibold small" htmlFor="person-role">Role in the workspace</label>
            <select id="person-role" className="form-select" value={form.role} onChange={set('role')}>
              <option value="member">Member</option>
              <option value="admin">Workspace admin</option>
            </select>
          </div>
          {method === 'invite' && (
            <>
              <div className="col-sm-6">
                <label className="form-label fw-semibold small" htmlFor="person-expiry">Link expires</label>
                <select id="person-expiry" className="form-select" value={form.expiresInDays} onChange={set('expiresInDays')}>
                  {EXPIRY_DAYS.map((d) => <option key={d} value={d}>In {d} {d === 1 ? 'day' : 'days'}</option>)}
                </select>
              </div>
              <div className="col-sm-6">
                <label className="form-label fw-semibold small" htmlFor="person-uses">Uses</label>
                <select id="person-uses" className="form-select" value={form.maxUses} onChange={set('maxUses')}>
                  {[1, 5, 10, 25].map((n) => <option key={n} value={n}>{n === 1 ? 'One person' : `Up to ${n} people`}</option>)}
                  <option value="">Any number of people</option>
                </select>
              </div>
            </>
          )}
        </div>

        <div className="fw-semibold small mb-1">App access</div>
        <p className="small text-muted mb-2">None hides the app. View opens it read-only. Edit is full use.</p>
        <div className="admin-access-list">
          {apps.map((app) => (
            <AccessControl key={app.id} app={app} idPrefix="new" value={levelOf(access, app.id)}
              onChange={(level) => setAccess({ ...access, [app.id]: level })} />
          ))}
        </div>
      </form>
    </Modal>
  );
}

// Self-hosted installs: everyone on the server, and what each person can use.
export default function AdminPeople({ currentUserId, guarded, onDeleted }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('');
  const [adding, setAdding] = useState(false);
  const [secret, setSecret] = useState(null);
  // { type: 'reset' | 'disable' | 'delete', person }
  const [confirming, setConfirming] = useState(null);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    adminApi.people().then(setData).catch((err) => toast.error(errorMessage(err)));
  }, [toast]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = data?.people ?? [];
    return q ? list.filter((p) => p.name.toLowerCase().includes(q) || p.email.includes(q)) : list;
  }, [data, filter]);

  const patchPerson = (id, changes) => setData((d) => ({ ...d, people: d.people.map((p) => (p.id === id ? { ...p, ...changes } : p)) }));

  const changeAccess = async (p, app, level) => {
    setBusy(`${p.id}:${app.id}`);
    await guarded(async () => {
      const { access } = await adminApi.setAccess(p.id, { [app.id]: level });
      patchPerson(p.id, { access });
      toast.success(`${p.name}: ${app.name} set to ${LEVELS.find(([l]) => l === level)[1]}`);
    });
    setBusy('');
  };

  const added = (person, shownSecret) => {
    if (person) setData((d) => ({ ...d, people: [...d.people, person].sort((a, b) => a.name.localeCompare(b.name)) }));
    setAdding(false);
    setSecret(shownSecret);
  };

  const enable = async (p) => {
    setBusy(`${p.id}:enable`);
    await guarded(async () => {
      await adminApi.setDisabled(p.id, false);
      patchPerson(p.id, { disabled: false });
      toast.success(`${p.name} can sign in again`);
    });
    setBusy('');
  };

  // From the confirm dialogs: each closes unless the change failed outright.
  const disable = async (p) => {
    const result = await guarded(async () => {
      await adminApi.setDisabled(p.id, true);
      patchPerson(p.id, { disabled: true });
      toast.success(`${p.name} is disabled and was signed out`);
    });
    if (result === 'failed') throw new Error('not disabled');
  };

  const remove = async (p) => {
    const result = await guarded(async () => {
      await adminApi.deletePerson(p.id);
      setData((d) => ({ ...d, people: d.people.filter((x) => x.id !== p.id) }));
      toast.success(`${p.name}'s account was deleted`);
      if (p.deletionRequestedAt) onDeleted?.();
    });
    if (result === 'failed') throw new Error('not deleted');
  };

  const resetPassword = async (p) => {
    const result = await guarded(async () => {
      const { password } = await adminApi.resetPassword(p.id);
      patchPerson(p.id, { mustChangePassword: true });
      setSecret({
        title: `New password for ${p.name}`,
        intro: `${p.name} was signed out everywhere. Give them this temporary password to sign in as ${p.email}.`,
        label: 'Temporary password',
        value: password,
        note: 'They choose their own password the next time they sign in.',
      });
    });
    if (result === 'failed') throw new Error('not reset');
  };

  if (!data) return <Spinner />;

  return (
    <section className="card border-0 shadow-sm mb-4">
      <div className="card-body">
        <div className="d-flex flex-column flex-sm-row align-items-sm-center justify-content-between gap-2 mb-1">
          <h2 className="h6 fw-bold mb-0"><FontAwesomeIcon icon={faUsers} className="me-2 text-success" />People</h2>
          <div className="d-flex gap-2">
            <input type="search" className="form-control form-control-sm" style={{ maxWidth: 220 }} placeholder="Find a person"
              aria-label="Find a person" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <button type="button" className="btn btn-sm btn-primary flex-shrink-0" onClick={() => setAdding(true)} disabled={!data.workspaces.length}>
              <FontAwesomeIcon icon={faUserPlus} className="me-1" />Add person
            </button>
          </div>
        </div>
        <p className="text-muted small mb-3">
          Everyone who can sign in to this server. Choose what each person can use: None hides an app, View opens it read-only, Edit is full use. Changes apply right away.
        </p>
        <ul className="list-group list-group-flush">
          {shown.map((p) => (
            <li className="list-group-item px-0 admin-person" key={p.id}>
              <div className="admin-person-who">
                <div className="text-truncate">
                  <span className="fw-semibold">{p.name}</span>
                  {p.id === currentUserId && <span className="text-muted small"> (you)</span>}
                  {p.role === 'admin' && <span className="badge text-bg-success ms-2">Platform admin</span>}
                  {p.disabled && <span className="badge text-bg-secondary ms-2">Disabled</span>}
                  {p.deletionRequestedAt && <span className="badge text-bg-danger ms-2">Deletion requested</span>}
                  {p.mustChangePassword && !p.disabled && <span className="badge text-bg-warning ms-2">Temporary password</span>}
                </div>
                <div className="text-muted small text-truncate">
                  {p.email}{p.workspaces.length ? ` · ${p.workspaces.join(', ')}` : ' · No workspace yet'}
                </div>
                {/* Platform admins (you included) are managed under Platform admins, not here. */}
                {p.role !== 'admin' && (
                  <div className="d-flex flex-wrap gap-3 small">
                    <button type="button" className="btn btn-link btn-sm p-0" onClick={() => setConfirming({ type: 'reset', person: p })}>
                      <FontAwesomeIcon icon={faKey} className="me-1" />Reset password
                    </button>
                    {p.disabled ? (
                      <button type="button" className="btn btn-link btn-sm p-0" disabled={busy === `${p.id}:enable`} onClick={() => enable(p)}>
                        <FontAwesomeIcon icon={faCircleCheck} className="me-1" />Enable
                      </button>
                    ) : (
                      <button type="button" className="btn btn-link btn-sm p-0 text-secondary" onClick={() => setConfirming({ type: 'disable', person: p })}>
                        <FontAwesomeIcon icon={faBan} className="me-1" />Disable
                      </button>
                    )}
                    <button type="button" className="btn btn-link btn-sm p-0 text-danger" onClick={() => setConfirming({ type: 'delete', person: p })}>
                      <FontAwesomeIcon icon={faTrashCan} className="me-1" />Delete
                    </button>
                  </div>
                )}
              </div>
              {p.role === 'admin' ? (
                <div className="text-muted small admin-person-access">Full access to every app</div>
              ) : (
                <div className="admin-person-access">
                  {data.apps.map((app) => (
                    <AccessControl key={app.id} app={app} idPrefix={p.id} value={levelOf(p.access, app.id)}
                      disabled={busy === `${p.id}:${app.id}`} onChange={(level) => changeAccess(p, app, level)} />
                  ))}
                </div>
              )}
            </li>
          ))}
          {!shown.length && <li className="list-group-item px-0 text-muted small">No one matches.</li>}
        </ul>
      </div>

      {adding && <AddPerson apps={data.apps} workspaces={data.workspaces} guarded={guarded} onAdded={added} onClose={() => setAdding(false)} />}
      {secret && <SecretModal secret={secret} onClose={() => setSecret(null)} />}
      {confirming?.type === 'reset' && (
        <ConfirmModal
          title={`Reset ${confirming.person.name}'s password?`}
          message="They're signed out everywhere and get a new temporary password to sign in with. They choose their own password after that."
          confirmLabel="Reset password"
          onClose={() => setConfirming(null)}
          onConfirm={() => resetPassword(confirming.person)}
        />
      )}
      {confirming?.type === 'disable' && (
        <ConfirmModal
          title={`Disable ${confirming.person.name}?`}
          message="They're signed out everywhere and can't sign in until you enable the account again. Their boards, notes and documents are kept."
          confirmLabel="Disable"
          onClose={() => setConfirming(null)}
          onConfirm={() => disable(confirming.person)}
        />
      )}
      {confirming?.type === 'delete' && (
        <ConfirmModal
          title={`Delete ${confirming.person.name}'s account?`}
          message={confirming.person.deletionRequestedAt
            ? "They asked for this. It can't be undone: boards they owned pass to an admin of each workspace, their private notes and documents are deleted, and so are workspaces only they are in."
            : "This can't be undone. Boards they owned pass to an admin of each workspace, and their private notes and documents are deleted. To keep everything, disable the account instead."}
          confirmLabel="Delete account"
          onClose={() => setConfirming(null)}
          onConfirm={() => remove(confirming.person)}
        />
      )}
    </section>
  );
}
