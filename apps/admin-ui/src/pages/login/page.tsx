import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/hooks/AuthContext';
import { apiV1Fetch } from '@/services/backendApi';
import BackgroundEffects from './components/BackgroundEffects';
import HeroSection from './components/HeroSection';
import LoginForm from './components/LoginForm';

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAuthenticated, login, loginWithToken, sessionLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState(() => {
    const fromReset = (location.state as { message?: string } | null)?.message;
    return fromReset || '';
  });
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);

  useEffect(() => {
    const googleError = searchParams.get('google_error');
    if (googleError) {
      setError(googleError);
      const next = new URLSearchParams(searchParams);
      next.delete('google_error');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    const token = searchParams.get('google_token');
    if (!token) return;
    let cancelled = false;
    setGoogleLoading(true);
    loginWithToken(token).then((result) => {
      if (cancelled) return;
      const next = new URLSearchParams(searchParams);
      next.delete('google_token');
      setSearchParams(next, { replace: true });
      setGoogleLoading(false);
      if (result.success) navigate('/dashboard', { replace: true });
      else setError(result.error || 'Google sign-in failed');
    });
    return () => {
      cancelled = true;
    };
  }, [loginWithToken, navigate, searchParams, setSearchParams]);

  if (sessionLoading) {
    return (
      <div className="login-shell relative app-canvas flex items-center justify-center">
        <p className="text-sm text-[#64748B]">Loading session…</p>
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    if (!email.trim()) {
      setError('Please enter your username or email.');
      return;
    }
    if (!password.trim()) {
      setError('Please enter your password.');
      return;
    }
    setLoading(true);
    const result = await login(email, password);
    setLoading(false);
    if (result.success) navigate('/dashboard', { replace: true });
    else setError(result.error || 'Invalid username or password.');
  };

  const handleForgot = async (e: FormEvent) => {
    e.preventDefault();
    const loginName = forgotEmail.trim() || email.trim();
    if (!loginName) {
      setError('Enter your username or email to reset the password.');
      return;
    }
    setError('');
    setMessage('');
    setForgotLoading(true);
    const res = await apiV1Fetch<{ queued?: boolean; message?: string }>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email: loginName, ui_origin: window.location.origin }),
    });
    setForgotLoading(false);
    if (!res.ok) {
      setError(res.error || 'Could not send the reset email.');
      return;
    }
    setMessage(res.data?.message || 'If this account exists, a reset link was sent to its email address.');
    setForgotOpen(false);
  };

  const handleGoogle = () => {
    setGoogleLoading(true);
    const start = `/api/v1/auth/google/start?ui_origin=${encodeURIComponent(window.location.origin)}`;
    window.location.assign(start);
  };

  return (
    <div className="login-shell relative app-canvas">
      <BackgroundEffects />

      <div className="relative z-10 mx-auto grid h-full w-full max-w-[1680px] grid-cols-1 lg:grid-cols-[1.45fr_minmax(420px,0.95fr)] gap-5 xl:gap-10 px-5 sm:px-8 lg:px-10 xl:px-14 2xl:px-16 py-3 lg:py-5">
        <div className="hidden lg:flex flex-col min-h-0 overflow-hidden">
          <HeroSection />
        </div>

        <div className="flex min-h-0 items-center justify-center lg:justify-end overflow-hidden">
          <div className="w-full max-w-[440px] xl:max-w-[480px]">
            {message && (
              <div className="mb-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-800">
                {message}
              </div>
            )}
            {forgotOpen ? (
              <form
                onSubmit={handleForgot}
                className="rounded-[28px] border border-white/90 bg-white/90 p-6 sm:p-7 shadow-[0_8px_32px_rgba(15,108,189,0.12)]"
              >
                <h2 className="text-2xl font-bold text-[#1E293B]">Forgot password</h2>
                <p className="mt-1 text-sm text-[#64748B]">
                  Enter your username or email. We will send a reset link if the account exists.
                </p>
                <input
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  placeholder="aasik or aasik@refex.co.in"
                  className="mt-5 w-full rounded-2xl border border-[#E2E8F0] px-4 py-3 text-[15px] outline-none focus:border-[#0F6CBD]"
                  autoComplete="username"
                />
                {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
                <div className="mt-5 flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-full px-4 py-2 text-sm text-[#64748B]"
                    onClick={() => {
                      setForgotOpen(false);
                      setError('');
                    }}
                  >
                    Back to sign in
                  </button>
                  <button
                    type="submit"
                    disabled={forgotLoading}
                    className="rounded-full bg-[#0F6CBD] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {forgotLoading ? 'Sending…' : 'Send reset link'}
                  </button>
                </div>
              </form>
            ) : (
              <LoginForm
                email={email}
                password={password}
                error={error}
                loading={loading}
                showPassword={showPassword}
                googleLoading={googleLoading}
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
                onForgotPassword={() => {
                  setForgotEmail(email);
                  setForgotOpen(true);
                  setError('');
                  setMessage('');
                }}
                onGoogleClick={handleGoogle}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
