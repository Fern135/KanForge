import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faShieldHalved, faUser, faRightFromBracket, faKey } from '@fortawesome/free-solid-svg-icons';
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
  const [pinEnabled, setPinEnabled] = useState(null);
  const [pinForm, setPinForm] = useState(null);
  const [pinInput, setPinInput] = useState({ pin: '', confirm: '', currentPassword: '' });

  useEffect(() => {
    authApi.pinStatus().then((d) => setPinEnabled(d.enabled)).catch(() => setPinEnabled(false));
  }, []);

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

  const closePinForm = () => {
    setPinForm(null);
    setPinInput({ pin: '', confirm: '', currentPassword: '' });
  };

  const submitPin = async (e) => {
    e.preventDefault();
    setBusy('pin');
    try {
      if (pinForm === 'disable') {
        await authApi.disablePin({ currentPassword: pinInput.currentPassword });
        setPinEnabled(false);
        toast.success('Security PIN turned off');
      } else {
        await authApi.setPin({ currentPassword: pinInput.currentPassword, pin: pinInput.pin });
        toast.success(pinEnabled ? 'Security PIN changed' : 'Security PIN turned on');
        setPinEnabled(true);
      }
      closePinForm();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy('');
    }
  };

  const digits = (v) => v.replace(/\D/g, '').slice(0, 8);
  const pinValid = pinInput.currentPassword
    && (pinForm === 'disable' || (/^\d{6,8}$/.test(pinInput.pin) && pinInput.pin === pinInput.confirm));

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

      <section className="card border-0 shadow-sm mb-4">
        <div className="card-body">
          <div className="d-flex align-items-center justify-content-between gap-2 mb-1">
            <h2 className="h6 fw-bold mb-0"><FontAwesomeIcon icon={faKey} className="me-2 text-success" />Security PIN</h2>
            {pinEnabled !== null && (
              <span className={`badge ${pinEnabled ? 'text-bg-success' : 'text-bg-secondary'}`}>{pinEnabled ? 'On' : 'Off'}</span>
            )}
          </div>
          <p className="text-muted small mb-3">
            Sign in with just a 6 to 8 digit PIN on this device. Other devices ask for your password once, then the PIN
            works there too. Your password keeps working either way.
          </p>
          {pinForm ? (
            <form onSubmit={submitPin}>
              {pinForm === 'set' && (
                <>
                  <input type="password" className="form-control mb-2" placeholder={pinEnabled ? 'New PIN (6-8 digits)' : 'PIN (6-8 digits)'}
                    inputMode="numeric" autoComplete="off" value={pinInput.pin}
                    onChange={(e) => setPinInput({ ...pinInput, pin: digits(e.target.value) })} />
                  <input type="password" className="form-control mb-2" placeholder="Confirm PIN" inputMode="numeric" autoComplete="off"
                    value={pinInput.confirm} onChange={(e) => setPinInput({ ...pinInput, confirm: digits(e.target.value) })} />
                </>
              )}
              <input type="password" className="form-control mb-3" placeholder="Current password" autoComplete="current-password"
                maxLength={128} value={pinInput.currentPassword}
                onChange={(e) => setPinInput({ ...pinInput, currentPassword: e.target.value })} />
              <div className="d-flex gap-2">
                <button className={`btn ${pinForm === 'disable' ? 'btn-danger' : 'btn-primary'}`} type="submit" disabled={busy === 'pin' || !pinValid}>
                  {pinForm === 'disable' ? 'Turn off PIN' : pinEnabled ? 'Change PIN' : 'Turn on PIN'}
                </button>
                <button className="btn btn-outline-secondary" type="button" onClick={closePinForm}>Cancel</button>
              </div>
            </form>
          ) : pinEnabled ? (
            <div className="d-flex gap-2">
              <button type="button" className="btn btn-outline-primary" onClick={() => setPinForm('set')}>Change PIN</button>
              <button type="button" className="btn btn-outline-danger" onClick={() => setPinForm('disable')}>Turn off</button>
            </div>
          ) : (
            <button type="button" className="btn btn-primary" disabled={pinEnabled === null} onClick={() => setPinForm('set')}>Add security PIN</button>
          )}
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
