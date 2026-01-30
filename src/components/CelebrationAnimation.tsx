'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Player } from '@lottiefiles/react-lottie-player';
import celebrationAnimation from '@/assets/celebration.json';

interface CelebrationAnimationProps {
  trigger: boolean;
  onComplete?: () => void;
  originRef?: React.RefObject<HTMLElement>;
}

export default function CelebrationAnimation({ trigger, onComplete, originRef }: CelebrationAnimationProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState({ x: 50, y: 10 });
  const playerRef = useRef<Player>(null);

  const updatePosition = useCallback(() => {
    if (originRef?.current) {
      const rect = originRef.current.getBoundingClientRect();
      const x = ((rect.left + rect.width / 2) / window.innerWidth) * 100;
      const y = ((rect.top + rect.height / 2) / window.innerHeight) * 100;
      setPosition({ x, y });
    }
  }, [originRef]);

  useEffect(() => {
    if (trigger && !isPlaying) {
      updatePosition();
      setIsPlaying(true);
    }
  }, [trigger, isPlaying, updatePosition]);

  const handleComplete = () => {
    setIsPlaying(false);
    onComplete?.();
  };

  if (!isPlaying) {
    return null;
  }

  return (
    <div
      className="fixed pointer-events-none z-[9999]"
      style={{
        left: `${position.x}%`,
        top: `${position.y}%`,
        transform: 'translate(-50%, -50%)',
        width: '300px',
        height: '300px',
      }}
    >
      <Player
        ref={playerRef}
        src={celebrationAnimation}
        autoplay
        loop={false}
        style={{ width: '100%', height: '100%' }}
        onEvent={(event) => {
          if (event === 'complete') {
            handleComplete();
          }
        }}
      />
    </div>
  );
}
