import api from './client';

const data = (p) => p.then((r) => r.data);

export const authApi = {
  register: (body) => data(api.post('/auth/register', body)),
  login: (body) => data(api.post('/auth/login', body)),
  loginWithPin: (body) => data(api.post('/auth/login-pin', body)),
  pinDevice: () => data(api.get('/auth/pin-device')),
  forgetPinDevice: () => api.post('/auth/pin-device/forget'),
  logout: () => api.post('/auth/logout', undefined, { _skipAuthRetry: true }),
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

export const workspacesApi = {
  list: () => data(api.get('/workspaces')),
  create: (body) => data(api.post('/workspaces', body)),
};

// The workspace this page is in (sent in the X-Workspace header).
export const workspaceApi = {
  get: () => data(api.get('/workspace')),
  rename: (name) => data(api.patch('/workspace', { name })),
  members: () => data(api.get('/workspace/members')),
  addMember: (email, role) => data(api.post('/workspace/members', { email, role })),
  setRole: (userId, role) => data(api.patch(`/workspace/members/${encodeURIComponent(userId)}`, { role })),
  removeMember: (userId) => api.delete(`/workspace/members/${encodeURIComponent(userId)}`),
  setAppEnabled: (id, enabled) => data(api.patch(`/workspace/apps/${encodeURIComponent(id)}`, { enabled })),
};

// Platform admins: the whole server.
export const adminApi = {
  users: () => data(api.get('/admin/users')),
  setRole: (userId, role) => data(api.patch(`/admin/users/${encodeURIComponent(userId)}`, { role })),
  workspaces: () => data(api.get('/admin/workspaces')),
  updateWorkspace: (id, body) => data(api.patch(`/admin/workspaces/${encodeURIComponent(id)}`, body)),
};
