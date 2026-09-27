import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faEnvelope, faLock, faEye, faEyeSlash } from '@fortawesome/free-solid-svg-icons';
import { useAuth } from '../context/AuthContext';
import { errorMessage } from '../api/client';
import AuthLayout from './AuthLayout';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(form);
      navigate('/', { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Could not sign in'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to continue to your boards.">
      <form onSubmit={submit} noValidate>
        {error && <div className="alert alert-danger py-2" role="alert">{error}</div>}
        <label className="form-label fw-semibold" htmlFor="email">Email</label>
        <div className="input-group mb-3">
          <span className="input-group-text"><FontAwesomeIcon icon={faEnvelope} /></span>
          <input id="email" type="email" className="form-control" autoComplete="email" required maxLength={254}
            value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <label className="form-label fw-semibold" htmlFor="password">Password</label>
        <div className="input-group mb-4">
          <span className="input-group-text"><FontAwesomeIcon icon={faLock} /></span>
          <input id="password" type={show ? 'text' : 'password'} className="form-control" autoComplete="current-password" required maxLength={128}
            value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <button type="button" className="btn btn-outline-secondary" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}>
            <FontAwesomeIcon icon={show ? faEyeSlash : faEye} />
          </button>
        </div>
        <button type="submit" className="btn btn-primary w-100 py-2 fw-semibold" disabled={busy || !form.email || !form.password}>
          {busy ? <span className="spinner-border spinner-border-sm" /> : 'Sign in'}
        </button>
        <p className="text-center text-muted mt-4 mb-0">
          New here? <Link to="/register" className="fw-semibold">Create an account</Link>
        </p>
      </form>
    </AuthLayout>
  );
}
