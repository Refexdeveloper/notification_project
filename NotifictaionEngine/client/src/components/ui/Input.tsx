import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  leftSlot?: ReactNode;
  rightSlot?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, leftSlot, rightSlot, className = '', id, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id || autoId;

  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="block text-xs font-semibold text-foreground-700 mb-1.5">
          {label}
        </label>
      )}
      <div className="relative">
        {leftSlot && (
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-foreground-400 pointer-events-none">
            {leftSlot}
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          className={`field-input ${leftSlot ? 'pl-10' : ''} ${rightSlot ? 'pr-10' : ''} ${
            error ? 'border-red-300 focus:border-red-400 focus:shadow-[0_0_0_4px_oklch(0.93_0.04_25)]' : ''
          } ${className}`}
          aria-invalid={Boolean(error)}
          {...rest}
        />
        {rightSlot && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-foreground-400">{rightSlot}</span>
        )}
      </div>
      {error ? (
        <p className="mt-1.5 text-xs font-medium text-red-600">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-foreground-400">{hint}</p>
      ) : null}
    </div>
  );
});
