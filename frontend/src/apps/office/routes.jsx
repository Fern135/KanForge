import { Navigate, Route, Routes } from 'react-router';
import OfficeHome from './pages/OfficeHome';
import DocEditor from './docs/DocEditor';
import SheetEditor from './sheets/SheetEditor';
import SlideEditor from './slides/SlideEditor';

// Mounted at /office/*.
export default function OfficeRoutes() {
  return (
    <Routes>
      <Route index element={<OfficeHome />} />
      <Route path="docs/:docId" element={<DocEditor />} />
      <Route path="sheets/:docId" element={<SheetEditor />} />
      <Route path="slides/:docId" element={<SlideEditor />} />
      <Route path="*" element={<Navigate to="/office" replace />} />
    </Routes>
  );
}
