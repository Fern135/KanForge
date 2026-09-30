import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { authApi } from '../api/endpoints';
import { errorMessage, setSession } from '../api/client';
import AuthLayout from './AuthLayout';

// Shown instead of every page while the account still has a temporary password
// from a platform admin. The server refuses everything else until it's replaced.
export default function ChoosePassword() {
  const { user, logout } = useAuth();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    if (form.newPassword !== form.confirm) {
      setError("The new passwords don't match");
      return;
    }
    setBusy(true);
    setError('');
    try {
      const data = await authApi.changePassword({ currentPassword: form.currentPassword, newPassword: form.newPassword });
      setSession(data.accessToken, data.user);
      // Load the app fresh, now that the account can use it.
      window.location.reload();
    } catch (err) {
      setError(errorMessage(err, 'Could not change the password'));
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Choose your password" subtitle={`Welcome, ${user.name}. Replace the temporary password you were given with one only you know.`}>
      <form onSubmit={submit}>
        {error && <div className="alert alert-danger py-2 small">{error}</div>}
        <input type="email" className="d-none" autoComplete="username" value={user.email} readOnly />
        <label className="form-label fw-semibold" htmlFor="temp-password">Temporary password</label>
        <input id="temp-password" type="password" className="form-control mb-3" autoComplete="current-password" maxLength={128}
          value={form.currentPassword} onChange={set('currentPassword')} required />
        <label className="form-label fw-semibold" htmlFor="new-password">New password</label>
        <input id="new-password" type="password" className="form-control mb-3" autoComplete="new-password" minLength={12} maxLength={128}
          placeholder="12+ characters" value={form.newPassword} onChange={set('newPassword')} required />
        <label className="form-label fw-semibold" htmlFor="confirm-password">Confirm new password</label>
        <input id="confirm-password" type="password" className="form-control mb-4" autoComplete="new-password" maxLength={128}
          value={form.confirm} onChange={set('confirm')} required />
        <button type="submit" className="btn btn-primary w-100" disabled={busy}>Save password</button>
        <button type="button" className="btn btn-link w-100 mt-2" onClick={logout}>Sign out</button>
      </form>
    </AuthLayout>
  );
}
