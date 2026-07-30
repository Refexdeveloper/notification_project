import { useRef, useState, type FormEvent } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowRight, Bell, Eye, EyeOff, Loader2, Lock, Mail } from 'lucide-react';

export interface LoginFormProps {
  email: string;
  password: string;
  error: string;
  loading: boolean;
  showPassword: boolean;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onTogglePassword: () => void;
  onSubmit: (e: FormEvent) => void;
  /** Optional Google SSO UI — does not change auth backend */
  onGoogleClick?: () => void;
}

export default function LoginForm({
  email,
  password,
  error,
  loading,
  showPassword,
  onEmailChange,
  onPasswordChange,
  onTogglePassword,
  onSubmit,
  onGoogleClick,
}: LoginFormProps) {
  const reduce = useReducedMotion();
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [remember, setRemember] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const emailActive = emailFocused || email.length > 0;
  const passwordActive = passwordFocused || password.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
      className="w-full max-w-[440px] xl:max-w-[480px]"
    >
      <div
        className="rounded-[28px] border border-white/90 bg-white/90 p-6 sm:p-7 xl:p-8 shadow-[0_8px_32px_rgba(15,108,189,0.12)] backdrop-blur-xl"
        role="region"
        aria-label="Sign in"
      >
        <div className="flex flex-col items-center text-center mb-5">
          <motion.div
            className="relative mb-3"
            animate={reduce ? undefined : { y: [0, -3, 0] }}
            transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
          >
            <span className="absolute inset-0 rounded-full bg-[#14B8A6]/30 blur-lg scale-125" aria-hidden />
            <span className="relative flex h-12 w-12 xl:h-14 xl:w-14 items-center justify-center rounded-full bg-gradient-to-br from-[#0F6CBD] to-[#14B8A6] text-white shadow-[0_6px_18px_rgba(15,108,189,0.35)]">
              <motion.span
                animate={reduce ? undefined : { rotate: [0, -10, 8, -4, 0] }}
                transition={{ duration: 2.8, repeat: Infinity, repeatDelay: 3 }}
              >
                <Bell className="h-5 w-5 xl:h-6 xl:w-6" />
              </motion.span>
            </span>
          </motion.div>
          <h2 className="text-2xl xl:text-[26px] font-bold tracking-tight text-[#1E293B]">Welcome back</h2>
          <p className="mt-1 text-sm text-[#64748B]">Sign in to your notification workspace</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-3.5" noValidate>
          {/* Email */}
          <motion.div
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15 }}
          >
            <div
              className={`relative flex items-center gap-3 px-4 min-h-[52px] rounded-2xl border bg-white cursor-text transition-[border,box-shadow] duration-150 ${
                emailFocused
                  ? 'border-[#0F6CBD] shadow-[0_0_0_3px_rgba(15,108,189,0.14)]'
                  : error
                    ? 'border-red-300'
                    : 'border-[#E2E8F0] hover:border-[#CBD5E1]'
              }`}
              onClick={() => emailRef.current?.focus()}
            >
              <Mail className={`h-5 w-5 shrink-0 ${emailFocused ? 'text-[#0F6CBD]' : 'text-[#94A3B8]'}`} />
              <div className="relative flex-1 min-w-0 pt-2">
                <label
                  htmlFor="login-email"
                  className={`pointer-events-none absolute left-0 transition-all duration-150 ${
                    emailActive
                      ? 'top-0 text-[10px] font-semibold text-[#0F6CBD]'
                      : 'top-1/2 -translate-y-1/2 text-[15px] text-[#94A3B8]'
                  }`}
                >
                  Email address
                </label>
                <input
                  ref={emailRef}
                  id="login-email"
                  type="email"
                  name="email"
                  value={email}
                  onChange={(e) => onEmailChange(e.target.value)}
                  onFocus={() => setEmailFocused(true)}
                  onBlur={() => setEmailFocused(false)}
                  autoComplete="email"
                  aria-invalid={!!error && !email.trim()}
                  aria-describedby={error ? 'login-error' : undefined}
                  className="w-full bg-transparent border-none outline-none text-[15px] text-[#1E293B] pt-2"
                />
              </div>
            </div>
          </motion.div>

          {/* Password */}
          <motion.div
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.22 }}
          >
            <div
              className={`relative flex items-center gap-3 px-4 min-h-[52px] rounded-2xl border bg-white cursor-text transition-[border,box-shadow] duration-150 ${
                passwordFocused
                  ? 'border-[#0F6CBD] shadow-[0_0_0_3px_rgba(15,108,189,0.14)]'
                  : error
                    ? 'border-red-300'
                    : 'border-[#E2E8F0] hover:border-[#CBD5E1]'
              }`}
              onClick={() => passwordRef.current?.focus()}
            >
              <Lock
                className={`h-5 w-5 shrink-0 ${passwordFocused ? 'text-[#0F6CBD]' : 'text-[#94A3B8]'}`}
              />
              <div className="relative flex-1 min-w-0 pt-2">
                <label
                  htmlFor="login-password"
                  className={`pointer-events-none absolute left-0 transition-all duration-150 ${
                    passwordActive
                      ? 'top-0 text-[10px] font-semibold text-[#0F6CBD]'
                      : 'top-1/2 -translate-y-1/2 text-[15px] text-[#94A3B8]'
                  }`}
                >
                  Password
                </label>
                <input
                  ref={passwordRef}
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  value={password}
                  onChange={(e) => onPasswordChange(e.target.value)}
                  onFocus={() => setPasswordFocused(true)}
                  onBlur={() => setPasswordFocused(false)}
                  autoComplete="current-password"
                  aria-invalid={!!error && !password.trim()}
                  className="w-full bg-transparent border-none outline-none text-[15px] text-[#1E293B] pt-2"
                />
              </div>
              <button
                type="button"
                onClick={onTogglePassword}
                className="text-[#94A3B8] hover:text-[#475569] cursor-pointer p-1 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0F6CBD]"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </motion.div>

          <div className="flex items-center justify-between gap-3 pt-0.5">
            <label className="inline-flex items-center gap-2 text-sm font-medium text-[#64748B] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                className="h-4 w-4 rounded border-[#CBD5E1] text-[#0F6CBD] focus:ring-[#0F6CBD]"
              />
              Remember me
            </label>
            <button
              type="button"
              className="text-sm font-semibold text-[#0F6CBD] hover:text-[#0A5A9E] cursor-pointer"
              onClick={() =>
                window.alert('Password reset is managed by your workspace admin.')
              }
            >
              Forgot password?
            </button>
          </div>

          {error && (
            <motion.div
              id="login-error"
              role="alert"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl border border-red-200 bg-red-50 px-3.5 py-3"
            >
              <p className="text-sm text-red-800 font-medium">{error}</p>
            </motion.div>
          )}

          <motion.button
            type="submit"
            disabled={loading}
            whileHover={reduce || loading ? undefined : { y: -2, scale: 1.01 }}
            whileTap={reduce || loading ? undefined : { scale: 0.98 }}
            className="group relative w-full h-12 rounded-2xl text-[15px] font-semibold text-white cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, #0F6CBD 0%, #14B8A6 100%)',
              boxShadow: '0 8px 24px rgba(15,108,189,0.28)',
            }}
          >
            <span className="inline-flex items-center justify-center gap-2">
              {loading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  Continue
                  <ArrowRight className="h-5 w-5 transition-transform duration-200 group-hover:translate-x-1" />
                </>
              )}
            </span>
          </motion.button>
        </form>

        <div className="my-4 flex items-center gap-3">
          <div className="h-px flex-1 bg-[#E2E8F0]" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#94A3B8]">or</span>
          <div className="h-px flex-1 bg-[#E2E8F0]" />
        </div>

        <motion.button
          type="button"
          whileHover={reduce ? undefined : { backgroundColor: '#F8FBFF' }}
          whileTap={reduce ? undefined : { scale: 0.98 }}
          onClick={onGoogleClick}
          className="w-full h-11 rounded-2xl border border-[#E2E8F0] bg-white text-[15px] font-semibold text-[#334155] inline-flex items-center justify-center gap-2.5 cursor-pointer hover:bg-[#F8FBFF] transition-colors"
        >
          <GoogleIcon />
          Continue with Google
        </motion.button>

        <p className="mt-5 text-center text-xs text-[#64748B]">
          New to Notification Engine?{' '}
          <span className="font-semibold text-[#0F6CBD]">Contact your admin</span>
        </p>
      </div>
    </motion.div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 5.1 29.3 3 24 3 12.3 3 3 12.3 3 24s9.3 21 21 21 21-9.3 21-21c0-1.2-.1-2.3-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7C34 5.1 29.3 3 24 3 16.3 3 9.6 7.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 45c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 36.3 26.7 37 24 37c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 40.6 16.2 45 24 45z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.3 4.1-4.1 5.5l.0.0 6.2 5.2C39.2 36.9 45 32 45 24c0-1.2-.1-2.3-.4-3.5z"
      />
    </svg>
  );
}
