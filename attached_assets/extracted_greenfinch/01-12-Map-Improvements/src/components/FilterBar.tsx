'use client';

import { useState, useEffect } from 'react';

interface FilterBarProps {
  categories: string[];
  subcategories: string[];
  zipCodes: string[];
  filters: {
    category: string;
    subcategory: string;
    enriched: string;
    zipCode: string;
  };
  onFilterChange: (filters: {
    category: string;
    subcategory: string;
    enriched: string;
    zipCode: string;
  }) => void;
}

export default function FilterBar({
  categories,
  subcategories,
  zipCodes,
  filters,
  onFilterChange,
}: FilterBarProps) {
  const activeFilterCount = [
    filters.category,
    filters.subcategory,
    filters.enriched,
    filters.zipCode,
  ].filter(Boolean).length;

  const handleFilterChange = (key: string, value: string) => {
    onFilterChange({
      ...filters,
      [key]: value,
    });
  };

  const clearFilters = () => {
    onFilterChange({
      category: '',
      subcategory: '',
      enriched: '',
      zipCode: '',
    });
  };

  return (
    <div className="bg-white border-b border-gray-200 px-4 py-3">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={filters.category}
            onChange={(e) => handleFilterChange('category', e.target.value)}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white"
          >
            <option value="">All Categories</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>

          <select
            value={filters.subcategory}
            onChange={(e) => handleFilterChange('subcategory', e.target.value)}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white"
          >
            <option value="">All Subcategories</option>
            {subcategories.map((sub) => (
              <option key={sub} value={sub}>
                {sub}
              </option>
            ))}
          </select>

          <select
            value={filters.enriched}
            onChange={(e) => handleFilterChange('enriched', e.target.value)}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white"
          >
            <option value="">Enriched: All</option>
            <option value="true">Enriched: Yes</option>
            <option value="false">Enriched: No</option>
          </select>

          <select
            value={filters.zipCode}
            onChange={(e) => handleFilterChange('zipCode', e.target.value)}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white"
          >
            <option value="">All ZIP Codes</option>
            {zipCodes.map((zip) => (
              <option key={zip} value={zip}>
                {zip}
              </option>
            ))}
          </select>

          {activeFilterCount > 0 && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
              Clear filters
              <span className="bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full text-xs font-medium">
                {activeFilterCount}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
