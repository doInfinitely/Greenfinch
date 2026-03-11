'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { Compass, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useWalkthrough } from '@/contexts/WalkthroughContext';

export default function WalkthroughPrompt() {
  const { pendingTour, acceptTour, dismissTour, skipAll } = useWalkthrough();

  return (
    <AnimatePresence>
      {pendingTour && (
        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.95 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="fixed bottom-6 right-6 z-50 w-80 bg-white border border-gray-200 rounded-xl shadow-lg p-4"
        >
          <button
            onClick={dismissTour}
            className="absolute top-3 right-3 text-gray-400 hover:text-gray-600"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0">
              <Compass className="w-5 h-5 text-green-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900">
                New here? Take a quick tour
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                Learn the basics of {pendingTour.title} in a few steps.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between mt-4">
            <button
              onClick={skipAll}
              className="text-xs text-gray-400 hover:text-gray-600 hover:underline"
            >
              Don&apos;t show tours
            </button>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={dismissTour}>
                Not now
              </Button>
              <Button size="sm" onClick={acceptTour} className="bg-green-600 hover:bg-green-700 text-white">
                Start Tour
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
