import { Navigate, Route, Routes } from 'react-router';
import Files from './pages/Files';
import './files.scss';

// Mounted at /files/*. One page, showing a different view per address:
//   /files                     the top of My Drive
//   /files/folders/:folderId   a folder (yours, or one shared with you)
//   /files/shared              Shared with me
//   /files/recent              Recent
//   /files/trash               Trash
export default function FilesRoutes() {
  return (
    <Routes>
      <Route index element={<Files view="drive" />} />
      <Route path="folders/:folderId" element={<Files view="drive" />} />
      <Route path="shared" element={<Files view="shared" />} />
      <Route path="recent" element={<Files view="recent" />} />
      <Route path="trash" element={<Files view="trash" />} />
      <Route path="*" element={<Navigate to="/files" replace />} />
    </Routes>
  );
}
