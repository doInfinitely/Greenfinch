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
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-label="AI Research"
    >
      {/* Magnifying glass */}
      <circle cx="11" cy="11" r="7" />
      <line x1="16" y1="16" x2="21" y2="21" />
      {/* AI Sparkles */}
      <path d="M3 3l1 2 2 1-2 1-1 2-1-2-2-1 2-1z" fill="currentColor" stroke="none" />
      <path d="M19 2l0.5 1 1 0.5-1 0.5-0.5 1-0.5-1-1-0.5 1-0.5z" fill="currentColor" stroke="none" />
      <path d="M21 10l0.4 0.8 0.8 0.4-0.8 0.4-0.4 0.8-0.4-0.8-0.8-0.4 0.8-0.4z" fill="currentColor" stroke="none" />
    </svg>
  );
}
