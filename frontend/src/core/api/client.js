import axios from 'axios';

// The access token lives only in memory, never in localStorage, so injected
// scripts can't lift it from storage. The long-lived refresh token is an
// httpOnly cookie the browser handles for us.
let accessToken = null;
let refreshTimer = null;
let refreshPromise = null;
const listeners = new Set();

export const onSessionChange = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

const api = axios.create({
  baseURL: '/api',
  timeout: 15000,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
  // The double-submit CSRF token, required by /auth/refresh and /auth/logout.
  xsrfCookieName: 'csrf',
  xsrfHeaderName: 'X-CSRF-Token',
  withXSRFToken: (config) => config.url?.startsWith('/auth/'),
});

function tokenExpiryMs(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.exp * 1000;
  } catch {
    return 0;
  }
}

export function setSession(token, user = null) {
  accessToken = token;
  clearTimeout(refreshTimer);
  if (token) {
    // Refresh one minute before expiry, so requests rarely pay for a 401 round trip.
    const delay = Math.max(tokenExpiryMs(token) - Date.now() - 60_000, 5_000);
    refreshTimer = setTimeout(() => refreshSession().catch(() => {}), delay);
  }
  listeners.forEach((fn) => fn({ token, user }));
}

export const hasCsrfCookie = () => document.cookie.split('; ').some((c) => c.startsWith('csrf='));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Single-flight refresh: concurrent 401s share one refresh call.
export function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const { data } = await api.post('/auth/refresh', null, { _skipAuthRetry: true });
          setSession(data.accessToken, data.user);
          return data;
        } catch (err) {
          // Another tab rotated the token at the same instant. The cookie jar
          // now holds the new one, so retry once.
          if (err.response?.data?.error?.code === 'REFRESH_RACE' && attempt === 0) {
            await sleep(250);
            continue;
          }
          setSession(null);
          throw err;
        }
      }
      return null;
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const { config, response } = error;
    if (response?.status === 401 && config && !config._skipAuthRetry && !config._retried && accessToken !== null) {
      config._retried = true;
      await refreshSession();
      return api(config);
    }
    return Promise.reject(error);
  },
);

export function errorMessage(err, fallback = 'Something went wrong') {
  const e = err?.response?.data?.error;
  if (e?.details?.length) return `${e.message}: ${e.details.map((d) => d.message).join(', ')}`;
  if (e?.message) return e.message;
  if (err?.code === 'ECONNABORTED') return 'The server took too long to respond';
  if (!err?.response) return 'Network error, check your connection';
  return fallback;
}

export default api;
