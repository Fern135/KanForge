import api from '../../core/api/client';

const n = (noteId) => `/notes/${encodeURIComponent(noteId)}`;
const data = (p) => p.then((r) => r.data);

export const notesApi = {
  list: (params) => data(api.get('/notes', { params })),
  tags: () => data(api.get('/notes/tags')),
  get: (noteId) => data(api.get(n(noteId))),
  create: (body = {}) => data(api.post('/notes', body)),
  update: (noteId, body) => data(api.patch(n(noteId), body)),
  trash: (noteId) => data(api.post(`${n(noteId)}/trash`)),
  restore: (noteId) => data(api.post(`${n(noteId)}/restore`)),
  remove: (noteId) => api.delete(n(noteId)),
  emptyTrash: () => data(api.delete('/notes/trash')),
  importNotes: (notes) => data(api.post('/notes/import', { notes })),
  exportAll: () => data(api.get('/notes/export')),

  folders: () => data(api.get('/notes/folders')),
  createFolder: (name, parentId = null) => data(api.post('/notes/folders', { name, parentId })),
  updateFolder: (folderId, body) => data(api.patch(`/notes/folders/${encodeURIComponent(folderId)}`, body)),
  removeFolder: (folderId) => data(api.delete(`/notes/folders/${encodeURIComponent(folderId)}`)),
};
