import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBuilding, faChartColumn, faUserShield } from '@fortawesome/free-solid-svg-icons';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { adminApi } from '../api/endpoints';
import { errorMessage } from '../api/client';
import Spinner from '../components/Spinner';
import Modal from '../components/Modal';
import ConfirmModal from '../components/ConfirmModal';
import AdminPeople from './AdminPeople';
import AdminDeletionRequests from './AdminDeletionRequests';
import './admin.scss';

// Paid plans only: Self-hosted workspaces are private and never appear here.
const PLANS = [['standard', 'Standard'], ['plus', 'Plus']];
// Each plan keeps its colour wherever it appears (validated categorical palette, light steps).
const PLAN_COLORS = { standard: '#2a78d6', plus: '#eb6834' };
const PLAN_ORDER = ['standard', 'plus'];
// The sign-ups chart is one series: categorical slot 1.
const SIGNUPS_COLOR = '#2a78d6';

const num = (n) => n.toLocaleString('en-US');
const money = (n) => n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const weekLabel = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

// Changes need the password typed again (then not for 10 minutes on this device).
function ConfirmPassword({ onConfirmed, onClose }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await adminApi.confirm(password);
      onConfirmed();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Confirm it's you"
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn-light" onClick={onClose}>Cancel</button>
          <button type="submit" form="admin-confirm" className="btn btn-primary" disabled={busy || !password}>Confirm</button>
        </>
      )}
    >
      <form id="admin-confirm" onSubmit={submit}>
        <p className="small text-muted">Enter your password to change platform settings. You won&apos;t be asked again for 10 minutes on this device.</p>
        {error && <div className="alert alert-danger py-2 small">{error}</div>}
        <label className="form-label fw-semibold" htmlFor="admin-password">Password</label>
        <input id="admin-password" type="password" className="form-control" autoComplete="current-password" maxLength={128}
          value={password} onChange={(e) => setPassword(e.target.value)} required />
      </form>
    </Modal>
  );
}

function Tile({ label, value, note }) {
  return (
    <div className="admin-tile">
      <div className="admin-tile-label">{label}</div>
      <div className="admin-tile-value">{value}</div>
      {note && <div className="admin-tile-note">{note}</div>}
    </div>
  );
}

function useWidth(ref) {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

// A round top for the scale: 0-4 → 4, 7 → 8, 23 → 25, 180 → 200.
function niceMax(max) {
  if (max <= 4) return 4;
  const step = 10 ** Math.floor(Math.log10(max));
  return [1, 2, 2.5, 5, 10].map((m) => m * step).find((v) => v >= max);
}

// Sign-ups per week: one series, so the title names it and there's no legend.
function SignupsChart({ weeks }) {
  const wrapRef = useRef(null);
  const width = useWidth(wrapRef);
  const [hover, setHover] = useState(null);
  const H = 220;
  const pad = { top: 22, right: 8, bottom: 26, left: 36 };
  const top = niceMax(Math.max(...weeks.map((w) => w.signups)));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(top * f));
  const plotW = Math.max(0, width - pad.left - pad.right);
  const plotH = H - pad.top - pad.bottom;
  const slot = plotW / weeks.length;
  const barW = Math.min(24, slot * 0.6);
  const y = (v) => pad.top + plotH - (v / top) * plotH;
  const everyOther = slot < 44;
  const last = weeks.length - 1;

  return (
    <div className="admin-chart" ref={wrapRef}>
      {width > 0 && (
        <svg width={width} height={H} role="img" aria-label="Sign-ups per week for the last 12 weeks">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} className="admin-grid" />
              <text x={pad.left - 8} y={y(t)} className="admin-axis" textAnchor="end" dominantBaseline="middle">{num(t)}</text>
            </g>
          ))}
          {weeks.map((w, i) => {
            const cx = pad.left + slot * i + slot / 2;
            const h = Math.max(0, y(0) - y(w.signups));
            const x = cx - barW / 2;
            const r = Math.min(4, h / 2, barW / 2);
            return (
              <g key={w.weekStart}>
                {h > 0 && (
                  <path
                    d={`M${x},${y(0)} V${y(0) - h + r} Q${x},${y(0) - h} ${x + r},${y(0) - h} H${x + barW - r} Q${x + barW},${y(0) - h} ${x + barW},${y(0) - h + r} V${y(0)} Z`}
                    fill={SIGNUPS_COLOR}
                    opacity={hover === null || hover === i ? 1 : 0.55}
                  />
                )}
                {(!everyOther || i % 2 === last % 2) && (
                  <text x={cx} y={H - 8} className="admin-axis" textAnchor="middle">{weekLabel(w.weekStart)}</text>
                )}
                {i === last && <text x={cx} y={y(w.signups) - 6} className="admin-value" textAnchor="middle">{num(w.signups)}</text>}
                {/* A hit target as wide as the column's slot, easier to hover than the bar. */}
                <rect x={pad.left + slot * i} y={pad.top} width={slot} height={plotH} fill="transparent"
                  onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
              </g>
            );
          })}
        </svg>
      )}
      {hover !== null && width > 0 && (
        <div className="admin-tooltip" style={{ left: Math.min(width - 150, Math.max(0, pad.left + slot * hover + slot / 2 - 75)), top: Math.max(0, y(weeks[hover].signups) - 52) }}>
          <div className="fw-semibold">{num(weeks[hover].signups)} sign-ups</div>
          <div className="text-muted">Week of {weekLabel(weeks[hover].weekStart)}</div>
        </div>
      )}
      <table className="visually-hidden">
        <caption>Sign-ups per week</caption>
        <thead><tr><th>Week of</th><th>Sign-ups</th></tr></thead>
        <tbody>{weeks.map((w) => <tr key={w.weekStart}><td>{weekLabel(w.weekStart)}</td><td>{w.signups}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

// Seats by plan: one stacked bar (2px gaps between plans), a legend, and the numbers in a table.
function PlanMix({ plans }) {
  const ordered = PLAN_ORDER.map((id) => plans.find((p) => p.plan === id)).filter(Boolean);
  const seats = ordered.reduce((s, p) => s + p.seats, 0);
  return (
    <>
      {seats > 0 && (
        <div className="admin-stack" role="img" aria-label="Seats by plan">
          {ordered.filter((p) => p.seats).map((p) => (
            <div key={p.plan} style={{ flexGrow: p.seats, background: PLAN_COLORS[p.plan] }} title={`${p.name}: ${num(p.seats)} seats`} />
          ))}
        </div>
      )}
      <div className="table-responsive">
        <table className="table table-sm align-middle mb-0 admin-table">
          <thead>
            <tr><th>Plan</th><th className="text-end">Workspaces</th><th className="text-end">Seats</th><th className="text-end">Share of seats</th><th className="text-end">Price</th><th className="text-end">Est. monthly</th></tr>
          </thead>
          <tbody>
            {ordered.map((p) => (
              <tr key={p.plan}>
                <td><span className="admin-swatch" style={{ background: PLAN_COLORS[p.plan] }} />{p.name}</td>
                <td className="text-end">{num(p.workspaces)}</td>
                <td className="text-end">{num(p.seats)}</td>
                <td className="text-end">{seats ? `${Math.round((p.seats / seats) * 100)}%` : '–'}</td>
                <td className="text-end text-muted">{p.seatPrice ? `${money(p.seatPrice)}/seat` : 'Free'}</td>
                <td className="text-end">{money(p.monthlyRevenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// Platform admin: runs the whole server. On the hosted service it sees totals and
// workspace names and seats, never what's inside a workspace, and only admins are
// listed by name. On a self-hosted install it also manages the server's people
// and what each of them can use (AdminPeople).
export default function Admin() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [stats, setStats] = useState(null);
  const [selfHosted, setSelfHosted] = useState(false);
  const [workspaces, setWorkspaces] = useState(null);
  const [admins, setAdmins] = useState(null);
  const [filter, setFilter] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState('');
  const [removing, setRemoving] = useState(null);
  // Bumped when an account is deleted from one list, so the other reloads.
  const [peopleVersion, setPeopleVersion] = useState(0);
  // A change waiting for the password: retried once it's confirmed.
  const [pending, setPending] = useState(null);

  const loadStats = () => adminApi.stats().then((d) => {
    setStats(d.stats);
    setSelfHosted(Boolean(d.selfHosted));
  }).catch((err) => toast.error(errorMessage(err)));

  useEffect(() => {
    loadStats();
    adminApi.workspaces().then((d) => setWorkspaces(d.workspaces)).catch((err) => toast.error(errorMessage(err)));
    adminApi.admins().then((d) => setAdmins(d.admins)).catch((err) => toast.error(errorMessage(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast]);

  // Runs a change, asking for the password first if the server wants it (the
  // change then runs once it's confirmed). Returns 'done', 'reauth' or 'failed'.
  const guarded = async (action) => {
    try {
      await action();
      return 'done';
    } catch (err) {
      if (err?.response?.data?.error?.code === 'REAUTH_REQUIRED') {
        setPending(() => action);
        return 'reauth';
      }
      toast.error(errorMessage(err));
      return 'failed';
    }
  };

  const confirmed = async () => {
    const action = pending;
    setPending(null);
    await guarded(action);
  };

  const setPlan = async (ws, plan) => {
    setBusy(`ws:${ws.id}`);
    await guarded(async () => {
      const { workspace } = await adminApi.updateWorkspace(ws.id, { plan });
      setWorkspaces((list) => list.map((w) => (w.id === ws.id ? workspace : w)));
      toast.success(`${ws.name} is now on ${workspace.planName}`);
      loadStats();
    });
    setBusy('');
  };

  const addAdmin = async (e) => {
    e.preventDefault();
    setBusy('add');
    await guarded(async () => {
      const { admin } = await adminApi.addAdmin(email.trim());
      setAdmins((list) => [...list, admin]);
      setEmail('');
      toast.success(`${admin.name} is now a platform admin`);
    });
    setBusy('');
  };

  // From the confirm dialog: it closes unless the change failed outright.
  const removeAdmin = async (target) => {
    const result = await guarded(async () => {
      await adminApi.removeAdmin(target.id);
      setAdmins((list) => list.filter((a) => a.id !== target.id));
      toast.success(`${target.name} is no longer a platform admin`);
      // Removing yourself takes you out of this page.
      if (target.id === user.id) setUser({ ...user, role: 'user' });
    });
    if (result === 'failed') throw new Error('not removed');
  };

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = [...(workspaces || [])].sort((a, b) => b.seats - a.seats || a.name.localeCompare(b.name));
    return q ? list.filter((w) => w.name.toLowerCase().includes(q) || w.slug.includes(q)) : list;
  }, [workspaces, filter]);

  if (!stats || !workspaces || !admins) return <Spinner fullscreen />;
  const thisWeek = stats.signups.at(-1)?.signups ?? 0;
  const activeShare = stats.accounts ? Math.round((stats.active7 / stats.accounts) * 100) : 0;

  return (
    <main className="container py-4" style={{ maxWidth: 1040 }}>
      <h1 className="h4 fw-bold text-primary mb-1">Platform admin</h1>
      <p className="text-muted small mb-4">
        {selfHosted
          ? 'Your server: who can sign in, what each person can use, and who runs it.'
          : 'Totals for the hosted service. Workspace content, who is in each workspace, and Self-hosted workspaces stay private.'}
      </p>

      <section className="admin-tiles mb-4" aria-label="Totals">
        <Tile label="Accounts" value={num(stats.accounts)} note={`${num(thisWeek)} new this week`} />
        <Tile label="Active, last 7 days" value={num(stats.active7)} note={`${activeShare}% of accounts · ${num(stats.active30)} in 30 days`} />
        {!selfHosted && (
          <>
            <Tile label="Workspaces" value={num(stats.workspaces)} />
            <Tile label="Seats" value={num(stats.seats)} note="One per person per workspace" />
            <Tile label="Est. monthly revenue" value={money(stats.monthlyRevenue)} note="Seats × plan price" />
            <Tile label="Est. yearly revenue" value={money(stats.yearlyRevenue)} note="Monthly × 12" />
          </>
        )}
      </section>

      {selfHosted && <AdminPeople key={peopleVersion} currentUserId={user.id} guarded={guarded} onDeleted={() => setPeopleVersion((v) => v + 1)} />}
      <AdminDeletionRequests key={`requests-${peopleVersion}`} guarded={guarded} onDeleted={() => setPeopleVersion((v) => v + 1)} />

      <div className="row g-4 mb-4">
        <div className={selfHosted ? 'col-12' : 'col-lg-6'}>
          <section className="card border-0 shadow-sm h-100">
            <div className="card-body">
              <h2 className="h6 fw-bold mb-1"><FontAwesomeIcon icon={faChartColumn} className="me-2 text-success" />Sign-ups per week</h2>
              <p className="text-muted small mb-2">New accounts in each of the last 12 weeks (weeks start on Monday).</p>
              <SignupsChart weeks={stats.signups} />
            </div>
          </section>
        </div>
        {!selfHosted && (
          <div className="col-lg-6">
            <section className="card border-0 shadow-sm h-100">
              <div className="card-body">
                <h2 className="h6 fw-bold mb-1"><FontAwesomeIcon icon={faChartColumn} className="me-2 text-success" />Plans</h2>
                <p className="text-muted small mb-3">Seats and estimated revenue by plan, until real payments are connected.</p>
                <PlanMix plans={stats.plans} />
              </div>
            </section>
          </div>
        )}
      </div>

      {!selfHosted && (
        <section className="card border-0 shadow-sm mb-4">
          <div className="card-body">
            <div className="d-flex flex-column flex-sm-row align-items-sm-center justify-content-between gap-2 mb-1">
              <h2 className="h6 fw-bold mb-0"><FontAwesomeIcon icon={faBuilding} className="me-2 text-success" />Workspaces</h2>
              <input type="search" className="form-control form-control-sm" style={{ maxWidth: 240 }} placeholder="Find a workspace"
                aria-label="Find a workspace" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </div>
            <p className="text-muted small mb-3">A plan decides a workspace&apos;s apps and limits. Largest first.</p>
            <ul className="list-group list-group-flush admin-workspaces">
              {shown.map((w) => (
                <li className="list-group-item px-0 d-flex flex-column flex-sm-row align-items-sm-center justify-content-between gap-2" key={w.id}>
                  <div className="text-truncate">
                    <span className="fw-semibold">{w.name}</span>
                    <div className="text-muted small text-truncate">
                      /app/w/{w.slug} · {w.seats} {w.seats === 1 ? 'seat' : 'seats'} · since {new Date(w.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                    </div>
                  </div>
                  <select className="form-select form-select-sm flex-shrink-0" style={{ width: 'auto' }} value={w.plan} disabled={busy === `ws:${w.id}`}
                    aria-label={`Plan for ${w.name}`} onChange={(e) => setPlan(w, e.target.value)}>
                    {PLANS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                  </select>
                </li>
              ))}
              {!shown.length && <li className="list-group-item px-0 text-muted small">No workspace matches.</li>}
            </ul>
          </div>
        </section>
      )}

      <section className="card border-0 shadow-sm">
        <div className="card-body">
          <h2 className="h6 fw-bold mb-1"><FontAwesomeIcon icon={faUserShield} className="me-2 text-success" />Platform admins</h2>
          <p className="text-muted small mb-3">
            {selfHosted ? 'They manage people, what each person can use, and other platform admins.' : 'They manage plans and other platform admins.'}
            {' '}There&apos;s always at least one, and they always have full access to every app.
          </p>
          <form className="d-flex flex-column flex-sm-row gap-2 mb-3" onSubmit={addAdmin}>
            <label className="visually-hidden" htmlFor="admin-email">Email</label>
            <input id="admin-email" type="email" className="form-control" maxLength={254} placeholder="Email of an existing account"
              value={email} onChange={(e) => setEmail(e.target.value)} required />
            <button type="submit" className="btn btn-primary flex-shrink-0" disabled={busy === 'add' || !email.trim()}>Make admin</button>
          </form>
          <ul className="list-group list-group-flush">
            {admins.map((a) => (
              <li className="list-group-item px-0 d-flex align-items-center justify-content-between gap-2" key={a.id}>
                <div className="text-truncate">
                  <span className="fw-semibold">{a.name}</span>
                  {a.id === user.id && <span className="text-muted small"> (you)</span>}
                  <div className="text-muted small text-truncate">{a.email}</div>
                </div>
                <button type="button" className="btn btn-sm btn-outline-danger flex-shrink-0" disabled={admins.length === 1}
                  title={admins.length === 1 ? 'There must be at least one platform admin' : undefined} onClick={() => setRemoving(a)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {removing && (
        <ConfirmModal
          title={removing.id === user.id ? 'Stop being a platform admin?' : `Remove ${removing.name} as platform admin?`}
          message={removing.id === user.id
            ? "You'll lose access to this page right away. Your account and workspaces are unaffected."
            : 'Their account and workspaces are unaffected. They just stop managing the platform.'}
          confirmLabel="Remove"
          onClose={() => setRemoving(null)}
          onConfirm={() => removeAdmin(removing)}
        />
      )}
      {pending && <ConfirmPassword onConfirmed={confirmed} onClose={() => setPending(null)} />}
    </main>
  );
}
