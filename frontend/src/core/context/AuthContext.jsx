import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { hasCsrfCookie, onSessionChange, refreshSession, setSession } from '../api/client';
import { authApi } from '../api/endpoints';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    const off = onSessionChange(({ token, user: u }) => {
      if (!token) {
        setUser(null);
        setStatus('anon');
      } else if (u) {
        setUser(u);
        setStatus('authed');
      }
    });
    // Restore the session from the refresh cookie. Skip the call entirely
    // when there's clearly no session.
    if (hasCsrfCookie()) {
      refreshSession().catch(() => setStatus('anon'));
    } else {
      setStatus('anon');
    }
    return off;
  }, []);

  const login = useCallback(async (credentials) => {
    const data = await authApi.login(credentials);
    setSession(data.accessToken, data.user);
  }, []);

  const loginWithPin = useCallback(async (credentials) => {
    const data = await authApi.loginWithPin(credentials);
    setSession(data.accessToken, data.user);
  }, []);

  const register = useCallback(async (payload) => {
    const data = await authApi.register(payload);
    setSession(data.accessToken, data.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setSession(null);
    }
  }, []);

  const logoutAll = useCallback(async () => {
    try {
      await authApi.logoutAll();
    } finally {
      setSession(null);
    }
  }, []);

  const value = useMemo(
    () => ({ user, status, login, loginWithPin, register, logout, logoutAll, setUser }),
    [user, status, login, loginWithPin, register, logout, logoutAll],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
