import { Navigate, Route, Routes } from 'react-router';
import OfficeHome from './pages/OfficeHome';
import DocEditor from './docs/DocEditor';

// Mounted at /office/*.
export default function OfficeRoutes() {
  return (
    <Routes>
      <Route index element={<OfficeHome />} />
      <Route path="docs/:docId" element={<DocEditor />} />
      <Route path="*" element={<Navigate to="/office" replace />} />
    </Routes>
  );
}
