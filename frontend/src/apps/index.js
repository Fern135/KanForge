import { lazy } from 'react';
import {
  faTableColumns, faNoteSticky, faFileWord, faFolder, faEnvelope,
} from '@fortawesome/free-solid-svg-icons';

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
  {
    id: 'office',
    name: 'Office',
    icon: faFileWord,
    Routes: lazy(() => import('./office/routes')),
  },
];

// Apps that are announced but not built yet. They show as "Coming soon" on the
// home screen and in the app switcher, and don't link anywhere.
export const UPCOMING_APPS = [
  { id: 'files', name: 'Files', icon: faFolder },
  { id: 'mail', name: 'Mail', icon: faEnvelope },
];
