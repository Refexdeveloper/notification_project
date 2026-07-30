import type { ReactNode } from 'react';

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  onClick?: () => void;
  as?: 'div' | 'button';
}

export function GlassCard({ children, className = '', hover, onClick, as = 'div' }: GlassCardProps) {
  const shared = `surface ${
    hover
      ? 'cursor-pointer hover:border-[#BFDDF0] hover:shadow-[var(--shadow-lift)] transition-[border,box-shadow] duration-150'
      : ''
  } ${className}`;

  if (as === 'button') {
    return (
      <button type="button" onClick={onClick} className={shared}>
        {children}
      </button>
    );
  }

  return (
    <div onClick={onClick} className={shared}>
      {children}
    </div>
  );
}
