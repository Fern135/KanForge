import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faEnvelope, faLock, faEye, faEyeSlash, faKey } from '@fortawesome/free-solid-svg-icons';
import { useAuth } from '../context/AuthContext';
import { authApi } from '../api/endpoints';
import { errorMessage } from '../api/client';
import Spinner from '../components/Spinner';
import AuthLayout from './AuthLayout';

export default function Login() {
  const { login, loginWithPin } = useAuth();
  const navigate = useNavigate();
  // Keeps ?next=, so signing in returns to the page that asked for it.
  const { search } = useLocation();
  // The account this device can sign in to with a PIN: undefined while checking, null if none.
  const [pinUser, setPinUser] = useState(undefined);
  const [mode, setMode] = useState('password');
  const [form, setForm] = useState({ email: '', password: '' });
  const [pin, setPin] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    authApi.pinDevice()
      .then((d) => {
        setPinUser(d.user);
        if (d.user) setMode('pin');
      })
      .catch(() => setPinUser(null));
  }, []);

  const switchMode = (next) => {
    setMode(next);
    setError('');
    setShow(false);
    setPin('');
    setForm((f) => ({ ...f, password: '', email: next === 'password' && pinUser ? pinUser.email : f.email }));
  };

  const forgetDevice = async () => {
    await authApi.forgetPinDevice().catch(() => {});
    setPinUser(null);
    setForm({ email: '', password: '' });
    switchMode('password');
  };

  const run = async (fn) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      navigate(`/${search}`, { replace: true });
    } catch (err) {
      if (err?.response?.data?.error?.code === 'PIN_DEVICE_UNKNOWN') {
        setPinUser(null);
        setMode('password');
      }
      setError(errorMessage(err, 'Could not sign in'));
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = (e) => {
    e.preventDefault();
    run(() => login(form));
  };

  const submitPin = (e) => {
    e.preventDefault();
    run(async () => {
      try {
        await loginWithPin({ pin });
      } finally {
        setPin('');
      }
    });
  };

  if (pinUser === undefined) {
    return <AuthLayout title="Welcome back" subtitle="Sign in to continue to your boards."><Spinner /></AuthLayout>;
  }

  if (mode === 'pin' && pinUser) {
    return (
      <AuthLayout title={`Welcome back, ${pinUser.name}`} subtitle="Enter your security PIN to continue.">
        <form onSubmit={submitPin} noValidate>
          {error && <div className="alert alert-danger py-2" role="alert">{error}</div>}
          <div className="form-text mb-2">{pinUser.email}</div>
          <label className="form-label fw-semibold" htmlFor="pin">Security PIN</label>
          <div className="input-group mb-4">
            <span className="input-group-text"><FontAwesomeIcon icon={faKey} /></span>
            <input id="pin" type={show ? 'text' : 'password'} className="form-control" inputMode="numeric" autoComplete="off"
              autoFocus required maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
            <button type="button" className="btn btn-outline-secondary" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide PIN' : 'Show PIN'}>
              <FontAwesomeIcon icon={show ? faEyeSlash : faEye} />
            </button>
          </div>
          <button type="submit" className="btn btn-primary w-100 py-2 fw-semibold" disabled={busy || pin.length < 6}>
            {busy ? <span className="spinner-border spinner-border-sm" /> : 'Sign in'}
          </button>
          <div className="d-flex justify-content-between mt-4 small">
            <button type="button" className="btn btn-link p-0" onClick={() => switchMode('password')}>Use password instead</button>
            <button type="button" className="btn btn-link p-0" onClick={forgetDevice}>Not you?</button>
          </div>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to continue to your boards.">
      <form onSubmit={submitPassword} noValidate>
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
        {pinUser && (
          <button type="button" className="btn btn-outline-primary w-100 mt-2" onClick={() => switchMode('pin')}>
            <FontAwesomeIcon icon={faKey} className="me-2" />Use security PIN
          </button>
        )}
        <p className="text-center text-muted mt-4 mb-0">
          New here? <Link to="/register" className="fw-semibold">Create an account</Link>
        </p>
      </form>
    </AuthLayout>
  );
}
