import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { apiFetch, clearAuthSession, setAuthSession } from '@/services/api';
import { apiV1Fetch, isBackendApiMode, type SessionContext } from '@/services/backendApi';

interface AuthUser {
  id?: number;
  name: string;
  email: string;
  role: string;
}

interface AuthContextType {
  user: AuthUser | null;
  isAuthenticated: boolean;
  authMode: 'legacy' | 'backend';
  sessionLoading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  loginWithSession: () => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

function getStoredUser(): AuthUser | null {
  try {
    const stored = localStorage.getItem('ne_auth_user');
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

function applySessionUser(session: SessionContext): AuthUser {
  return {
    name: session.display_name,
    email: session.email,
    role: session.role,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(getStoredUser);
  const [sessionLoading, setSessionLoading] = useState(isBackendApiMode());
  const authMode = isBackendApiMode() ? 'backend' : 'legacy';

  const loginWithSession = useCallback(async () => {
    const res = await apiV1Fetch<SessionContext>('/auth/session');
    if (!res.ok || !res.data) {
      return { success: false, error: res.error || 'Session unavailable' };
    }
    const authUser = applySessionUser(res.data);
    setAuthSession({
      accessToken: 'backend-session',
      user: authUser,
    });
    setUser(authUser);
    return { success: true };
  }, []);

  useEffect(() => {
    if (!isBackendApiMode()) {
      setSessionLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const result = await loginWithSession();
      if (!cancelled && !result.success && !getStoredUser()) {
        setUser(null);
      }
      if (!cancelled) setSessionLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loginWithSession]);

  const login = useCallback(
    async (email: string, password: string) => {
      if (isBackendApiMode()) {
        return loginWithSession();
      }

      const res = await apiFetch<{
        accessToken: string;
        refreshToken: string;
        user: { id: number; name: string; email: string; role: string };
      }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok || !res.data?.accessToken) {
        return {
          success: false,
          error: res.error || 'Invalid email or password. Please try again.',
        };
      }

      const authUser: AuthUser = {
        id: res.data.user.id,
        name: res.data.user.name,
        email: res.data.user.email,
        role: res.data.user.role,
      };
      setAuthSession({
        accessToken: res.data.accessToken,
        refreshToken: res.data.refreshToken,
        user: authUser,
      });
      setUser(authUser);
      return { success: true };
    },
    [loginWithSession],
  );

  const logout = useCallback(() => {
    setUser(null);
    clearAuthSession();
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        authMode,
        sessionLoading,
        login,
        loginWithSession,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
