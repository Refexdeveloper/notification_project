import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { apiV1Fetch } from '@/services/backendApi';
import BackgroundEffects from '@/pages/login/components/BackgroundEffects';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!token) {
      setError('This reset link is missing a token. Request a new one from the sign-in page.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    const res = await apiV1Fetch<{ reset?: boolean }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, password }),
    });
    setLoading(false);
    if (!res.ok) {
      setError(res.error || 'Could not reset the password.');
      return;
    }
    navigate('/login', { replace: true, state: { message: 'Password updated. Sign in with your new password.' } });
  };

  return (
    <div className="login-shell relative app-canvas">
      <BackgroundEffects />
      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-lg items-center px-5 py-8">
        <form
          onSubmit={handleSubmit}
          className="w-full rounded-[28px] border border-white/90 bg-white/90 p-6 sm:p-8 shadow-[0_8px_32px_rgba(15,108,189,0.12)]"
        >
          <h1 className="text-2xl font-bold text-[#1E293B]">Set a new password</h1>
          <p className="mt-1 text-sm text-[#64748B]">Use the link from your email, then sign in with the new password.</p>
          <label className="mt-5 block text-xs font-semibold text-[#475569]">
            New password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              className="mt-1.5 w-full rounded-2xl border border-[#E2E8F0] px-4 py-3 text-[15px] outline-none focus:border-[#0F6CBD]"
            />
          </label>
          <label className="mt-3 block text-xs font-semibold text-[#475569]">
            Confirm password
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              className="mt-1.5 w-full rounded-2xl border border-[#E2E8F0] px-4 py-3 text-[15px] outline-none focus:border-[#0F6CBD]"
            />
          </label>
          {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="mt-5 w-full rounded-2xl bg-[#0F6CBD] py-3 text-sm font-semibold text-white disabled:opacity-60"
          >
            {loading ? 'Saving…' : 'Save password'}
          </button>
          <p className="mt-4 text-center text-sm text-[#64748B]">
            <Link to="/login" className="font-semibold text-[#0F6CBD]">
              Back to sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
