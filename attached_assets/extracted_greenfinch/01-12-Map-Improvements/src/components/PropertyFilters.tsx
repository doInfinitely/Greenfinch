'use client';

import { useState, useEffect, useRef } from 'react';

export interface FilterState {
  minLotAcres: number | null;
  categories: string[];
}

interface PropertyFiltersProps {
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
  availableCategories?: string[];
}

const DEFAULT_CATEGORIES = [
  'Healthcare',
  'Hospitality',
  'Industrial',
  'Multifamily',
  'Office',
  'Public & Institutional',
  'Retail',
  'Special Purpose',
];

export default function PropertyFilters({
  filters,
  onFiltersChange,
  availableCategories = DEFAULT_CATEGORIES,
}: PropertyFiltersProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [localMinLot, setLocalMinLot] = useState<string>(
    filters.minLotAcres ? String(filters.minLotAcres) : ''
  );
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleMinLotChange = (value: string) => {
    setLocalMinLot(value);
    const numValue = parseFloat(value);
    onFiltersChange({
      ...filters,
      minLotAcres: isNaN(numValue) || numValue <= 0 ? null : numValue,
    });
  };

  const handleCategoryToggle = (category: string) => {
    const newCategories = filters.categories.includes(category)
      ? filters.categories.filter(c => c !== category)
      : [...filters.categories, category];
    onFiltersChange({ ...filters, categories: newCategories });
  };

  const handleSelectAll = () => {
    onFiltersChange({ ...filters, categories: [...availableCategories] });
  };

  const handleClearAll = () => {
    onFiltersChange({ ...filters, categories: [] });
  };

  const handleClearFilters = () => {
    setLocalMinLot('');
    onFiltersChange({ minLotAcres: null, categories: [] });
  };

  const activeFilterCount =
    (filters.minLotAcres ? 1 : 0) +
    (filters.categories.length > 0 ? 1 : 0);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-3 py-2 border rounded-lg text-sm transition-colors ${
          activeFilterCount > 0
            ? 'border-green-500 bg-green-50 text-green-700'
            : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
        }`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
        </svg>
        Filters
        {activeFilterCount > 0 && (
          <span className="inline-flex items-center justify-center w-5 h-5 text-xs font-medium bg-green-600 text-white rounded-full">
            {activeFilterCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-2 w-72 bg-white border border-gray-200 rounded-lg shadow-lg z-50">
          <div className="p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium text-gray-900">Filter Properties</h3>
              {activeFilterCount > 0 && (
                <button
                  onClick={handleClearFilters}
                  className="text-xs text-gray-500 hover:text-gray-700"
                >
                  Clear all
                </button>
              )}
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Minimum Lot Size (acres)
              </label>
              <input
                type="number"
                value={localMinLot}
                onChange={(e) => handleMinLotChange(e.target.value)}
                placeholder="e.g., 1.0"
                min="0"
                step="0.1"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700">
                  Property Categories
                </label>
                <div className="flex gap-2">
                  <button
                    onClick={handleSelectAll}
                    className="text-xs text-green-600 hover:text-green-700"
                  >
                    All
                  </button>
                  <span className="text-gray-300">|</span>
                  <button
                    onClick={handleClearAll}
                    className="text-xs text-gray-500 hover:text-gray-700"
                  >
                    None
                  </button>
                </div>
              </div>
              <div className="max-h-48 overflow-y-auto space-y-1">
                {availableCategories.map((category) => (
                  <label
                    key={category}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={filters.categories.includes(category)}
                      onChange={() => handleCategoryToggle(category)}
                      className="w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
                    />
                    <span className="text-sm text-gray-700">{category}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="border-t border-gray-100 px-4 py-3 bg-gray-50 rounded-b-lg">
            <button
              onClick={() => setIsOpen(false)}
              className="w-full px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors"
            >
              Apply Filters
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
