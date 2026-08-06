import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/AuthContext';
import BackgroundEffects from './components/BackgroundEffects';
import HeroSection from './components/HeroSection';
import LoginForm from './components/LoginForm';
import { Button } from '@/components/ui/Button';
import { isBackendApiMode } from '@/services/backendApi';

export default function LoginPage() {
  const navigate = useNavigate();
  const { isAuthenticated, login, loginWithSession, authMode, sessionLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const backendMode = isBackendApiMode();

  if (sessionLoading) {
    return (
      <div className="login-shell relative app-canvas flex items-center justify-center">
        <p className="text-sm text-[#64748B]">Loading session…</p>
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/applications" replace />;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (backendMode) {
      setLoading(true);
      const result = await loginWithSession();
      setLoading(false);
      if (result.success) navigate('/applications', { replace: true });
      else setError(result.error || 'Session unavailable');
      return;
    }
    if (!email.trim()) {
      setError('Please enter your email address.');
      return;
    }
    if (!password.trim()) {
      setError('Please enter your password.');
      return;
    }
    setLoading(true);
    const result = await login(email, password);
    setLoading(false);
    if (result.success) navigate('/applications', { replace: true });
    else setError(result.error || 'Something went wrong. Please try again.');
  };

  return (
    <div className="login-shell relative app-canvas">
      <BackgroundEffects />

      <div className="relative z-10 mx-auto grid h-full w-full max-w-[1680px] grid-cols-1 lg:grid-cols-[1.45fr_minmax(420px,0.95fr)] gap-5 xl:gap-10 px-5 sm:px-8 lg:px-10 xl:px-14 2xl:px-16 py-3 lg:py-5">
        <div className="hidden lg:flex flex-col min-h-0 overflow-hidden">
          <HeroSection />
        </div>

        <div className="flex min-h-0 items-center justify-center lg:justify-end overflow-hidden">
          {backendMode ? (
            <div className="w-full max-w-md rounded-2xl border border-[#E2E8F0] bg-white p-8 shadow-[var(--shadow-soft)]">
              <h2 className="text-xl font-bold text-[#1E293B]">Refex Engagement Studio</h2>
              <p className="mt-2 text-sm text-[#64748B]">
                Continue to open the workspace. Access is managed in Kissflow for admins
                ({authMode} session).
              </p>
              {error && (
                <p className="mt-4 text-sm text-red-600" role="alert">
                  {error}
                </p>
              )}
              <Button
                className="mt-6 w-full"
                disabled={loading}
                onClick={() => void handleSubmit({ preventDefault: () => {} } as FormEvent)}
              >
                {loading ? 'Signing in…' : 'Continue'}
              </Button>
            </div>
          ) : (
            <LoginForm
              email={email}
              password={password}
              error={error}
              loading={loading}
              showPassword={showPassword}
              onEmailChange={(v) => {
                setEmail(v);
                setError('');
              }}
              onPasswordChange={(v) => {
                setPassword(v);
                setError('');
              }}
              onTogglePassword={() => setShowPassword((s) => !s)}
              onSubmit={handleSubmit}
              onGoogleClick={() =>
                window.alert(
                  'Google sign-in is not enabled for this workspace yet. Use email and password.',
                )
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}
