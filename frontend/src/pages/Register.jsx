import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faEnvelope, faLock, faUser } from '@fortawesome/free-solid-svg-icons';
import { useAuth } from '../context/AuthContext';
import { errorMessage } from '../api/client';
import AuthLayout from './AuthLayout';

function strength(pw) {
  let score = 0;
  if (pw.length >= 12) score += 1;
  if (pw.length >= 16) score += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 1;
  if (/\d/.test(pw)) score += 1;
  if (/[^A-Za-z0-9]/.test(pw)) score += 1;
  return score;
}
const LEVELS = [
  ['Too weak', 'danger'], ['Weak', 'danger'], ['Fair', 'warning'], ['Good', 'info'], ['Strong', 'success'], ['Excellent', 'success'],
];

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const score = useMemo(() => strength(form.password), [form.password]);
  const [label, variant] = LEVELS[score];
  const valid = form.name.trim() && form.email && form.password.length >= 12 && form.password === form.confirm;

  const submit = async (e) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setError('');
    try {
      await register({ name: form.name.trim(), email: form.email, password: form.password });
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Could not create account'));
    } finally {
      setBusy(false);
    }
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <AuthLayout title="Create your account" subtitle="Boards, lists and cards, organized your way.">
      <form onSubmit={submit} noValidate>
        {error && <div className="alert alert-danger py-2" role="alert">{error}</div>}
        <label className="form-label fw-semibold" htmlFor="name">Name</label>
        <div className="input-group mb-3">
          <span className="input-group-text"><FontAwesomeIcon icon={faUser} /></span>
          <input id="name" className="form-control" autoComplete="name" maxLength={60} required value={form.name} onChange={set('name')} />
        </div>
        <label className="form-label fw-semibold" htmlFor="email">Email</label>
        <div className="input-group mb-3">
          <span className="input-group-text"><FontAwesomeIcon icon={faEnvelope} /></span>
          <input id="email" type="email" className="form-control" autoComplete="email" maxLength={254} required value={form.email} onChange={set('email')} />
        </div>
        <label className="form-label fw-semibold" htmlFor="password">Password</label>
        <div className="input-group mb-1">
          <span className="input-group-text"><FontAwesomeIcon icon={faLock} /></span>
          <input id="password" type="password" className="form-control" autoComplete="new-password" minLength={12} maxLength={128} required value={form.password} onChange={set('password')} />
        </div>
        {form.password && (
          <div className="mb-3">
            <div className="progress" style={{ height: 6 }}>
              <div className={`progress-bar bg-${variant}`} style={{ width: `${(score / 5) * 100}%` }} />
            </div>
            <small className={`text-${variant}`}>{label}{form.password.length < 12 && ' · at least 12 characters'}</small>
          </div>
        )}
        {!form.password && <div className="form-text mb-3">At least 12 characters. A passphrase works great.</div>}
        <label className="form-label fw-semibold" htmlFor="confirm">Confirm password</label>
        <input id="confirm" type="password" className={`form-control mb-4 ${form.confirm && form.confirm !== form.password ? 'is-invalid' : ''}`}
          autoComplete="new-password" maxLength={128} required value={form.confirm} onChange={set('confirm')} />
        <button type="submit" className="btn btn-primary w-100 py-2 fw-semibold" disabled={busy || !valid}>
          {busy ? <span className="spinner-border spinner-border-sm" /> : 'Create account'}
        </button>
        <p className="text-center text-muted mt-4 mb-0">
          Already have an account? <Link to="/login" className="fw-semibold">Sign in</Link>
        </p>
      </form>
    </AuthLayout>
  );
}
