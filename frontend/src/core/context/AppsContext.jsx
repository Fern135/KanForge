import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { appsApi } from '../api/endpoints';
import { APPS } from '../../apps';
import { useAuth } from './AuthContext';

const AppsContext = createContext(null);

// The apps the server has turned on, matched to the ones this frontend ships.
export function AppsProvider({ children }) {
  const { user } = useAuth();
  const [enabledIds, setEnabledIds] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const data = await appsApi.list();
      setEnabledIds(new Set(data.apps.map((a) => a.id)));
    } catch {
      setEnabledIds(new Set());
    }
  }, []);

  const userId = user?.id;
  useEffect(() => {
    setEnabledIds(null);
    if (userId) refresh();
  }, [userId, refresh]);

  const value = useMemo(() => ({
    loading: enabledIds === null,
    apps: enabledIds ? APPS.filter((a) => enabledIds.has(a.id)) : [],
    isEnabled: (id) => Boolean(enabledIds?.has(id)),
    refresh,
  }), [enabledIds, refresh]);

  return <AppsContext.Provider value={value}>{children}</AppsContext.Provider>;
}

export const useApps = () => useContext(AppsContext);
