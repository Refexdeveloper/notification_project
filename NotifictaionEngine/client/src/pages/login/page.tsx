import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/AuthContext';
import BackgroundEffects from './components/BackgroundEffects';
import HeroSection from './components/HeroSection';
import LoginForm from './components/LoginForm';

/**
 * Premium login shell — authentication logic unchanged.
 * Locked to viewport height (no page scroll); fills width on large screens.
 */
export default function LoginPage() {
  const navigate = useNavigate();
  const { isAuthenticated, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  if (isAuthenticated) {
    return <Navigate to="/applications" replace />;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
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
        </div>
      </div>
    </div>
  );
}
