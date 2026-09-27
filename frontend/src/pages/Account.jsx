import { useState } from 'react';
import { useNavigate } from 'react-router';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faShieldHalved, faUser, faRightFromBracket } from '@fortawesome/free-solid-svg-icons';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { authApi } from '../api/endpoints';
import { errorMessage, setSession } from '../api/client';

export default function Account() {
  const { user, setUser, logoutAll } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState(user.name);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [busy, setBusy] = useState('');

  const saveName = async (e) => {
    e.preventDefault();
    setBusy('name');
    try {
      const data = await authApi.updateProfile({ name: name.trim() });
      setUser(data.user);
      toast.success('Profile updated');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy('');
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    setBusy('pw');
    try {
      const data = await authApi.changePassword({ currentPassword: pw.currentPassword, newPassword: pw.newPassword });
      setSession(data.accessToken, data.user);
      setPw({ currentPassword: '', newPassword: '', confirm: '' });
      toast.success('Password changed. Other sessions were signed out.');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy('');
    }
  };

  const signOutEverywhere = async () => {
    await logoutAll().catch(() => {});
    navigate('/login', { replace: true });
  };

  const pwValid = pw.currentPassword && pw.newPassword.length >= 12 && pw.newPassword === pw.confirm;

  return (
    <main className="container py-4" style={{ maxWidth: 640 }}>
      <h1 className="h4 fw-bold text-primary mb-4">Account &amp; security</h1>

      <section className="card border-0 shadow-sm mb-4">
        <div className="card-body">
          <h2 className="h6 fw-bold mb-3"><FontAwesomeIcon icon={faUser} className="me-2 text-success" />Profile</h2>
          <form onSubmit={saveName} className="d-flex flex-column flex-sm-row gap-2">
            <input className="form-control" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} aria-label="Name" />
            <button className="btn btn-primary" type="submit" disabled={busy === 'name' || !name.trim() || name.trim() === user.name}>Save</button>
          </form>
          <div className="form-text">{user.email}</div>
        </div>
      </section>

      <section className="card border-0 shadow-sm mb-4">
        <div className="card-body">
          <h2 className="h6 fw-bold mb-3"><FontAwesomeIcon icon={faShieldHalved} className="me-2 text-success" />Change password</h2>
          <form onSubmit={changePassword}>
            <input type="password" className="form-control mb-2" placeholder="Current password" autoComplete="current-password"
              value={pw.currentPassword} maxLength={128} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />
            <input type="password" className="form-control mb-2" placeholder="New password (12+ characters)" autoComplete="new-password"
              value={pw.newPassword} maxLength={128} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
            <input type="password" className="form-control mb-3" placeholder="Confirm new password" autoComplete="new-password"
              value={pw.confirm} maxLength={128} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
            <button className="btn btn-primary" type="submit" disabled={busy === 'pw' || !pwValid}>Update password</button>
          </form>
        </div>
      </section>

      <section className="card border-0 shadow-sm">
        <div className="card-body d-flex flex-column flex-sm-row align-items-sm-center justify-content-between gap-2">
          <div>
            <h2 className="h6 fw-bold mb-1">Sign out everywhere</h2>
            <p className="text-muted small mb-0">Ends every session on all your devices, including this one.</p>
          </div>
          <button type="button" className="btn btn-outline-danger" onClick={signOutEverywhere}>
            <FontAwesomeIcon icon={faRightFromBracket} className="me-2" />Sign out all
          </button>
        </div>
      </section>
    </main>
  );
}
