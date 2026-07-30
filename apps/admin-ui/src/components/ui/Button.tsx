import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

const sizes: Record<Size, string> = {
  sm: '!h-9 !px-3.5 !text-xs !rounded-[10px]',
  md: '',
  lg: '!h-12 !px-6',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading,
    leftIcon,
    rightIcon,
    children,
    className = '',
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  const base =
    variant === 'primary'
      ? 'btn-primary'
      : variant === 'secondary'
        ? 'btn-secondary'
        : variant === 'ghost'
          ? 'btn-ghost'
          : 'inline-flex items-center justify-center gap-2 h-11 px-5 rounded-[10px] text-sm font-semibold text-red-700 bg-white border border-red-200 hover:bg-red-50 hover:border-red-300 cursor-pointer shadow-[var(--shadow-soft)]';
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={`${base} ${sizes[size]} ${className}`}
      {...rest}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
});
