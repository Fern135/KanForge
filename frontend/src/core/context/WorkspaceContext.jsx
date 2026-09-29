import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { workspaceApi, workspacesApi } from '../api/endpoints';
import { APPS } from '../../apps';
import { WORKSPACE_SLUG, rememberWorkspace } from '../workspaceUrl';
import { useAuth } from './AuthContext';

const WorkspaceContext = createContext(null);

// The signed-in user's workspaces, and, inside a workspace page, that workspace:
// its plan, the caller's role and which apps it can open.
export function WorkspaceProvider({ children }) {
  const { user } = useAuth();
  const [workspaces, setWorkspaces] = useState(null);
  // 'loading' | 'ready' | 'missing' (not a member, or no such workspace) | 'none' (outside a workspace)
  const [status, setStatus] = useState(WORKSPACE_SLUG ? 'loading' : 'none');
  const [current, setCurrent] = useState(null);

  const refreshList = useCallback(async () => {
    try {
      setWorkspaces((await workspacesApi.list()).workspaces);
    } catch {
      setWorkspaces([]);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!WORKSPACE_SLUG) return;
    try {
      const data = await workspaceApi.get();
      setCurrent(data);
      setStatus('ready');
      rememberWorkspace(WORKSPACE_SLUG);
    } catch (err) {
      if (err.response?.status === 404) setStatus('missing');
      else throw err;
    }
  }, []);

  const userId = user?.id;
  useEffect(() => {
    setWorkspaces(null);
    setCurrent(null);
    if (!userId) return;
    refreshList();
    refresh().catch(() => setStatus('missing'));
  }, [userId, refreshList, refresh]);

  const value = useMemo(() => {
    const byId = new Map((current?.apps || []).map((a) => [a.id, a]));
    return {
      workspaces,
      refreshList,
      status: userId && WORKSPACE_SLUG && !current && status !== 'missing' ? 'loading' : status,
      workspace: current?.workspace ?? null,
      isAdmin: current?.workspace.role === 'admin',
      limits: current?.limits ?? {},
      // Apps this frontend ships, with the workspace's state for each.
      apps: APPS.filter((a) => byId.get(a.id)?.enabled),
      locked: APPS.filter((a) => byId.has(a.id) && !byId.get(a.id).included),
      appStates: current?.apps ?? [],
      isEnabled: (id) => Boolean(byId.get(id)?.enabled),
      isIncluded: (id) => Boolean(byId.get(id)?.included),
      setCurrent,
      refresh,
    };
  }, [workspaces, refreshList, current, status, userId, refresh]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export const useWorkspace = () => useContext(WorkspaceContext);
// The apps the current workspace can open.
export const useApps = () => useContext(WorkspaceContext);
