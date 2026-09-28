import { Navigate, Route, Routes } from 'react-router';
import Notes from './pages/Notes';
import './notes.scss';

// Mounted at /notes/*. The list stays on screen while a note is open.
export default function NotesRoutes() {
  return (
    <Routes>
      <Route index element={<Notes />} />
      <Route path=":noteId" element={<Notes />} />
      <Route path="*" element={<Navigate to="/notes" replace />} />
    </Routes>
  );
}
