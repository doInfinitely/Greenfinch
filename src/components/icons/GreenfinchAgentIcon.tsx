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
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Bird body silhouette */}
      <path
        d="M12 3C10.5 3 9.2 3.8 8.5 5C7.5 5.2 6.6 5.8 6 6.5C5.2 7.4 4.8 8.6 5 9.8C4.4 10.5 4 11.4 4 12.5C4 14.2 5.1 15.6 6.6 16.2L5 20C4.8 20.5 5.1 21 5.6 21.2C5.7 21.2 5.8 21.2 5.9 21.2C6.3 21.2 6.6 21 6.8 20.6L8.2 17.5C8.8 17.8 9.4 18 10 18H10.5L9.5 20.2C9.3 20.7 9.5 21.2 10 21.4C10.1 21.5 10.3 21.5 10.4 21.5C10.8 21.5 11.1 21.2 11.3 20.9L12.5 18H13L14.2 20.9C14.4 21.2 14.7 21.5 15.1 21.5C15.2 21.5 15.4 21.5 15.5 21.4C16 21.2 16.2 20.7 16 20.2L15 18H15.5C16.1 18 16.7 17.8 17.3 17.5L18.7 20.6C18.9 21 19.2 21.2 19.6 21.2C19.7 21.2 19.8 21.2 19.9 21.2C20.4 21 20.7 20.5 20.5 20L18.9 16.2C20.4 15.6 21.5 14.2 21.5 12.5C21.5 11.4 21.1 10.5 20.5 9.8C20.7 8.6 20.3 7.4 19.5 6.5C18.9 5.8 18 5.2 17 5C16.3 3.8 15 3 13.5 3H12Z"
        fill="currentColor"
        opacity="0.9"
      />
      {/* Detective hat */}
      <path
        d="M7 4.5C7.5 3 9.5 2 12 2C14.5 2 16.5 3 17 4.5L18 5C18 5 17.5 3.5 17 3C16 2 14.5 1 12 1C9.5 1 8 2 7 3C6.5 3.5 6 5 6 5L7 4.5Z"
        fill="currentColor"
      />
      <ellipse
        cx="12"
        cy="4"
        rx="5"
        ry="1.5"
        fill="currentColor"
      />
      {/* Magnifying glass */}
      <circle
        cx="17"
        cy="10"
        r="2.5"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
      />
      <line
        x1="18.8"
        y1="11.8"
        x2="21"
        y2="14"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {/* Eye */}
      <circle
        cx="10"
        cy="9"
        r="1"
        fill="white"
      />
      {/* Beak */}
      <path
        d="M7 10L5 11L7 12L7 10Z"
        fill="currentColor"
      />
    </svg>
  );
}
