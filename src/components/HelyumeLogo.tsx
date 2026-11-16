import { useId } from 'react';

interface HelyumeLogoProps {
  className?: string;
}

export function HelyumeLogo({ className = 'w-6 h-6' }: HelyumeLogoProps) {
  const gradientId = useId();

  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#EF4444" />
          <stop offset="35%" stopColor="#10B981" />
          <stop offset="70%" stopColor="#3B82F6" />
          <stop offset="100%" stopColor="#8B5CF6" />
        </linearGradient>
      </defs>
      <rect
        x="2"
        y="2"
        width="28"
        height="28"
        rx="8"
        className="fill-slate-900 dark:fill-slate-100"
      />
      <path
        d="M10 9.5V22.5M22 9.5V22.5M10 16H22"
        stroke={`url(#${gradientId})`}
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
