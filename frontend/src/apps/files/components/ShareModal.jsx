import { useEffect, useMemo, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faLink, faCopy, faUserPlus, faXmark, faGlobe } from '@fortawesome/free-solid-svg-icons';
import Modal from '../../../core/components/Modal';
import Spinner from '../../../core/components/Spinner';
import Avatar from '../../../core/components/Avatar';
import { errorMessage } from '../../../core/api/client';
import { workspaceApi } from '../../../core/api/endpoints';
import { useAuth } from '../../../core/context/AuthContext';
import { useToast } from '../../../core/context/ToastContext';
import { filesApi } from '../api';

// The access someone can be given: [value sent to the API, label shown].
const ROLES = [['view', 'Viewer'], ['edit', 'Editor']];

// Google Drive's "Share" dialog: add people from this workspace as viewers or
// editors, change or remove their access, and turn the public link on or off.
// Only the owner opens this (the server checks too).
export default function ShareModal({ item, onChanged, onClose }) {
  const { user } = useAuth();
  const toast = useToast();
  // { people, link, linkSharing } from the API: who has access, the public link if any,
  // and whether the server allows public links at all.
  const [info, setInfo] = useState(null);
  // Everyone in the workspace, to pick from when adding someone.
  const [members, setMembers] = useState([]);
  // The person and access chosen in the "add someone" row.
  const [who, setWho] = useState('');
  const [role, setRole] = useState('view');
  const [busy, setBusy] = useState(false);

  // Loads who has access, and the workspace's members to add from.
  useEffect(() => {
    filesApi.shares(item.id).then(setInfo).catch((err) => toast.error(errorMessage(err)));
    workspaceApi.members().then((d) => setMembers(d.members)).catch(() => {});
  }, [item.id, toast]);

  // People who could still be added: members without access, and not the owner.
  const candidates = useMemo(() => {
    const has = new Set((info?.people || []).map((p) => p.user.id));
    return members.filter((m) => m.id !== user.id && !has.has(m.id));
  }, [members, info, user.id]);

  // Runs a change and shows the dialog's new state. Tells the page, so its
  // "shared" markers stay right.
  const apply = async (action) => {
    setBusy(true);
    try {
      const next = await action();
      if (next) setInfo((cur) => ({ ...cur, ...next }));
      onChanged?.();
    } catch (err) {
      toast.error(errorMessage(err));
    }
    setBusy(false);
  };

  // Shares with the chosen person, then clears the picker for the next one.
  const add = (e) => {
    e.preventDefault();
    if (!who) return;
    apply(async () => {
      const next = await filesApi.share(item.id, who, role);
      setWho('');
      return next;
    });
  };

  // Changes someone's access, and updates the list in place without reloading it.
  const setPersonRole = (share, next) => apply(async () => {
    await filesApi.setShareRole(share.id, next);
    return { people: info.people.map((p) => (p.id === share.id ? { ...p, role: next } : p)) };
  });

  // Takes away someone's access.
  const remove = (share) => apply(async () => {
    await filesApi.removeShare(share.id);
    return { people: info.people.filter((p) => p.id !== share.id) };
  });

  // The API gives the link as a path; it's shown and copied as a full URL.
  const linkUrl = info?.link ? `${window.location.origin}${info.link.url}` : '';
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(linkUrl);
      toast.success('Link copied');
    } catch {
      toast.error('Couldn\'t copy. Select the link and copy it yourself.');
    }
  };

  return (
    <Modal title={`Share "${item.name}"`} onClose={onClose} footer={<button type="button" className="btn btn-primary" onClick={onClose}>Done</button>}>
      {!info ? (
        <div className="text-center p-3"><Spinner small /></div>
      ) : (
        <>
          <form className="d-flex gap-2 mb-3" onSubmit={add}>
            <label className="visually-hidden" htmlFor="share-who">Person</label>
            <select id="share-who" className="form-select" value={who} onChange={(e) => setWho(e.target.value)} disabled={!candidates.length}>
              <option value="">{candidates.length ? 'Add someone from this workspace…' : 'Everyone in this workspace has access'}</option>
              {candidates.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.email})</option>)}
            </select>
            <label className="visually-hidden" htmlFor="share-role">Access</label>
            <select id="share-role" className="form-select w-auto" value={role} onChange={(e) => setRole(e.target.value)}>
              {ROLES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
            <button type="submit" className="btn btn-primary flex-shrink-0" disabled={busy || !who} aria-label="Share">
              <FontAwesomeIcon icon={faUserPlus} />
            </button>
          </form>

          {/* The owner first (always you, since only the owner opens this), then everyone shared with. */}
          <h3 className="h6 fw-bold">People with access</h3>
          <ul className="list-unstyled mb-4">
            <li className="d-flex align-items-center gap-2 py-1">
              <Avatar name={user.name} />
              <div className="text-truncate me-auto">
                <div className="fw-semibold text-truncate">{user.name} (you)</div>
                <div className="small text-muted text-truncate">{user.email}</div>
              </div>
              <span className="small text-muted">Owner</span>
            </li>
            {info.people.map((p) => (
              <li key={p.id} className="d-flex align-items-center gap-2 py-1">
                <Avatar name={p.user.name} />
                <div className="text-truncate me-auto">
                  <div className="fw-semibold text-truncate">{p.user.name}</div>
                  <div className="small text-muted text-truncate">{p.user.email}</div>
                </div>
                <select className="form-select form-select-sm w-auto" value={p.role} disabled={busy}
                  aria-label={`Access for ${p.user.name}`} onChange={(e) => setPersonRole(p, e.target.value)}>
                  {ROLES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
                <button type="button" className="icon-btn" disabled={busy} onClick={() => remove(p)} aria-label={`Remove ${p.user.name}`} title="Remove access">
                  <FontAwesomeIcon icon={faXmark} />
                </button>
              </li>
            ))}
          </ul>

          {/* Public link: off on this server, on (copy or turn off), or not made yet. */}
          <h3 className="h6 fw-bold"><FontAwesomeIcon icon={faGlobe} className="me-2" />Public link</h3>
          {!info.linkSharing ? (
            <p className="small text-muted mb-0">Public links are turned off on this server.</p>
          ) : info.link ? (
            <>
              <p className="small text-muted mb-2">Anyone with this link can view{item.kind === 'folder' ? ' everything in this folder' : ' this file'} and download it, without signing in.</p>
              <div className="input-group input-group-sm mb-2">
                <input className="form-control" readOnly value={linkUrl} aria-label="Public link" onFocus={(e) => e.target.select()} />
                <button type="button" className="btn btn-outline-primary" onClick={copyLink}><FontAwesomeIcon icon={faCopy} className="me-1" />Copy</button>
              </div>
              <button type="button" className="btn btn-sm btn-outline-danger" disabled={busy} onClick={() => apply(() => filesApi.removeLink(item.id))}>
                Turn off link
              </button>
            </>
          ) : (
            <>
              <p className="small text-muted mb-2">Only the people above can open it.</p>
              <button type="button" className="btn btn-sm btn-outline-primary" disabled={busy} onClick={() => apply(() => filesApi.createLink(item.id))}>
                <FontAwesomeIcon icon={faLink} className="me-1" />Create a public link
              </button>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
