'use client';

import { useState, useCallback, createContext, useContext, ReactNode } from 'react';

export interface Toast {
  id: string;
  title?: string;
  description?: string;
  variant?: 'default' | 'destructive';
}

interface ToastContextType {
  toasts: Toast[];
  toast: (toast: Omit<Toast, 'id'>) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    return {
      toasts: [],
      toast: (t: Omit<Toast, 'id'>) => {
        console.log('[Toast]', t.title, t.description);
      },
      dismiss: () => {},
    };
  }
  return context;
}

export { ToastContext };
