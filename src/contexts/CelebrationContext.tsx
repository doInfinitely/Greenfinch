'use client';

import { createContext, useContext, useState, useCallback, ReactNode, useRef } from 'react';
import CelebrationAnimation from '@/components/CelebrationAnimation';

interface CelebrationContextType {
  celebrate: () => void;
  setOriginRef: (ref: React.RefObject<HTMLElement>) => void;
}

const CelebrationContext = createContext<CelebrationContextType | undefined>(undefined);

export function CelebrationProvider({ children }: { children: ReactNode }) {
  const [trigger, setTrigger] = useState(false);
  const [key, setKey] = useState(0);
  const originRef = useRef<HTMLElement>(null);
  const storedOriginRef = useRef<React.RefObject<HTMLElement>>(originRef);

  const celebrate = useCallback(() => {
    setKey(prev => prev + 1);
    setTrigger(true);
  }, []);

  const setOriginRef = useCallback((ref: React.RefObject<HTMLElement>) => {
    storedOriginRef.current = ref;
  }, []);

  const handleComplete = useCallback(() => {
    setTrigger(false);
  }, []);

  return (
    <CelebrationContext.Provider value={{ celebrate, setOriginRef }}>
      {children}
      <CelebrationAnimation
        key={key}
        trigger={trigger}
        onComplete={handleComplete}
        originRef={storedOriginRef.current}
      />
    </CelebrationContext.Provider>
  );
}

export function useCelebration() {
  const context = useContext(CelebrationContext);
  if (!context) {
    throw new Error('useCelebration must be used within a CelebrationProvider');
  }
  return context;
}
