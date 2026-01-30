'use client';

import Image from 'next/image';

interface GreenfinchAgentIconProps {
  className?: string;
  size?: number;
}

export default function GreenfinchAgentIcon({ className = '', size = 20 }: GreenfinchAgentIconProps) {
  return (
    <div 
      className={`relative ${className}`}
      style={{ 
        width: size, 
        height: size,
      }}
    >
      <Image
        src="/detective-icon.png"
        alt="Greenfinch Agent"
        width={size}
        height={size}
        className="object-contain"
        style={{
          filter: 'invert(42%) sepia(93%) saturate(401%) hue-rotate(87deg) brightness(95%) contrast(95%)'
        }}
      />
    </div>
  );
}
