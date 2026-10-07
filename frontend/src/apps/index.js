import { lazy } from 'react';
import {
  faTableColumns, faNoteSticky, faFileWord, faFolder, faEnvelope,
} from '@fortawesome/free-solid-svg-icons';

// Every app the frontend knows. Each one lives at /app/w/<workspace>/<id>/*,
// loads only when opened, and may import from core but never from another app.
// The workspace's plan and admins decide which apps are on (see WorkspaceContext).
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
  {
    id: 'files',
    name: 'Files',
    icon: faFolder,
    Routes: lazy(() => import('./files/routes')),
    // Its section of the platform admin page (storage limits, public links).
    AdminSection: lazy(() => import('./files/admin/AdminFiles')),
  },
];

// Pages that open without signing in or choosing a workspace, at /app/<path>.
// Public file links live here: /app/s/<token>.
export const PUBLIC_PAGES = [
  { path: '/s/:token', Page: lazy(() => import('./files/pages/PublicShare')) },
];

// Apps that are announced but not built yet. They show as "Coming soon" on the
// home screen and in the app switcher, and don't link anywhere.
export const UPCOMING_APPS = [
  { id: 'mail', name: 'Mail', icon: faEnvelope },
];
