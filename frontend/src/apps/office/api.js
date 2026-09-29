import api from '../../core/api/client';

const d = (docId) => `/office/documents/${encodeURIComponent(docId)}`;
const data = (p) => p.then((r) => r.data);

export const officeApi = {
  list: (params) => data(api.get('/office/documents', { params })),
  get: (docId) => data(api.get(d(docId))),
  create: (body) => data(api.post('/office/documents', body)),
  update: (docId, body) => data(api.patch(d(docId), body)),
  copy: (docId) => data(api.post(`${d(docId)}/copy`)),
  trash: (docId) => data(api.post(`${d(docId)}/trash`)),
  restore: (docId) => data(api.post(`${d(docId)}/restore`)),
  remove: (docId) => api.delete(d(docId)),
  emptyTrash: () => data(api.delete('/office/documents/trash')),

  folders: () => data(api.get('/office/folders')),
  createFolder: (name, parentId = null) => data(api.post('/office/folders', { name, parentId })),
  updateFolder: (folderId, body) => data(api.patch(`/office/folders/${encodeURIComponent(folderId)}`, body)),
  removeFolder: (folderId) => data(api.delete(`/office/folders/${encodeURIComponent(folderId)}`)),

  uploadImage: (base64) => data(api.post('/office/images', { data: base64 })),
  image: (imageId) => api.get(`/office/images/${encodeURIComponent(imageId)}`, { responseType: 'blob' }).then((r) => r.data),
};
