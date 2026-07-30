import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { apiFetch, clearAuthSession, setAuthSession } from '@/services/api';

interface AuthUser {
  id?: number;
  name: string;
  email: string;
  role: string;
}

interface AuthContextType {
  user: AuthUser | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(getStoredUser);

  const login = useCallback(async (email: string, password: string) => {
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
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    clearAuthSession();
  }, []);

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: !!user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
