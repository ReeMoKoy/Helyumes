import { useId } from 'react';

interface HelyumeLogoProps {
  className?: string;
}

/**
 * Brand-new Helyume orbital eclipse emblem with luminous twin-core geometry.
 */
export function HelyumeLogo({ className = 'w-6 h-6' }: HelyumeLogoProps) {
  const uid = useId();
  const ringGrad = `${uid}-ring`;
  const coreGrad = `${uid}-core`;

  return (
    <svg
      viewBox="0 0 36 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={ringGrad} x1="4" y1="5" x2="32" y2="31" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#22D3EE" />
          <stop offset="45%" stopColor="#60A5FA" />
          <stop offset="78%" stopColor="#A855F7" />
          <stop offset="100%" stopColor="#F43F5E" />
        </linearGradient>
        <linearGradient id={coreGrad} x1="11" y1="10" x2="25" y2="26" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" stopColor="#BAE6FD" />
        </linearGradient>
      </defs>
      <circle cx="18" cy="18" r="16" fill="#0B101B" />
      <circle
        cx="18"
        cy="18"
        r="14.5"
        stroke={`url(#${ringGrad})`}
        strokeWidth="1.6"
        strokeOpacity="0.9"
      />
      <ellipse
        cx="18"
        cy="18"
        rx="12.5"
        ry="5.5"
        transform="rotate(-28 18 18)"
        stroke={`url(#${ringGrad})`}
        strokeWidth="1.5"
        strokeOpacity="0.55"
      />
      <path
        d="M13 11.5V24.5M23 11.5V24.5M13 18C15.5 16.4 20.5 19.6 23 18"
        stroke={`url(#${coreGrad})`}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="27.5" cy="9.5" r="2" fill="#22D3EE" />
    </svg>
  );
}
