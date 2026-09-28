import { Navigate, Route, Routes } from 'react-router';
import Boards from './pages/Boards';
import Board from './pages/Board';

// Mounted at /boards/*.
export default function BoardsRoutes() {
  return (
    <Routes>
      <Route index element={<Boards />} />
      <Route path=":boardId" element={<Board />} />
      <Route path="*" element={<Navigate to="/boards" replace />} />
    </Routes>
  );
}
