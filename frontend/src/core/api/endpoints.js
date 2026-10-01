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
  sessions: () => data(api.get('/auth/sessions')),
  signOutDevice: (id) => api.delete(`/auth/sessions/${encodeURIComponent(id)}`),
  deletionRequest: () => data(api.get('/auth/deletion-request')),
  requestDeletion: (currentPassword) => data(api.post('/auth/deletion-request', { currentPassword })),
  cancelDeletion: () => api.delete('/auth/deletion-request'),
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
  setRole: (userId, role) => data(api.patch(`/workspace/members/${encodeURIComponent(userId)}`, { role })),
  removeMember: (userId) => api.delete(`/workspace/members/${encodeURIComponent(userId)}`),
  setAppEnabled: (id, enabled) => data(api.patch(`/workspace/apps/${encodeURIComponent(id)}`, { enabled })),
  invites: () => data(api.get('/workspace/invites')),
  createInvite: (body) => data(api.post('/workspace/invites', body)),
  revokeInvite: (id) => api.delete(`/workspace/invites/${encodeURIComponent(id)}`),
};

// Opening and accepting an invite link (outside any workspace).
export const invitesApi = {
  preview: (token) => data(api.post('/invites/preview', { token })),
  accept: (token) => data(api.post('/invites/accept', { token })),
};

// Platform admins: the whole server.
export const adminApi = {
  confirm: (password) => api.post('/admin/confirm', { password }),
  stats: () => data(api.get('/admin/stats')),
  workspaces: () => data(api.get('/admin/workspaces')),
  updateWorkspace: (id, body) => data(api.patch(`/admin/workspaces/${encodeURIComponent(id)}`, body)),
  admins: () => data(api.get('/admin/admins')),
  addAdmin: (email) => data(api.post('/admin/admins', { email })),
  removeAdmin: (id) => api.delete(`/admin/admins/${encodeURIComponent(id)}`),
  deletionRequests: () => data(api.get('/admin/deletion-requests')),
  carryOutDeletion: (id) => api.delete(`/admin/deletion-requests/${encodeURIComponent(id)}`),
  // Self-hosted installs only.
  people: () => data(api.get('/admin/people')),
  addPerson: (body) => data(api.post('/admin/people', body)),
  invitePerson: (body) => data(api.post('/admin/people/invite', body)),
  setAccess: (id, access) => data(api.patch(`/admin/people/${encodeURIComponent(id)}`, { access })),
  setDisabled: (id, disabled) => data(api.patch(`/admin/people/${encodeURIComponent(id)}`, { disabled })),
  deletePerson: (id) => api.delete(`/admin/people/${encodeURIComponent(id)}`),
  resetPassword: (id) => data(api.post(`/admin/people/${encodeURIComponent(id)}/reset-password`)),
};
