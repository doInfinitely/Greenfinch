'use client';

interface GreenfinchAgentIconProps {
  className?: string;
  size?: number;
}

export default function GreenfinchAgentIcon({ className = '', size = 20 }: GreenfinchAgentIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="currentColor"
      className={className}
      aria-label="Greenfinch Agent"
    >
      {/* Detective silhouette with hat, coat, and magnifying glass */}
      {/* Hat brim */}
      <ellipse cx="38" cy="18" rx="28" ry="6" />
      {/* Hat top */}
      <path d="M20 18 Q20 8 38 6 Q56 8 56 18 Z" />
      {/* Head */}
      <ellipse cx="38" cy="28" rx="14" ry="10" />
      {/* Coat collar left */}
      <path d="M24 35 Q10 45 8 70 L30 55 Z" />
      {/* Coat collar right */}
      <path d="M52 35 Q60 45 55 65 L38 50 Z" />
      {/* Coat body */}
      <path d="M8 70 Q5 85 15 95 L55 95 Q62 85 55 65 L38 50 L30 55 Z" />
      {/* Coat lapel detail (white line effect - we'll create a gap) */}
      <path d="M30 55 Q32 48 38 50" fill="none" stroke="currentColor" strokeWidth="0.5" opacity="0.3" />
      {/* Arm holding magnifying glass */}
      <ellipse cx="60" cy="82" rx="12" ry="8" />
      {/* Magnifying glass handle */}
      <rect x="72" y="58" width="6" height="18" rx="2" transform="rotate(35 75 67)" />
      {/* Magnifying glass ring */}
      <circle cx="82" cy="48" r="14" fill="none" stroke="currentColor" strokeWidth="5" />
      {/* Magnifying glass inner (transparent) */}
      <circle cx="82" cy="48" r="9" fill="white" fillOpacity="0" />
    </svg>
  );
}
