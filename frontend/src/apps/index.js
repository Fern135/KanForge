import { lazy } from 'react';
import { faTableColumns, faNoteSticky } from '@fortawesome/free-solid-svg-icons';

// Every app the frontend knows. Each one lives at /<id>/*, loads only when
// opened, and may import from core but never from another app. The server
// decides which apps are turned on (see AppsContext).
export const APPS = [
  {
    id: 'boards',
    name: 'Boards',
    icon: faTableColumns,
    Routes: lazy(() => import('./boards/routes')),
  },
  {
    id: 'notes',
    name: 'Notes',
    icon: faNoteSticky,
    Routes: lazy(() => import('./notes/routes')),
  },
];
