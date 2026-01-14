'use client';

import { useEffect, useState } from 'react';

interface EnrichmentModalProps {
  isOpen: boolean;
  propertyName?: string;
}

const ENRICHMENT_MESSAGES = [
  { text: "Spreading our wings...", icon: "🐦" },
  { text: "Scanning the property nest...", icon: "🪺" },
  { text: "Pecking through ownership records...", icon: "📋" },
  { text: "Mapping the flock hierarchy...", icon: "🗺️" },
  { text: "Following the paper trail...", icon: "📄" },
  { text: "Chirping with our data sources...", icon: "💬" },
  { text: "Fluttering through business networks...", icon: "🌐" },
  { text: "Hatching contact information...", icon: "🥚" },
  { text: "Preening the data for accuracy...", icon: "✨" },
  { text: "Gathering intel from the canopy...", icon: "🌳" },
  { text: "Swooping in on decision makers...", icon: "🎯" },
  { text: "Building your contact nest...", icon: "🏠" },
  { text: "Verifying emails with eagle eyes...", icon: "👀" },
  { text: "Connecting the dots like migration paths...", icon: "🔗" },
  { text: "Almost ready to land...", icon: "🛬" },
];

export default function EnrichmentModal({ isOpen, propertyName }: EnrichmentModalProps) {
  const [currentMessageIndex, setCurrentMessageIndex] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!isOpen) {
      setCurrentMessageIndex(0);
      setProgress(0);
      return;
    }

    const messageInterval = setInterval(() => {
      setCurrentMessageIndex((prev) => {
        const next = prev + 1;
        if (next >= ENRICHMENT_MESSAGES.length) {
          return ENRICHMENT_MESSAGES.length - 1;
        }
        return next;
      });
    }, 2500);

    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 95) return prev;
        return prev + Math.random() * 8;
      });
    }, 800);

    return () => {
      clearInterval(messageInterval);
      clearInterval(progressInterval);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const currentMessage = ENRICHMENT_MESSAGES[currentMessageIndex];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      
      <div className="relative bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full mx-4 transform animate-in fade-in zoom-in duration-300">
        <div className="text-center">
          <div className="relative w-24 h-24 mx-auto mb-6">
            <div className="absolute inset-0 rounded-full bg-green-100 animate-pulse" />
            <div className="absolute inset-2 rounded-full bg-green-50 flex items-center justify-center">
              <span className="text-4xl animate-bounce">{currentMessage.icon}</span>
            </div>
            <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
              <circle
                cx="50"
                cy="50"
                r="46"
                fill="none"
                stroke="#e5e7eb"
                strokeWidth="4"
              />
              <circle
                cx="50"
                cy="50"
                r="46"
                fill="none"
                stroke="#22c55e"
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={`${progress * 2.89} 289`}
                className="transition-all duration-500"
              />
            </svg>
          </div>

          <h3 className="text-xl font-semibold text-gray-900 mb-2">
            Finding Decision Makers
          </h3>
          
          {propertyName && (
            <p className="text-sm text-gray-500 mb-4">
              for {propertyName}
            </p>
          )}

          <div className="h-12 flex items-center justify-center">
            <p className="text-green-700 font-medium animate-pulse">
              {currentMessage.text}
            </p>
          </div>

          <div className="mt-6 flex items-center justify-center gap-2">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="w-2 h-2 rounded-full bg-green-500 animate-bounce"
                style={{ animationDelay: `${i * 150}ms` }}
              />
            ))}
          </div>

          <p className="mt-4 text-xs text-gray-400">
            This may take a minute or two
          </p>
        </div>
      </div>
    </div>
  );
}
