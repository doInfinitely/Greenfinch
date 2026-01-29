'use client';

import { useState, useCallback, useEffect, ReactNode } from 'react';
import { X } from 'lucide-react';
import { Toast, ToastContext } from '@/hooks/use-toast';

function generateId(): string {
  return `toast_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = generateId();
    setToasts(prev => [...prev, { ...t, id }]);
    
    setTimeout(() => {
      setToasts(prev => prev.filter(toast => toast.id !== id));
    }, 5000);
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, toast, dismiss }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      {toasts.map(toast => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setIsVisible(true));
  }, []);

  const bgColor = toast.variant === 'destructive' 
    ? 'bg-red-600 text-white' 
    : 'bg-white border border-gray-200 text-gray-900';

  return (
    <div 
      className={`p-4 rounded-lg shadow-lg transition-all duration-300 ${bgColor} ${
        isVisible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'
      }`}
      data-testid={`toast-${toast.id}`}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          {toast.title && (
            <p className="font-semibold text-sm">{toast.title}</p>
          )}
          {toast.description && (
            <p className={`text-sm mt-1 ${toast.variant === 'destructive' ? 'text-red-100' : 'text-gray-600'}`}>
              {toast.description}
            </p>
          )}
        </div>
        <button
          onClick={() => onDismiss(toast.id)}
          className={`p-1 rounded hover:bg-black/10 transition-colors ${
            toast.variant === 'destructive' ? 'text-white' : 'text-gray-400'
          }`}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
