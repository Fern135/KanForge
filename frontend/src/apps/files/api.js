import api from '../../core/api/client';

// Calls to the Files API (/api/files). Uploads have their own module
// (utils/uploader.js), since they send raw bytes in parts.

// Ids are encoded, so nothing in one can change the path it goes to.
const enc = encodeURIComponent;
// The path for one file or folder.
const node = (id) => `/files/nodes/${enc(id)}`;
// Answers with the response body rather than the whole axios response.
const data = (p) => p.then((r) => r.data);

export const filesApi = {
  // The caller's storage: used, limits, and whether storage is set up at all.
  storage: () => data(api.get('/files/storage')),

  // A folder's contents (no folderId: the top of the caller's own drive).
  browse: (folderId) => data(api.get('/files/browse', { params: folderId ? { folder: folderId } : {} })),
  recent: () => data(api.get('/files/recent')),
  shared: () => data(api.get('/files/shared')),
  trash: () => data(api.get('/files/trash')),
  search: (q) => data(api.get('/files/search', { params: { q } })),
  get: (id) => data(api.get(node(id))),

  // Organising: new folders, renaming, moving, and the trash.
  createFolder: (name, parentId = null) => data(api.post('/files/folders', { name, parentId })),
  rename: (id, name) => data(api.patch(node(id), { name })),
  move: (id, parentId) => data(api.patch(node(id), { parentId })),
  trashItem: (id) => api.post(`${node(id)}/trash`),
  restore: (id) => data(api.post(`${node(id)}/restore`)),
  deleteForever: (id) => api.delete(node(id)),
  emptyTrash: () => data(api.delete('/files/trash')),

  // Preview images for the grid view (see utils/thumbnails.js): store one as
  // raw image bytes, or record that this file can't have one.
  setThumbnail: (id, blob) => data(api.put(`${node(id)}/thumbnail`, blob, { headers: { 'Content-Type': 'application/octet-stream' } })),
  noThumbnail: (id) => api.post(`${node(id)}/no-thumbnail`),

  // A short-lived URL the browser can open directly (see the API's links.js).
  downloadUrl: (id, inline = false) => data(api.post(`${node(id)}/download`, { inline })).then((d) => d.url),

  // Sharing with people in the workspace, and the public link.
  shares: (id) => data(api.get(`${node(id)}/shares`)),
  share: (id, userId, role) => data(api.post(`${node(id)}/shares`, { userId, role })),
  setShareRole: (shareId, role) => data(api.patch(`/files/shares/${enc(shareId)}`, { role })),
  removeShare: (shareId) => api.delete(`/files/shares/${enc(shareId)}`),
  createLink: (id) => data(api.post(`${node(id)}/link`)),
  removeLink: (id) => data(api.delete(`${node(id)}/link`)),
};

// Public links, opened without signing in (the PublicShare page).
const publicBase = (token) => `/public/files/links/${enc(token)}`;
export const publicFilesApi = {
  open: (token, folderId) => data(api.get(publicBase(token), { params: folderId ? { folder: folderId } : {} })),
  // Plain URLs: the browser fetches these itself (download link, <img>, <video>).
  fileUrl: (token, nodeId, inline = false) => `/api${publicBase(token)}/download/${enc(nodeId)}${inline ? '?inline=1' : ''}`,
};

// The platform admin's Files settings (Admin page).
export const filesAdminApi = {
  get: () => data(api.get('/admin/apps/files')),
  updateSettings: (body) => data(api.patch('/admin/apps/files/settings', body)),
  setQuota: (userId, bytes) => data(api.put(`/admin/apps/files/quotas/${enc(userId)}`, { bytes })),
  resetQuota: (userId) => data(api.delete(`/admin/apps/files/quotas/${enc(userId)}`)),
};
