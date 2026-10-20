import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from './api';
import type { Settings, User } from './types';

interface AuthValue {
  user: User | null;
  settings: Settings | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshSettings: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshSettings = useCallback(async () => {
    const next = await api.get<Settings>('/settings');
    setSettings(next);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const me = await api.get<User>('/auth/me');
        setUser(me);
        setSettings(await api.get<Settings>('/settings'));
      } catch (err) {
        if (!(err instanceof ApiError) || err.status !== 401) console.error(err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const me = await api.post<User>('/auth/login', { email, password });
    setUser(me);
    setSettings(await api.get<Settings>('/settings'));
  }, []);

  const logout = useCallback(async () => {
    await api.post('/auth/logout');
    setUser(null);
    setSettings(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, settings, loading, login, logout, refreshSettings }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
