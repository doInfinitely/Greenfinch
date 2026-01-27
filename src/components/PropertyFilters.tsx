'use client';

import { useState, useEffect, useRef } from 'react';

export interface FilterState {
  minLotAcres: number | null;
  maxLotAcres: number | null;
  minNetSqft: number | null;
  maxNetSqft: number | null;
  categories: string[];
  subcategories: string[];
  buildingClasses: string[];
  acTypes: string[];
  heatingTypes: string[];
  organizationId: string | null;
  contactId: string | null;
  // Legacy fields for backwards compatibility
  minLotSqft: number | null;
  maxLotSqft: number | null;
}

interface PropertyFiltersProps {
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
  availableCategories?: string[];
  availableSubcategories?: string[];
  availableBuildingClasses?: string[];
  availableAcTypes?: string[];
  availableHeatingTypes?: string[];
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

const DEFAULT_BUILDING_CLASSES = ['A+', 'A', 'B', 'C', 'D'];

export const emptyFilters: FilterState = {
  minLotAcres: null,
  maxLotAcres: null,
  minNetSqft: null,
  maxNetSqft: null,
  categories: [],
  subcategories: [],
  buildingClasses: [],
  acTypes: [],
  heatingTypes: [],
  organizationId: null,
  contactId: null,
  minLotSqft: null,
  maxLotSqft: null,
};

export default function PropertyFilters({
  filters,
  onFiltersChange,
  availableCategories = DEFAULT_CATEGORIES,
  availableSubcategories = [],
  availableBuildingClasses = DEFAULT_BUILDING_CLASSES,
  availableAcTypes = [],
  availableHeatingTypes = [],
}: PropertyFiltersProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>('size');
  const [localMinLotAcres, setLocalMinLotAcres] = useState<string>(
    filters.minLotAcres ? String(filters.minLotAcres) : ''
  );
  const [localMaxLotAcres, setLocalMaxLotAcres] = useState<string>(
    filters.maxLotAcres ? String(filters.maxLotAcres) : ''
  );
  const [localMinNetSqft, setLocalMinNetSqft] = useState<string>(
    filters.minNetSqft ? String(filters.minNetSqft) : ''
  );
  const [localMaxNetSqft, setLocalMaxNetSqft] = useState<string>(
    filters.maxNetSqft ? String(filters.maxNetSqft) : ''
  );
  const [orgSearch, setOrgSearch] = useState('');
  const [contactSearch, setContactSearch] = useState('');
  const [orgResults, setOrgResults] = useState<{id: string; name: string}[]>([]);
  const [contactResults, setContactResults] = useState<{id: string; fullName: string}[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<{id: string; name: string} | null>(null);
  const [selectedContact, setSelectedContact] = useState<{id: string; fullName: string} | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && typeof window !== 'undefined' && window.innerWidth < 768) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [isOpen]);

  useEffect(() => {
    if (orgSearch.length < 2) {
      setOrgResults([]);
      return;
    }
    const controller = new AbortController();
    fetch(`/api/organizations/search?q=${encodeURIComponent(orgSearch)}`, { signal: controller.signal })
      .then(res => res.json())
      .then(data => setOrgResults(data.organizations || []))
      .catch(() => {});
    return () => controller.abort();
  }, [orgSearch]);

  useEffect(() => {
    if (contactSearch.length < 2) {
      setContactResults([]);
      return;
    }
    const controller = new AbortController();
    fetch(`/api/contacts/search?q=${encodeURIComponent(contactSearch)}`, { signal: controller.signal })
      .then(res => res.json())
      .then(data => setContactResults(data.contacts || []))
      .catch(() => {});
    return () => controller.abort();
  }, [contactSearch]);

  const handleAcresChange = (field: 'minLotAcres' | 'maxLotAcres', value: string, setter: (v: string) => void) => {
    setter(value);
    const numValue = parseFloat(value);
    const sqftValue = isNaN(numValue) || numValue <= 0 ? null : Math.round(numValue * 43560);
    const acresValue = isNaN(numValue) || numValue <= 0 ? null : numValue;
    onFiltersChange({
      ...filters,
      [field]: acresValue,
      [field === 'minLotAcres' ? 'minLotSqft' : 'maxLotSqft']: sqftValue,
    });
  };

  const handleNumberChange = (field: keyof FilterState, value: string, setter: (v: string) => void) => {
    setter(value);
    const numValue = parseInt(value, 10);
    onFiltersChange({
      ...filters,
      [field]: isNaN(numValue) || numValue <= 0 ? null : numValue,
    });
  };

  const handleArrayToggle = (field: keyof FilterState, value: string) => {
    const currentArray = (filters[field] as string[]) || [];
    const newArray = currentArray.includes(value)
      ? currentArray.filter(v => v !== value)
      : [...currentArray, value];
    onFiltersChange({ ...filters, [field]: newArray });
  };

  const handleClearArray = (field: keyof FilterState) => {
    onFiltersChange({ ...filters, [field]: [] });
  };

  const handleClearFilters = () => {
    setLocalMinLotAcres('');
    setLocalMaxLotAcres('');
    setLocalMinNetSqft('');
    setLocalMaxNetSqft('');
    setOrgSearch('');
    setContactSearch('');
    setSelectedOrg(null);
    setSelectedContact(null);
    onFiltersChange(emptyFilters);
  };

  const selectOrg = (org: {id: string; name: string}) => {
    setSelectedOrg(org);
    setOrgSearch('');
    setOrgResults([]);
    onFiltersChange({ ...filters, organizationId: org.id });
  };

  const clearOrg = () => {
    setSelectedOrg(null);
    onFiltersChange({ ...filters, organizationId: null });
  };

  const selectContact = (contact: {id: string; fullName: string}) => {
    setSelectedContact(contact);
    setContactSearch('');
    setContactResults([]);
    onFiltersChange({ ...filters, contactId: contact.id });
  };

  const clearContact = () => {
    setSelectedContact(null);
    onFiltersChange({ ...filters, contactId: null });
  };

  const activeFilterCount =
    (filters.minLotAcres || filters.maxLotAcres ? 1 : 0) +
    (filters.minNetSqft || filters.maxNetSqft ? 1 : 0) +
    ((filters.categories?.length ?? 0) > 0 ? 1 : 0) +
    ((filters.subcategories?.length ?? 0) > 0 ? 1 : 0) +
    ((filters.buildingClasses?.length ?? 0) > 0 ? 1 : 0) +
    ((filters.acTypes?.length ?? 0) > 0 ? 1 : 0) +
    ((filters.heatingTypes?.length ?? 0) > 0 ? 1 : 0) +
    (filters.organizationId ? 1 : 0) +
    (filters.contactId ? 1 : 0);

  const SectionHeader = ({ id, title, count, onClear }: { id: string; title: string; count?: number; onClear?: () => void }) => (
    <div className="flex items-center justify-between py-2">
      <button
        onClick={() => setActiveSection(activeSection === id ? null : id)}
        className="flex-1 flex items-center justify-between text-sm font-medium text-gray-700 hover:text-gray-900"
        data-testid={`section-${id}`}
      >
        <span className="flex items-center gap-2">
          {title}
          {count !== undefined && count > 0 && (
            <span className="inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded">
              {count}
            </span>
          )}
        </span>
        <svg
          className={`w-4 h-4 transition-transform ${activeSection === id ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {onClear && count !== undefined && count > 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); onClear(); }}
          className="ml-2 text-xs text-gray-400 hover:text-gray-600"
          data-testid={`button-clear-${id}`}
        >
          Clear
        </button>
      )}
    </div>
  );

  const FilterContent = () => (
    <div className="p-4 space-y-2">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-medium text-gray-900">Filter Properties</h3>
        {activeFilterCount > 0 && (
          <button
            onClick={handleClearFilters}
            className="text-xs text-gray-500 hover:text-gray-700"
            data-testid="button-clear-filters"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Organization Search - Top Level */}
      <div className="border-b border-gray-100 pb-3">
        <label className="block text-xs text-gray-600 mb-1.5 font-medium">Organization</label>
        {selectedOrg ? (
          <div className="flex items-center justify-between bg-green-50 border border-green-200 px-2 py-1.5 rounded text-sm">
            <span className="text-green-800 truncate">{selectedOrg.name}</span>
            <button onClick={clearOrg} className="text-green-600 hover:text-green-800 ml-2 flex-shrink-0" data-testid="button-clear-org">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ) : (
          <div className="relative">
            <input
              type="text"
              value={orgSearch}
              onChange={(e) => setOrgSearch(e.target.value)}
              placeholder="Search organizations..."
              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
              data-testid="input-org-search"
            />
            {orgResults.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded shadow-lg max-h-32 overflow-y-auto">
                {orgResults.map((org) => (
                  <button
                    key={org.id}
                    onClick={() => selectOrg(org)}
                    className="w-full text-left px-2 py-1.5 text-sm hover:bg-gray-100"
                    data-testid={`org-result-${org.id}`}
                  >
                    {org.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Contact Search - Top Level */}
      <div className="border-b border-gray-100 pb-3">
        <label className="block text-xs text-gray-600 mb-1.5 font-medium">Contact</label>
        {selectedContact ? (
          <div className="flex items-center justify-between bg-green-50 border border-green-200 px-2 py-1.5 rounded text-sm">
            <span className="text-green-800 truncate">{selectedContact.fullName}</span>
            <button onClick={clearContact} className="text-green-600 hover:text-green-800 ml-2 flex-shrink-0" data-testid="button-clear-contact">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ) : (
          <div className="relative">
            <input
              type="text"
              value={contactSearch}
              onChange={(e) => setContactSearch(e.target.value)}
              placeholder="Search contacts..."
              className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
              data-testid="input-contact-search"
            />
            {contactResults.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded shadow-lg max-h-32 overflow-y-auto">
                {contactResults.map((contact) => (
                  <button
                    key={contact.id}
                    onClick={() => selectContact(contact)}
                    className="w-full text-left px-2 py-1.5 text-sm hover:bg-gray-100"
                    data-testid={`contact-result-${contact.id}`}
                  >
                    {contact.fullName}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Size Filters */}
      <div className="border-b border-gray-100 pb-2">
        <SectionHeader id="size" title="Size" count={(filters.minLotAcres || filters.maxLotAcres ? 1 : 0) + (filters.minNetSqft || filters.maxNetSqft ? 1 : 0)} />
        {activeSection === 'size' && (
          <div className="mt-2 space-y-3">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Lot Size (acres)</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  step="0.1"
                  value={localMinLotAcres}
                  onChange={(e) => handleAcresChange('minLotAcres', e.target.value, setLocalMinLotAcres)}
                  placeholder="Min"
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                  data-testid="input-min-lot-acres"
                />
                <input
                  type="number"
                  step="0.1"
                  value={localMaxLotAcres}
                  onChange={(e) => handleAcresChange('maxLotAcres', e.target.value, setLocalMaxLotAcres)}
                  placeholder="Max"
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                  data-testid="input-max-lot-acres"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Net Building Sq Ft</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={localMinNetSqft}
                  onChange={(e) => handleNumberChange('minNetSqft', e.target.value, setLocalMinNetSqft)}
                  placeholder="Min"
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                  data-testid="input-min-net-sqft"
                />
                <input
                  type="number"
                  value={localMaxNetSqft}
                  onChange={(e) => handleNumberChange('maxNetSqft', e.target.value, setLocalMaxNetSqft)}
                  placeholder="Max"
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                  data-testid="input-max-net-sqft"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Category & Subcategory */}
      <div className="border-b border-gray-100 pb-2">
        <SectionHeader 
          id="category" 
          title="Category" 
          count={(filters.categories?.length ?? 0) + (filters.subcategories?.length ?? 0)}
          onClear={() => { handleClearArray('categories'); handleClearArray('subcategories'); }}
        />
        {activeSection === 'category' && (
          <div className="mt-2 space-y-2 max-h-40 overflow-y-auto">
            {availableCategories.map((cat) => (
              <label key={cat} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 px-1 py-0.5 rounded">
                <input
                  type="checkbox"
                  checked={filters.categories?.includes(cat) ?? false}
                  onChange={() => handleArrayToggle('categories', cat)}
                  className="w-3.5 h-3.5 text-green-600 rounded"
                  data-testid={`checkbox-category-${cat.toLowerCase().replace(/\s+/g, '-')}`}
                />
                <span className="text-gray-700">{cat}</span>
              </label>
            ))}
            {availableSubcategories.length > 0 && (
              <>
                <div className="text-xs text-gray-500 mt-2 mb-1">Subcategories</div>
                {availableSubcategories.map((sub) => (
                  <label key={sub} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 px-1 py-0.5 rounded pl-4">
                    <input
                      type="checkbox"
                      checked={filters.subcategories?.includes(sub) ?? false}
                      onChange={() => handleArrayToggle('subcategories', sub)}
                      className="w-3.5 h-3.5 text-green-600 rounded"
                      data-testid={`checkbox-subcategory-${sub.toLowerCase().replace(/\s+/g, '-')}`}
                    />
                    <span className="text-gray-600">{sub}</span>
                  </label>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* Building Class */}
      <div className="border-b border-gray-100 pb-2">
        <SectionHeader 
          id="class" 
          title="Building Class" 
          count={filters.buildingClasses?.length ?? 0}
          onClear={() => handleClearArray('buildingClasses')}
        />
        {activeSection === 'class' && (
          <div className="mt-2 flex flex-wrap gap-2">
            {availableBuildingClasses.map((cls) => (
              <button
                key={cls}
                onClick={() => handleArrayToggle('buildingClasses', cls)}
                className={`px-3 py-1 text-sm rounded-full border transition-colors ${
                  filters.buildingClasses?.includes(cls)
                    ? 'bg-green-100 border-green-500 text-green-700'
                    : 'bg-white border-gray-300 text-gray-600 hover:border-gray-400'
                }`}
                data-testid={`button-class-${cls}`}
              >
                {cls}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* HVAC */}
      {(availableAcTypes.length > 0 || availableHeatingTypes.length > 0) && (
        <div className="border-b border-gray-100 pb-2">
          <SectionHeader 
            id="hvac" 
            title="HVAC" 
            count={(filters.acTypes?.length ?? 0) + (filters.heatingTypes?.length ?? 0)}
            onClear={() => { handleClearArray('acTypes'); handleClearArray('heatingTypes'); }}
          />
          {activeSection === 'hvac' && (
            <div className="mt-2 space-y-3">
              {availableAcTypes.length > 0 && (
                <div>
                  <label className="block text-xs text-gray-600 mb-1">AC Type</label>
                  <div className="flex flex-wrap gap-1">
                    {availableAcTypes.slice(0, 6).map((type) => (
                      <button
                        key={type}
                        onClick={() => handleArrayToggle('acTypes', type)}
                        className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                          filters.acTypes?.includes(type)
                            ? 'bg-blue-100 border-blue-400 text-blue-700'
                            : 'bg-white border-gray-300 text-gray-600'
                        }`}
                        data-testid={`button-ac-${type.toLowerCase().replace(/\s+/g, '-')}`}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {availableHeatingTypes.length > 0 && (
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Heating Type</label>
                  <div className="flex flex-wrap gap-1">
                    {availableHeatingTypes.slice(0, 6).map((type) => (
                      <button
                        key={type}
                        onClick={() => handleArrayToggle('heatingTypes', type)}
                        className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                          filters.heatingTypes?.includes(type)
                            ? 'bg-orange-100 border-orange-400 text-orange-700'
                            : 'bg-white border-gray-300 text-gray-600'
                        }`}
                        data-testid={`button-heating-${type.toLowerCase().replace(/\s+/g, '-')}`}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-3 py-2 border rounded-lg text-sm transition-colors ${
          activeFilterCount > 0
            ? 'border-green-500 bg-green-50 text-green-700'
            : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
        }`}
        data-testid="button-open-filters"
        aria-label="Open filters"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
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
        <>
          {/* Mobile: Full screen overlay */}
          <div 
            className="md:hidden fixed inset-0 z-50 flex items-end justify-center"
            role="dialog"
            aria-modal="true"
          >
            <div 
              className="absolute inset-0 bg-black/50"
              onClick={() => setIsOpen(false)}
            />
            <div className="relative w-full max-h-[85vh] bg-white rounded-t-xl overflow-hidden flex flex-col">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                <h2 className="font-semibold text-gray-900">Filters</h2>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-2 hover:bg-gray-100 rounded-lg"
                  data-testid="button-close-filters-mobile"
                >
                  <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto">
                <FilterContent />
              </div>
            </div>
          </div>

          {/* Desktop: Dropdown */}
          <div className="hidden md:block absolute top-full left-0 mt-2 w-80 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-[70vh] overflow-y-auto">
            <FilterContent />
          </div>
        </>
      )}
    </div>
  );
}
