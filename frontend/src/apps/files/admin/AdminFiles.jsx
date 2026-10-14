import { useEffect, useMemo, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faHardDrive, faCircleExclamation } from '@fortawesome/free-solid-svg-icons';
import { errorMessage } from '../../../core/api/client';
import { useToast } from '../../../core/context/ToastContext';
import Spinner from '../../../core/components/Spinner';
import { filesAdminApi } from '../api';
import { formatBytes, toGb, fromGb } from '../utils/format';

// The Files section of the platform admin page.
//
// Every server can turn public links on or off. A self-hosted server also sets
// how much each person can store (a default, and a different limit for anyone
// who needs one) and the largest single file, and sees what everyone uses.
// Hosted plans fix their limits per plan, so those controls don't show there.
//
// guarded(action): runs a change, asking for the admin's password first when
// the server wants it (see Admin.jsx). Returns 'done', 'reauth' or 'failed'.
export default function AdminFiles({ guarded }) {
  const toast = useToast();
  // { settings, people, configured, selfHosted, totalUsedBytes, technicalMaxFileBytes } from the API.
  const [data, setData] = useState(null);
  // The two server-wide limits as typed, in GB ('' means no limit).
  const [form, setForm] = useState({ defaultGb: '', maxFileGb: '' });
  // Narrows the people table by name or email.
  const [filter, setFilter] = useState('');
  // The person whose limit is being edited, and the value typed.
  const [editing, setEditing] = useState(null);
  // Which control is saving ('links', 'limits' or 'q:<userId>'), to disable just that one.
  const [busy, setBusy] = useState('');

  // Loads the settings and everyone's usage, and fills the form from the saved limits.
  const load = () => filesAdminApi.get().then((d) => {
    setData(d);
    setForm({ defaultGb: toGb(d.settings.defaultQuotaBytes), maxFileGb: toGb(d.settings.maxFileBytes) });
  }).catch((err) => toast.error(errorMessage(err)));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // People using the most storage first, filtered by the search box.
  const people = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = [...(data?.people || [])].sort((a, b) => b.usedBytes - a.usedBytes || a.name.localeCompare(b.name));
    return q ? list.filter((p) => p.name.toLowerCase().includes(q) || p.email.includes(q)) : list;
  }, [data, filter]);

  if (!data) return <section className="card border-0 shadow-sm mb-4"><div className="card-body text-center"><Spinner small /></div></section>;

  // A limit field is fine empty (no limit) or holding a number of GB, 0 or more.
  const valid = (text) => text.trim() === '' || (Number.isFinite(Number(text)) && Number(text) >= 0);

  // Saves server-wide settings. Asks for the admin's password first when needed.
  const saveSettings = async (changes, label) => {
    setBusy(label);
    await guarded(async () => {
      const { settings } = await filesAdminApi.updateSettings(changes);
      setData((d) => ({ ...d, settings }));
      toast.success('Files settings saved');
      // Everyone on the default limit sees the new one.
      load();
    });
    setBusy('');
  };

  // Saves the default storage per person and the largest file. A largest file of
  // 0 makes no sense, so it's read as "no limit".
  const saveLimits = (e) => {
    e.preventDefault();
    if (!valid(form.defaultGb) || !valid(form.maxFileGb)) {
      toast.error('Enter a number of GB, or leave it empty for no limit');
      return;
    }
    const maxFile = fromGb(form.maxFileGb);
    saveSettings({ defaultQuotaBytes: fromGb(form.defaultGb), maxFileBytes: maxFile === 0 ? null : maxFile }, 'limits');
  };

  // Gives one person their own limit (bytes, or null for unlimited), or with
  // bytes undefined puts them back on the default.
  const setQuota = async (person, bytes) => {
    setBusy(`q:${person.id}`);
    await guarded(async () => {
      const { quota } = bytes === undefined ? await filesAdminApi.resetQuota(person.id) : await filesAdminApi.setQuota(person.id, bytes);
      setData((d) => ({ ...d, people: d.people.map((p) => (p.id === person.id ? { ...p, ...quota } : p)) }));
      setEditing(null);
    });
    setBusy('');
  };

  const limitText = (bytes) => (bytes == null ? 'Unlimited' : formatBytes(bytes));

  return (
    <section className="card border-0 shadow-sm mb-4">
      <div className="card-body">
        <h2 className="h6 fw-bold mb-1"><FontAwesomeIcon icon={faHardDrive} className="me-2 text-success" />Files storage</h2>
        <p className="text-muted small mb-3">
          {data.selfHosted
            ? 'How much each person can store in Files, across every workspace on this server. Leave a limit empty for none.'
            : 'Storage limits come from each workspace\'s plan. Here you decide whether files can be shared by public link.'}
        </p>

        {!data.configured && (
          <div className="alert alert-warning small d-flex gap-2">
            <FontAwesomeIcon icon={faCircleExclamation} className="mt-1" />
            <span>
              No object storage is configured, so nobody can upload files yet. Set the S3_* settings in .env (the bundled
              Garage service sets them up for you with <code>make setup</code>), then restart.
            </span>
          </div>
        )}

        {/* Public links: a switch every server has. */}
        <div className="form-check form-switch mb-3">
          <input className="form-check-input" type="checkbox" role="switch" id="files-link-sharing" checked={data.settings.linkSharing}
            disabled={busy === 'links'} onChange={(e) => saveSettings({ linkSharing: e.target.checked }, 'links')} />
          <label className="form-check-label" htmlFor="files-link-sharing">
            Allow public links
            <span className="d-block small text-muted">Anyone with such a link can open the file or folder without signing in. Turning this off stops every existing link.</span>
          </label>
        </div>

        {data.selfHosted && (
          <>
            {/* Self-hosted only: the server-wide limits, then each person's usage and limit. */}
            <form className="row g-2 align-items-end mb-4" onSubmit={saveLimits}>
              <div className="col-sm-4">
                <label className="form-label small fw-semibold" htmlFor="files-default-quota">Storage per person (GB)</label>
                <input id="files-default-quota" className="form-control form-control-sm" inputMode="decimal" placeholder="Unlimited"
                  value={form.defaultGb} onChange={(e) => setForm({ ...form, defaultGb: e.target.value })} />
              </div>
              <div className="col-sm-4">
                <label className="form-label small fw-semibold" htmlFor="files-max-file">Largest file (GB)</label>
                <input id="files-max-file" className="form-control form-control-sm" inputMode="decimal" placeholder={`No limit (up to ${formatBytes(data.technicalMaxFileBytes)})`}
                  value={form.maxFileGb} onChange={(e) => setForm({ ...form, maxFileGb: e.target.value })} />
              </div>
              <div className="col-sm-4">
                <button type="submit" className="btn btn-sm btn-primary" disabled={busy === 'limits'}>Save limits</button>
              </div>
            </form>

            <div className="d-flex flex-column flex-sm-row align-items-sm-center justify-content-between gap-2 mb-2">
              <div className="small">
                <span className="fw-semibold">{formatBytes(data.totalUsedBytes)}</span> <span className="text-muted">stored in total, trash included</span>
              </div>
              <input type="search" className="form-control form-control-sm" style={{ maxWidth: 240 }} placeholder="Find a person"
                aria-label="Find a person" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
            <div className="table-responsive">
              <table className="table table-sm align-middle mb-0 admin-table">
                <thead>
                  <tr><th>Person</th><th className="text-end">Used</th><th>Limit</th><th /></tr>
                </thead>
                <tbody>
                  {people.map((p) => (
                    <tr key={p.id}>
                      <td className="text-truncate" style={{ maxWidth: 260 }}>
                        <div className="fw-semibold text-truncate">{p.name}</div>
                        <div className="small text-muted text-truncate">{p.email}</div>
                      </td>
                      <td className="text-end text-nowrap">
                        {formatBytes(p.usedBytes)}
                        {p.quotaBytes ? <div className="small text-muted">{Math.min(100, Math.round((p.usedBytes / p.quotaBytes) * 100))}%</div> : null}
                      </td>
                      <td className="text-nowrap">
                        {/* Editing this person's limit inline, or showing it and where it comes from. */}
                        {editing?.id === p.id ? (
                          <form className="d-flex gap-1" onSubmit={(e) => {
                            e.preventDefault();
                            if (!valid(editing.value)) return toast.error('Enter a number of GB, or leave it empty for unlimited');
                            return setQuota(p, fromGb(editing.value));
                          }}>
                            <input className="form-control form-control-sm" style={{ width: 110 }} inputMode="decimal" placeholder="Unlimited" autoFocus
                              aria-label={`Storage limit for ${p.name} in GB`} value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} />
                            <button type="submit" className="btn btn-sm btn-primary" disabled={busy === `q:${p.id}`}>Set</button>
                            <button type="button" className="btn btn-sm btn-light" onClick={() => setEditing(null)}>Cancel</button>
                          </form>
                        ) : (
                          <>
                            {limitText(p.quotaBytes)}
                            <span className="small text-muted ms-1">{p.custom ? '(own limit)' : '(default)'}</span>
                          </>
                        )}
                      </td>
                      <td className="text-end text-nowrap">
                        {editing?.id !== p.id && (
                          <>
                            <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => setEditing({ id: p.id, value: toGb(p.quotaBytes) })}>Change</button>
                            {p.custom && (
                              <button type="button" className="btn btn-sm btn-link" disabled={busy === `q:${p.id}`} onClick={() => setQuota(p, undefined)}>Use default</button>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!people.length && <tr><td colSpan={4} className="text-muted small">No one matches.</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
