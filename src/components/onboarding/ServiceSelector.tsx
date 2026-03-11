'use client';

import { Check } from 'lucide-react';
import { SERVICE_CATEGORIES, SERVICE_CATEGORY_LABELS } from '@/lib/schema';

interface ServiceSelectorProps {
  selectedServices: string[];
  onToggle: (service: string) => void;
}

export default function ServiceSelector({ selectedServices, onToggle }: ServiceSelectorProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      {SERVICE_CATEGORIES.map((service) => (
        <label
          key={service}
          className={`
            flex items-center p-3 border rounded-lg cursor-pointer transition-colors
            ${selectedServices.includes(service)
              ? 'border-green-500 bg-green-50 text-green-700'
              : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'}
          `}
          data-testid={`checkbox-service-${service}`}
        >
          <input
            type="checkbox"
            checked={selectedServices.includes(service)}
            onChange={() => onToggle(service)}
            className="sr-only"
          />
          <div className={`
            w-5 h-5 rounded border-2 mr-3 flex items-center justify-center flex-shrink-0
            ${selectedServices.includes(service)
              ? 'border-green-500 bg-green-500'
              : 'border-gray-300'}
          `}>
            {selectedServices.includes(service) && (
              <Check className="w-3 h-3 text-white" />
            )}
          </div>
          <span className="text-sm font-medium">
            {SERVICE_CATEGORY_LABELS[service]}
          </span>
        </label>
      ))}
    </div>
  );
}
