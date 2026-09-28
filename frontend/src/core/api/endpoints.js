import api from './client';

const data = (p) => p.then((r) => r.data);

export const authApi = {
  register: (body) => data(api.post('/auth/register', body)),
  login: (body) => data(api.post('/auth/login', body)),
  loginWithPin: (body) => data(api.post('/auth/login-pin', body)),
  pinDevice: () => data(api.get('/auth/pin-device')),
  forgetPinDevice: () => api.post('/auth/pin-device/forget'),
  logout: () => api.post('/auth/logout', null, { _skipAuthRetry: true }),
  logoutAll: () => api.post('/auth/logout-all'),
  updateProfile: (body) => data(api.patch('/auth/me', body)),
  changePassword: (body) => data(api.post('/auth/change-password', body)),
  pinStatus: () => data(api.get('/auth/pin')),
  setPin: (body) => data(api.put('/auth/pin', body)),
  disablePin: (body) => data(api.post('/auth/pin/disable', body)),
};

export const appsApi = {
  list: () => data(api.get('/apps')),
};

export const adminApi = {
  apps: () => data(api.get('/admin/apps')),
  setAppEnabled: (id, enabled) => data(api.patch(`/admin/apps/${encodeURIComponent(id)}`, { enabled })),
  users: () => data(api.get('/admin/users')),
  setRole: (userId, role) => data(api.patch(`/admin/users/${encodeURIComponent(userId)}`, { role })),
};
