'use client';

import { useState, useEffect, useRef } from 'react';
import { useDebounce } from '@/hooks/use-debounce';
import { Checkbox } from '@/components/ui/checkbox';

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
  enrichmentStatus: 'all' | 'researched' | 'not_researched';
  customerStatuses: string[];
  zipCodes: string[];
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
  availableZipCodes?: string[];
}

const UNKNOWN_CATEGORY = 'Unknown / Unassigned';

const DEFAULT_CATEGORIES = [
  'Healthcare',
  'Hospitality',
  'Industrial',
  'Multifamily',
  'Office',
  'Public & Institutional',
  'Retail',
  'Special Purpose',
  UNKNOWN_CATEGORY,
];

const UNKNOWN_BUILDING_CLASS = 'Unknown';
const DEFAULT_BUILDING_CLASSES = ['A', 'B', 'C', 'D', UNKNOWN_BUILDING_CLASS];

export { UNKNOWN_BUILDING_CLASS };

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
  enrichmentStatus: 'all',
  customerStatuses: [],
  zipCodes: [],
  minLotSqft: null,
  maxLotSqft: null,
};

export { UNKNOWN_CATEGORY };

export function serializeFiltersToParams(filters: FilterState): URLSearchParams {
  const params = new URLSearchParams();
  
  if (filters.minLotAcres) params.set('minLotAcres', String(filters.minLotAcres));
  if (filters.maxLotAcres) params.set('maxLotAcres', String(filters.maxLotAcres));
  if (filters.minNetSqft) params.set('minNetSqft', String(filters.minNetSqft));
  if (filters.maxNetSqft) params.set('maxNetSqft', String(filters.maxNetSqft));
  if (filters.categories.length > 0) params.set('categories', filters.categories.join(','));
  if (filters.subcategories.length > 0) params.set('subcategories', filters.subcategories.join(','));
  if (filters.buildingClasses.length > 0) params.set('buildingClasses', filters.buildingClasses.join(','));
  if (filters.acTypes.length > 0) params.set('acTypes', filters.acTypes.join(','));
  if (filters.heatingTypes.length > 0) params.set('heatingTypes', filters.heatingTypes.join(','));
  if (filters.organizationId) params.set('organizationId', filters.organizationId);
  if (filters.contactId) params.set('contactId', filters.contactId);
  if (filters.enrichmentStatus !== 'all') params.set('enrichmentStatus', filters.enrichmentStatus);
  if (filters.customerStatuses.length > 0) params.set('customerStatuses', filters.customerStatuses.join(','));
  if (filters.zipCodes.length > 0) params.set('zipCodes', filters.zipCodes.join(','));
  
  return params;
}

export function parseFiltersFromParams(searchParams: URLSearchParams): FilterState {
  const minLotAcres = searchParams.get('minLotAcres');
  const maxLotAcres = searchParams.get('maxLotAcres');
  const minNetSqft = searchParams.get('minNetSqft');
  const maxNetSqft = searchParams.get('maxNetSqft');
  const categories = searchParams.get('categories');
  const subcategories = searchParams.get('subcategories');
  const buildingClasses = searchParams.get('buildingClasses');
  const acTypes = searchParams.get('acTypes');
  const heatingTypes = searchParams.get('heatingTypes');
  const organizationId = searchParams.get('organizationId');
  const contactId = searchParams.get('contactId');
  const enrichmentStatus = searchParams.get('enrichmentStatus') as 'all' | 'researched' | 'not_researched' | null;
  const customerStatuses = searchParams.get('customerStatuses');
  const zipCodes = searchParams.get('zipCodes');

  const parsedMinLotAcres = minLotAcres ? parseFloat(minLotAcres) : null;
  const parsedMaxLotAcres = maxLotAcres ? parseFloat(maxLotAcres) : null;

  return {
    minLotAcres: parsedMinLotAcres,
    maxLotAcres: parsedMaxLotAcres,
    minNetSqft: minNetSqft ? parseInt(minNetSqft, 10) : null,
    maxNetSqft: maxNetSqft ? parseInt(maxNetSqft, 10) : null,
    categories: categories ? categories.split(',') : [],
    subcategories: subcategories ? subcategories.split(',') : [],
    buildingClasses: buildingClasses ? buildingClasses.split(',') : [],
    acTypes: acTypes ? acTypes.split(',') : [],
    heatingTypes: heatingTypes ? heatingTypes.split(',') : [],
    organizationId: organizationId || null,
    contactId: contactId || null,
    enrichmentStatus: enrichmentStatus || 'all',
    customerStatuses: customerStatuses ? customerStatuses.split(',') : [],
    zipCodes: zipCodes ? zipCodes.split(',') : [],
    minLotSqft: parsedMinLotAcres ? Math.round(parsedMinLotAcres * 43560) : null,
    maxLotSqft: parsedMaxLotAcres ? Math.round(parsedMaxLotAcres * 43560) : null,
  };
}

export default function PropertyFilters({
  filters,
  onFiltersChange,
  availableCategories = DEFAULT_CATEGORIES,
  availableSubcategories = [],
  availableBuildingClasses = DEFAULT_BUILDING_CLASSES,
  availableAcTypes = [],
  availableHeatingTypes = [],
  availableZipCodes = [],
}: PropertyFiltersProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());
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
  const [zipSearch, setZipSearch] = useState('');
  const [orgResults, setOrgResults] = useState<{id: string; name: string}[]>([]);
  const [contactResults, setContactResults] = useState<{id: string; fullName: string}[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<{id: string; name: string} | null>(null);
  const [selectedContact, setSelectedContact] = useState<{id: string; fullName: string} | null>(null);
  const [showZipSuggestions, setShowZipSuggestions] = useState(false);
  const [fetchedZipCodes, setFetchedZipCodes] = useState<string[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Merge provided zip codes with fetched zip codes
  const allAvailableZipCodes = availableZipCodes.length > 0 ? availableZipCodes : fetchedZipCodes;

  // Fetch zip codes from API on mount if not provided via props
  useEffect(() => {
    if (availableZipCodes.length === 0) {
      fetch('/api/properties/filter-options')
        .then(res => res.json())
        .then(data => {
          if (data.zipCodes) {
            setFetchedZipCodes(data.zipCodes);
          }
        })
        .catch(() => {});
    }
  }, [availableZipCodes.length]);

  // Debounce organization and contact search inputs with 300ms delay
  const debouncedOrgSearch = useDebounce(orgSearch, 300);
  const debouncedContactSearch = useDebounce(contactSearch, 300);
  const debouncedZipSearch = useDebounce(zipSearch, 300);

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
    if (debouncedOrgSearch.length < 2) {
      setOrgResults([]);
      return;
    }
    const controller = new AbortController();
    fetch(`/api/organizations/search?q=${encodeURIComponent(debouncedOrgSearch)}`, { signal: controller.signal })
      .then(res => res.json())
      .then(data => setOrgResults(data.organizations || []))
      .catch(() => {});
    return () => controller.abort();
  }, [debouncedOrgSearch]);

  useEffect(() => {
    if (debouncedContactSearch.length < 2) {
      setContactResults([]);
      return;
    }
    const controller = new AbortController();
    fetch(`/api/contacts/search?q=${encodeURIComponent(debouncedContactSearch)}`, { signal: controller.signal })
      .then(res => res.json())
      .then(data => setContactResults(data.contacts || []))
      .catch(() => {});
    return () => controller.abort();
  }, [debouncedContactSearch]);

  // Filter zip code suggestions based on search
  const filteredZipCodes = debouncedZipSearch.trim()
    ? allAvailableZipCodes.filter(
        zip => zip.startsWith(debouncedZipSearch.trim()) && !filters.zipCodes.includes(zip)
      )
    : [];

  const addZipCode = (zip: string) => {
    if (!filters.zipCodes.includes(zip)) {
      onFiltersChange({ ...filters, zipCodes: [...filters.zipCodes, zip] });
    }
    setZipSearch('');
    setShowZipSuggestions(false);
  };

  const removeZipCode = (zip: string) => {
    onFiltersChange({ ...filters, zipCodes: filters.zipCodes.filter(z => z !== zip) });
  };

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

  const handleClearArray = (...fields: (keyof FilterState)[]) => {
    const updates: Partial<FilterState> = {};
    for (const field of fields) {
      updates[field] = [] as never;
    }
    onFiltersChange({ ...filters, ...updates });
  };

  const handleClearFilters = () => {
    setLocalMinLotAcres('');
    setLocalMaxLotAcres('');
    setLocalMinNetSqft('');
    setLocalMaxNetSqft('');
    setOrgSearch('');
    setContactSearch('');
    setZipSearch('');
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
    (filters.contactId ? 1 : 0) +
    (filters.enrichmentStatus !== 'all' ? 1 : 0) +
    ((filters.customerStatuses?.length ?? 0) > 0 ? 1 : 0) +
    ((filters.zipCodes?.length ?? 0) > 0 ? 1 : 0);

  const toggleSection = (id: string) => {
    setOpenSections(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const SectionHeader = ({ id, title, count, onClear }: { id: string; title: string; count?: number; onClear?: () => void }) => (
    <div className="flex items-center justify-between py-3 gap-3">
      <button
        onClick={() => toggleSection(id)}
        className="flex-1 flex items-center gap-2 text-sm font-medium text-gray-700 active:text-gray-900"
        data-testid={`section-${id}`}
      >
        <svg
          className={`w-5 h-5 transition-transform flex-shrink-0 ${openSections.has(id) ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
        <span className="flex items-center gap-2">
          {title}
          {count !== undefined && count > 0 && (
            <span className="inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded">
              {count}
            </span>
          )}
        </span>
      </button>
      {onClear && count !== undefined && count > 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); onClear(); }}
          className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-lg active:bg-gray-100"
          data-testid={`button-clear-${id}`}
        >
          Clear
        </button>
      )}
    </div>
  );

  const filterContent = (
    <div className="p-4 space-y-2">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-medium text-gray-900">Filter Properties</h3>
        {activeFilterCount > 0 && (
          <button
            onClick={handleClearFilters}
            className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-50 border border-gray-200 rounded-lg active:bg-gray-100"
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
          <div className="flex items-center justify-between bg-green-50 border border-green-200 px-3 py-2.5 rounded-lg text-sm">
            <span className="text-green-800 truncate">{selectedOrg.name}</span>
            <button onClick={clearOrg} className="text-green-600 active:text-green-800 ml-2 flex-shrink-0 p-1" data-testid="button-clear-org">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm"
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
          <div className="flex items-center justify-between bg-green-50 border border-green-200 px-3 py-2.5 rounded-lg text-sm">
            <span className="text-green-800 truncate">{selectedContact.fullName}</span>
            <button onClick={clearContact} className="text-green-600 active:text-green-800 ml-2 flex-shrink-0 p-1" data-testid="button-clear-contact">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm"
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

      {/* Zip Code Filter - Top Level with Multi-Select Autocomplete */}
      <div className="border-b border-gray-100 pb-3">
        <div className="flex items-center justify-between mb-1.5">
          <label className="block text-xs text-gray-600 font-medium">Zip Codes</label>
          {filters.zipCodes.length > 0 && (
            <button
              onClick={() => onFiltersChange({ ...filters, zipCodes: [] })}
              className="text-xs text-gray-500 hover:text-gray-700"
              data-testid="button-clear-all-zip-codes"
            >
              Clear all
            </button>
          )}
        </div>
        {filters.zipCodes.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {filters.zipCodes.map((zip) => (
              <span
                key={zip}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-green-100 text-green-700 rounded-full"
              >
                {zip}
                <button
                  onClick={() => removeZipCode(zip)}
                  className="text-green-600 hover:text-green-800"
                  data-testid={`button-remove-zip-${zip}`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="relative">
          <input
            type="text"
            value={zipSearch}
            onChange={(e) => {
              setZipSearch(e.target.value);
              setShowZipSuggestions(true);
            }}
            onFocus={() => setShowZipSuggestions(true)}
            placeholder={filters.zipCodes.length > 0 ? "Add more zip codes..." : "Search zip codes..."}
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm"
            data-testid="input-zip-code-search"
          />
          {zipSearch && (
            <button
              onClick={() => {
                setZipSearch('');
                setShowZipSuggestions(false);
              }}
              className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600"
              data-testid="button-clear-zip-search"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
          {showZipSuggestions && filteredZipCodes.length > 0 && (
            <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded shadow-lg max-h-32 overflow-y-auto">
              {filteredZipCodes.slice(0, 10).map((zip) => (
                <button
                  key={zip}
                  onClick={() => addZipCode(zip)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100"
                  data-testid={`zip-result-${zip}`}
                >
                  {zip}
                </button>
              ))}
            </div>
          )}
          {showZipSuggestions && zipSearch.trim() && filteredZipCodes.length === 0 && (
            <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded shadow-lg p-3 text-sm text-gray-500">
              No matching zip codes found
            </div>
          )}
        </div>
      </div>

      {/* Pipeline Status Filter */}
      <div className="border-b border-gray-100 pb-2">
        <SectionHeader 
          id="pipelineStatus" 
          title="Pipeline Status" 
          count={filters.customerStatuses?.length ?? 0}
          onClear={() => handleClearArray('customerStatuses')}
        />
        {openSections.has('pipelineStatus') && (
          <div className="mt-2 space-y-1">
            {['prospect', 'qualified', 'proposal', 'negotiation', 'won'].map((status) => (
              <label key={status} className="flex items-center gap-3 text-sm cursor-pointer hover:bg-gray-50 active:bg-gray-100 px-2 py-2.5 rounded-lg">
                <Checkbox
                  checked={filters.customerStatuses?.includes(status) ?? false}
                  onChange={() => handleArrayToggle('customerStatuses', status)}
                  data-testid={`checkbox-status-${status}`}
                />
                <span className="text-gray-700 capitalize">{status === 'won' ? 'Won (Customer)' : status}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="border-b border-gray-100 pb-2">
        <SectionHeader 
          id="size" 
          title="Size" 
          count={(filters.minLotAcres || filters.maxLotAcres ? 1 : 0) + (filters.minNetSqft || filters.maxNetSqft ? 1 : 0)}
          onClear={() => {
            setLocalMinLotAcres('');
            setLocalMaxLotAcres('');
            setLocalMinNetSqft('');
            setLocalMaxNetSqft('');
            onFiltersChange({
              ...filters,
              minLotAcres: null,
              maxLotAcres: null,
              minNetSqft: null,
              maxNetSqft: null,
              minLotSqft: null,
              maxLotSqft: null,
            });
          }}
        />
        {openSections.has('size') && (
          <div className="mt-2 space-y-4">
            <div>
              <label className="block text-xs text-gray-600 mb-1.5">Lot Size (acres)</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  step="0.1"
                  value={localMinLotAcres}
                  onChange={(e) => handleAcresChange('minLotAcres', e.target.value, setLocalMinLotAcres)}
                  placeholder="Min"
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm"
                  data-testid="input-min-lot-acres"
                />
                <input
                  type="number"
                  step="0.1"
                  value={localMaxLotAcres}
                  onChange={(e) => handleAcresChange('maxLotAcres', e.target.value, setLocalMaxLotAcres)}
                  placeholder="Max"
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm"
                  data-testid="input-max-lot-acres"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1.5">Net Building Sq Ft</label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={localMinNetSqft}
                  onChange={(e) => handleNumberChange('minNetSqft', e.target.value, setLocalMinNetSqft)}
                  placeholder="Min"
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm"
                  data-testid="input-min-net-sqft"
                />
                <input
                  type="number"
                  value={localMaxNetSqft}
                  onChange={(e) => handleNumberChange('maxNetSqft', e.target.value, setLocalMaxNetSqft)}
                  placeholder="Max"
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm"
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
          onClear={() => handleClearArray('categories', 'subcategories')}
        />
        {openSections.has('category') && (
          <div className="mt-2 space-y-1">
            {availableCategories.map((cat) => (
              <label key={cat} className="flex items-center gap-3 text-sm cursor-pointer hover:bg-gray-50 active:bg-gray-100 px-2 py-2.5 rounded-lg">
                <Checkbox
                  checked={filters.categories?.includes(cat) ?? false}
                  onChange={() => handleArrayToggle('categories', cat)}
                  data-testid={`checkbox-category-${cat.toLowerCase().replace(/\s+/g, '-')}`}
                />
                <span className="text-gray-700">{cat}</span>
              </label>
            ))}
            {availableSubcategories.length > 0 && (
              <>
                <div className="text-xs text-gray-500 mt-3 mb-1 px-2">Subcategories</div>
                {availableSubcategories.map((sub) => (
                  <label key={sub} className="flex items-center gap-3 text-sm cursor-pointer hover:bg-gray-50 active:bg-gray-100 px-2 py-2 rounded-lg pl-5">
                    <Checkbox
                      checked={filters.subcategories?.includes(sub) ?? false}
                      onChange={() => handleArrayToggle('subcategories', sub)}
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
        {openSections.has('class') && (
          <div className="mt-2 flex flex-wrap gap-2">
            {availableBuildingClasses.map((cls) => (
              <button
                key={cls}
                onClick={() => handleArrayToggle('buildingClasses', cls)}
                className={`px-4 py-2 text-sm rounded-full border transition-colors ${
                  filters.buildingClasses?.includes(cls)
                    ? 'bg-green-100 border-green-500 text-green-700'
                    : 'bg-white border-gray-300 text-gray-600 active:bg-gray-100'
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
            onClear={() => handleClearArray('acTypes', 'heatingTypes')}
          />
          {openSections.has('hvac') && (
            <div className="mt-2 space-y-3">
              {availableAcTypes.length > 0 && (
                <div>
                  <label className="block text-xs text-gray-600 mb-1.5">AC Type</label>
                  <div className="flex flex-wrap gap-2">
                    {availableAcTypes.slice(0, 6).map((type) => (
                      <button
                        key={type}
                        onClick={() => handleArrayToggle('acTypes', type)}
                        className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                          filters.acTypes?.includes(type)
                            ? 'bg-blue-100 border-blue-400 text-blue-700'
                            : 'bg-white border-gray-300 text-gray-600 active:bg-gray-100'
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
                  <label className="block text-xs text-gray-600 mb-1.5">Heating Type</label>
                  <div className="flex flex-wrap gap-2">
                    {availableHeatingTypes.slice(0, 6).map((type) => (
                      <button
                        key={type}
                        onClick={() => handleArrayToggle('heatingTypes', type)}
                        className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                          filters.heatingTypes?.includes(type)
                            ? 'bg-orange-100 border-orange-400 text-orange-700'
                            : 'bg-white border-gray-300 text-gray-600 active:bg-gray-100'
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

      {/* Research Status */}
      <div className="border-b border-gray-100 pb-2">
        <SectionHeader 
          id="research" 
          title="Research Status" 
          count={filters.enrichmentStatus !== 'all' ? 1 : 0}
          onClear={() => onFiltersChange({ ...filters, enrichmentStatus: 'all' })}
        />
        {openSections.has('research') && (
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              onClick={() => onFiltersChange({ ...filters, enrichmentStatus: 'all' })}
              className={`px-4 py-2 text-sm rounded-full border transition-colors ${
                filters.enrichmentStatus === 'all'
                  ? 'bg-green-100 border-green-500 text-green-700'
                  : 'bg-white border-gray-300 text-gray-600 active:bg-gray-100'
              }`}
              data-testid="button-enrichment-all"
            >
              All
            </button>
            <button
              onClick={() => onFiltersChange({ ...filters, enrichmentStatus: 'researched' })}
              className={`px-4 py-2 text-sm rounded-full border transition-colors ${
                filters.enrichmentStatus === 'researched'
                  ? 'bg-green-100 border-green-500 text-green-700'
                  : 'bg-white border-gray-300 text-gray-600 active:bg-gray-100'
              }`}
              data-testid="button-enrichment-researched"
            >
              Researched
            </button>
            <button
              onClick={() => onFiltersChange({ ...filters, enrichmentStatus: 'not_researched' })}
              className={`px-4 py-2 text-sm rounded-full border transition-colors ${
                filters.enrichmentStatus === 'not_researched'
                  ? 'bg-green-100 border-green-500 text-green-700'
                  : 'bg-white border-gray-300 text-gray-600 active:bg-gray-100'
              }`}
              data-testid="button-enrichment-not-researched"
            >
              Not Researched
            </button>
          </div>
        )}
      </div>

    </div>
  );

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg transition-all ${
          activeFilterCount > 0
            ? 'bg-green-100 text-green-700 border border-green-200 shadow-sm'
            : 'bg-white text-gray-600 border border-gray-200 shadow-sm hover:text-gray-700 hover:border-gray-300'
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
            <div className="relative w-full max-h-[90vh] bg-white rounded-t-2xl overflow-hidden flex flex-col">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-4 border-b border-gray-200 bg-white">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-gray-900">Filters</h2>
                  {activeFilterCount > 0 && (
                    <span className="inline-flex items-center justify-center min-w-[20px] px-1.5 py-0.5 text-xs font-medium bg-green-600 text-white rounded-full">
                      {activeFilterCount}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-2 -mr-2 rounded-full active:bg-gray-100"
                  data-testid="button-close-filters-mobile"
                >
                  <svg className="w-6 h-6 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              {/* Content */}
              <div className="flex-1 overflow-y-auto overscroll-contain">
                {filterContent}
              </div>
              {/* Sticky Footer */}
              <div className="flex items-center gap-3 px-4 py-4 border-t border-gray-200 bg-white">
                <button
                  onClick={() => {
                    handleClearFilters();
                  }}
                  disabled={activeFilterCount === 0}
                  className="flex-1 px-4 py-3 text-sm font-medium border border-gray-300 rounded-lg text-gray-700 disabled:opacity-50 disabled:text-gray-400 active:bg-gray-100"
                  data-testid="button-clear-filters-mobile"
                >
                  Clear All
                </button>
                <button
                  onClick={() => setIsOpen(false)}
                  className="flex-1 px-4 py-3 text-sm font-medium bg-green-600 text-white rounded-lg active:bg-green-700"
                  data-testid="button-apply-filters-mobile"
                >
                  Show Results
                </button>
              </div>
            </div>
          </div>

          {/* Desktop: Dropdown */}
          <div className="hidden md:block absolute top-full left-0 mt-2 w-80 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-[70vh] overflow-y-auto">
            <div>
              {filterContent}
            </div>
            {/* Desktop Footer - sticky at bottom */}
            <div className="sticky bottom-0 border-t border-gray-200 bg-white px-4 py-3 flex gap-2 flex-shrink-0">
              <button
                onClick={() => setIsOpen(false)}
                className="flex-1 px-4 py-2.5 text-sm font-medium bg-green-600 text-white rounded-lg active:bg-green-700"
                data-testid="button-apply-filters-desktop"
              >
                Apply Filters
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
