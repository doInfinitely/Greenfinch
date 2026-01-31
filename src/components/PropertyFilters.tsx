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
  enrichmentStatus: 'all' | 'researched' | 'not_researched';
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
const DEFAULT_BUILDING_CLASSES = ['A+', 'A', 'B', 'C', 'D', UNKNOWN_BUILDING_CLASS];

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
  minLotSqft: null,
  maxLotSqft: null,
};

export { UNKNOWN_CATEGORY };

interface QuickFilterChipsProps {
  filters: FilterState;
  onFiltersChange: (filters: FilterState) => void;
}

export function QuickFilterChips({ filters, onFiltersChange }: QuickFilterChipsProps) {
  const activeChips: { label: string; key: string; onRemove: () => void }[] = [];
  
  if (filters.minLotAcres || filters.maxLotAcres) {
    const min = filters.minLotAcres ? `${filters.minLotAcres}` : '0';
    const max = filters.maxLotAcres ? `${filters.maxLotAcres}` : '+';
    activeChips.push({
      key: 'lot-size',
      label: `${min}-${max} acres`,
      onRemove: () => onFiltersChange({ ...filters, minLotAcres: null, maxLotAcres: null, minLotSqft: null, maxLotSqft: null }),
    });
  }
  
  if (filters.minNetSqft || filters.maxNetSqft) {
    const min = filters.minNetSqft ? `${(filters.minNetSqft / 1000).toFixed(0)}k` : '0';
    const max = filters.maxNetSqft ? `${(filters.maxNetSqft / 1000).toFixed(0)}k` : '+';
    activeChips.push({
      key: 'building-sqft',
      label: `${min}-${max} sqft`,
      onRemove: () => onFiltersChange({ ...filters, minNetSqft: null, maxNetSqft: null }),
    });
  }
  
  filters.categories?.forEach((cat) => {
    activeChips.push({
      key: `category-${cat}`,
      label: cat,
      onRemove: () => onFiltersChange({ ...filters, categories: filters.categories?.filter(c => c !== cat) || [] }),
    });
  });
  
  filters.subcategories?.forEach((sub) => {
    activeChips.push({
      key: `subcategory-${sub}`,
      label: sub,
      onRemove: () => onFiltersChange({ ...filters, subcategories: filters.subcategories?.filter(s => s !== sub) || [] }),
    });
  });
  
  filters.buildingClasses?.forEach((cls) => {
    activeChips.push({
      key: `class-${cls}`,
      label: `Class ${cls}`,
      onRemove: () => onFiltersChange({ ...filters, buildingClasses: filters.buildingClasses?.filter(c => c !== cls) || [] }),
    });
  });
  
  filters.acTypes?.forEach((type) => {
    activeChips.push({
      key: `ac-${type}`,
      label: `AC: ${type}`,
      onRemove: () => onFiltersChange({ ...filters, acTypes: filters.acTypes?.filter(t => t !== type) || [] }),
    });
  });
  
  filters.heatingTypes?.forEach((type) => {
    activeChips.push({
      key: `heating-${type}`,
      label: `Heat: ${type}`,
      onRemove: () => onFiltersChange({ ...filters, heatingTypes: filters.heatingTypes?.filter(t => t !== type) || [] }),
    });
  });
  
  if (filters.enrichmentStatus !== 'all') {
    activeChips.push({
      key: 'enrichment-status',
      label: filters.enrichmentStatus === 'researched' ? 'Researched' : 'Not Researched',
      onRemove: () => onFiltersChange({ ...filters, enrichmentStatus: 'all' }),
    });
  }
  
  if (activeChips.length === 0) return null;
  
  return (
    <div className="flex flex-wrap gap-2 py-2" data-testid="quick-filter-chips">
      {activeChips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex items-center gap-1 px-2.5 py-1 text-sm bg-primary/10 text-primary rounded-full border border-primary/30"
          data-testid={`chip-${chip.key}`}
        >
          {chip.label}
          <button
            onClick={chip.onRemove}
            className="ml-0.5 p-0.5 rounded-full active:bg-primary/20"
            data-testid={`chip-remove-${chip.key}`}
            aria-label={`Remove ${chip.label} filter`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </span>
      ))}
    </div>
  );
}

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
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(['size']));
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
    (filters.contactId ? 1 : 0) +
    (filters.enrichmentStatus !== 'all' ? 1 : 0);

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

  const getFilterSummary = () => {
    const parts: string[] = [];
    if (filters.minLotAcres || filters.maxLotAcres) {
      const min = filters.minLotAcres ? `${filters.minLotAcres}` : '0';
      const max = filters.maxLotAcres ? `${filters.maxLotAcres}` : '+';
      parts.push(`${min}-${max} ac`);
    }
    if (filters.categories && filters.categories.length > 0) {
      parts.push(filters.categories.length === 1 ? filters.categories[0] : `${filters.categories.length} categories`);
    }
    if (filters.buildingClasses && filters.buildingClasses.length > 0) {
      parts.push(`Class ${filters.buildingClasses.join(', ')}`);
    }
    return parts.slice(0, 2).join(' · ');
  };

  const SectionHeader = ({ id, title, count, onClear }: { id: string; title: string; count?: number; onClear?: () => void }) => (
    <div className="flex items-center justify-between min-h-[44px]">
      <button
        onClick={() => toggleSection(id)}
        className="flex-1 flex items-center justify-between text-sm font-medium text-foreground py-3"
        data-testid={`section-${id}`}
      >
        <span className="flex items-center gap-2">
          {title}
          {count !== undefined && count > 0 && (
            <span className="inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-medium bg-primary/10 text-primary rounded">
              {count}
            </span>
          )}
        </span>
        <svg
          className={`w-5 h-5 transition-transform ${openSections.has(id) ? 'rotate-180' : ''}`}
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
          className="ml-2 px-2 py-1 text-xs text-muted-foreground hover-elevate"
          data-testid={`button-clear-${id}`}
        >
          Clear
        </button>
      )}
    </div>
  );

  const filterContent = (isMobile: boolean = false) => (
    <div className="p-4 space-y-2 bg-background">
      {!isMobile && (
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium text-foreground">Filter Properties</h3>
          {activeFilterCount > 0 && (
            <button
              onClick={handleClearFilters}
              className="text-xs text-muted-foreground hover-elevate"
              data-testid="button-clear-filters"
            >
              Clear all
            </button>
          )}
        </div>
      )}

      {/* Organization Search - Top Level */}
      <div className="border-b border-border pb-3">
        <label className="block text-sm text-muted-foreground mb-2 font-medium">Organization</label>
        {selectedOrg ? (
          <div className="flex items-center justify-between bg-primary/10 border border-primary/30 px-3 py-3 min-h-[44px] rounded-lg text-base">
            <span className="text-primary truncate">{selectedOrg.name}</span>
            <button onClick={clearOrg} className="text-primary ml-2 flex-shrink-0 p-1 min-w-[32px] min-h-[32px] flex items-center justify-center" data-testid="button-clear-org">
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
              className="w-full px-3 py-3 min-h-[44px] border border-input rounded-lg text-base bg-background text-foreground placeholder:text-muted-foreground"
              data-testid="input-org-search"
            />
            {orgResults.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-card border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {orgResults.map((org) => (
                  <button
                    key={org.id}
                    onClick={() => selectOrg(org)}
                    className="w-full text-left px-3 py-3 min-h-[44px] text-base text-foreground active:bg-muted"
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
      <div className="border-b border-border pb-3">
        <label className="block text-sm text-muted-foreground mb-2 font-medium">Contact</label>
        {selectedContact ? (
          <div className="flex items-center justify-between bg-primary/10 border border-primary/30 px-3 py-3 min-h-[44px] rounded-lg text-base">
            <span className="text-primary truncate">{selectedContact.fullName}</span>
            <button onClick={clearContact} className="text-primary ml-2 flex-shrink-0 p-1 min-w-[32px] min-h-[32px] flex items-center justify-center" data-testid="button-clear-contact">
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
              className="w-full px-3 py-3 min-h-[44px] border border-input rounded-lg text-base bg-background text-foreground placeholder:text-muted-foreground"
              data-testid="input-contact-search"
            />
            {contactResults.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-card border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {contactResults.map((contact) => (
                  <button
                    key={contact.id}
                    onClick={() => selectContact(contact)}
                    className="w-full text-left px-3 py-3 min-h-[44px] text-base text-foreground active:bg-muted"
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
      <div className="border-b border-border pb-2">
        <SectionHeader id="size" title="Size" count={(filters.minLotAcres || filters.maxLotAcres ? 1 : 0) + (filters.minNetSqft || filters.maxNetSqft ? 1 : 0)} />
        {openSections.has('size') && (
          <div className="mt-2 space-y-4">
            <div>
              <label className="block text-sm text-muted-foreground mb-2">Lot Size (acres)</label>
              <div className="flex gap-3">
                <input
                  type="text"
                  inputMode="decimal"
                  value={localMinLotAcres}
                  onChange={(e) => handleAcresChange('minLotAcres', e.target.value, setLocalMinLotAcres)}
                  placeholder="Min"
                  className="w-full px-3 py-3 min-h-[44px] border border-input rounded-lg text-base bg-background text-foreground placeholder:text-muted-foreground"
                  data-testid="input-min-lot-acres"
                />
                <input
                  type="text"
                  inputMode="decimal"
                  value={localMaxLotAcres}
                  onChange={(e) => handleAcresChange('maxLotAcres', e.target.value, setLocalMaxLotAcres)}
                  placeholder="Max"
                  className="w-full px-3 py-3 min-h-[44px] border border-input rounded-lg text-base bg-background text-foreground placeholder:text-muted-foreground"
                  data-testid="input-max-lot-acres"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm text-muted-foreground mb-2">Net Building Sq Ft</label>
              <div className="flex gap-3">
                <input
                  type="text"
                  inputMode="numeric"
                  value={localMinNetSqft}
                  onChange={(e) => handleNumberChange('minNetSqft', e.target.value, setLocalMinNetSqft)}
                  placeholder="Min"
                  className="w-full px-3 py-3 min-h-[44px] border border-input rounded-lg text-base bg-background text-foreground placeholder:text-muted-foreground"
                  data-testid="input-min-net-sqft"
                />
                <input
                  type="text"
                  inputMode="numeric"
                  value={localMaxNetSqft}
                  onChange={(e) => handleNumberChange('maxNetSqft', e.target.value, setLocalMaxNetSqft)}
                  placeholder="Max"
                  className="w-full px-3 py-3 min-h-[44px] border border-input rounded-lg text-base bg-background text-foreground placeholder:text-muted-foreground"
                  data-testid="input-max-net-sqft"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Category & Subcategory */}
      <div className="border-b border-border pb-2">
        <SectionHeader 
          id="category" 
          title="Category" 
          count={(filters.categories?.length ?? 0) + (filters.subcategories?.length ?? 0)}
          onClear={() => { handleClearArray('categories'); handleClearArray('subcategories'); }}
        />
        {openSections.has('category') && (
          <div className="mt-2 space-y-1 max-h-60 overflow-y-auto">
            {availableCategories.map((cat) => (
              <label key={cat} className="flex items-center gap-3 text-base cursor-pointer px-2 py-2.5 min-h-[44px] rounded-lg active:bg-muted">
                <input
                  type="checkbox"
                  checked={filters.categories?.includes(cat) ?? false}
                  onChange={() => handleArrayToggle('categories', cat)}
                  className="w-5 h-5 text-primary rounded"
                  data-testid={`checkbox-category-${cat.toLowerCase().replace(/\s+/g, '-')}`}
                />
                <span className="text-foreground">{cat}</span>
              </label>
            ))}
            {availableSubcategories.length > 0 && (
              <>
                <div className="text-sm text-muted-foreground mt-3 mb-1 px-2">Subcategories</div>
                {availableSubcategories.map((sub) => (
                  <label key={sub} className="flex items-center gap-3 text-base cursor-pointer px-2 py-2.5 min-h-[44px] rounded-lg pl-6 active:bg-muted">
                    <input
                      type="checkbox"
                      checked={filters.subcategories?.includes(sub) ?? false}
                      onChange={() => handleArrayToggle('subcategories', sub)}
                      className="w-5 h-5 text-primary rounded"
                      data-testid={`checkbox-subcategory-${sub.toLowerCase().replace(/\s+/g, '-')}`}
                    />
                    <span className="text-muted-foreground">{sub}</span>
                  </label>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* Building Class */}
      <div className="border-b border-border pb-2">
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
                className={`px-4 py-2 min-h-[44px] text-base rounded-full border transition-colors ${
                  filters.buildingClasses?.includes(cls)
                    ? 'bg-primary/10 border-primary text-primary'
                    : 'bg-card border-border text-muted-foreground'
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
        <div className="border-b border-border pb-2">
          <SectionHeader 
            id="hvac" 
            title="HVAC" 
            count={(filters.acTypes?.length ?? 0) + (filters.heatingTypes?.length ?? 0)}
            onClear={() => { handleClearArray('acTypes'); handleClearArray('heatingTypes'); }}
          />
          {openSections.has('hvac') && (
            <div className="mt-2 space-y-4">
              {availableAcTypes.length > 0 && (
                <div>
                  <label className="block text-sm text-muted-foreground mb-2">AC Type</label>
                  <div className="flex flex-wrap gap-2">
                    {availableAcTypes.slice(0, 6).map((type) => (
                      <button
                        key={type}
                        onClick={() => handleArrayToggle('acTypes', type)}
                        className={`px-3 py-2 min-h-[40px] text-sm rounded-lg border transition-colors ${
                          filters.acTypes?.includes(type)
                            ? 'bg-blue-500/10 border-blue-500 text-blue-600 dark:text-blue-400'
                            : 'bg-card border-border text-muted-foreground'
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
                  <label className="block text-sm text-muted-foreground mb-2">Heating Type</label>
                  <div className="flex flex-wrap gap-2">
                    {availableHeatingTypes.slice(0, 6).map((type) => (
                      <button
                        key={type}
                        onClick={() => handleArrayToggle('heatingTypes', type)}
                        className={`px-3 py-2 min-h-[40px] text-sm rounded-lg border transition-colors ${
                          filters.heatingTypes?.includes(type)
                            ? 'bg-orange-500/10 border-orange-500 text-orange-600 dark:text-orange-400'
                            : 'bg-card border-border text-muted-foreground'
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
      <div className="border-b border-border pb-2">
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
              className={`px-4 py-2 min-h-[44px] text-base rounded-full border transition-colors ${
                filters.enrichmentStatus === 'all'
                  ? 'bg-primary/10 border-primary text-primary'
                  : 'bg-card border-border text-muted-foreground'
              }`}
              data-testid="button-enrichment-all"
            >
              All
            </button>
            <button
              onClick={() => onFiltersChange({ ...filters, enrichmentStatus: 'researched' })}
              className={`px-4 py-2 min-h-[44px] text-base rounded-full border transition-colors ${
                filters.enrichmentStatus === 'researched'
                  ? 'bg-primary/10 border-primary text-primary'
                  : 'bg-card border-border text-muted-foreground'
              }`}
              data-testid="button-enrichment-researched"
            >
              Researched
            </button>
            <button
              onClick={() => onFiltersChange({ ...filters, enrichmentStatus: 'not_researched' })}
              className={`px-4 py-2 min-h-[44px] text-base rounded-full border transition-colors ${
                filters.enrichmentStatus === 'not_researched'
                  ? 'bg-primary/10 border-primary text-primary'
                  : 'bg-card border-border text-muted-foreground'
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

  const filterSummary = getFilterSummary();
  
  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-3 min-h-[44px] border rounded-lg text-sm transition-colors ${
          activeFilterCount > 0
            ? 'border-primary bg-primary/10 text-primary'
            : 'border-border bg-card text-foreground'
        }`}
        data-testid="button-open-filters"
        aria-label="Open filters"
      >
        <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
        </svg>
        <span className="flex items-center gap-2">
          <span>Filters</span>
          {activeFilterCount > 0 && (
            <span className="inline-flex items-center justify-center w-5 h-5 text-xs font-medium bg-primary text-primary-foreground rounded-full">
              {activeFilterCount}
            </span>
          )}
        </span>
        {filterSummary && (
          <span className="hidden sm:inline text-xs text-muted-foreground truncate max-w-[150px]">
            {filterSummary}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          {/* Mobile: Full screen overlay with sticky header/footer */}
          <div 
            className="md:hidden fixed inset-0 z-50 flex flex-col"
            role="dialog"
            aria-modal="true"
          >
            <div 
              className="absolute inset-0 bg-black/50"
              onClick={() => setIsOpen(false)}
            />
            <div className="relative flex-1 flex flex-col mt-12 bg-background rounded-t-2xl overflow-hidden">
              {/* Sticky Header */}
              <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-4 border-b bg-background">
                <h2 className="font-semibold text-lg">Filters</h2>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-2 -mr-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg"
                  data-testid="button-close-filters-mobile"
                  aria-label="Close filters"
                >
                  <svg className="w-6 h-6 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              {/* Scrollable Content */}
              <div className="flex-1 overflow-y-auto overscroll-contain bg-background">
                {filterContent(true)}
              </div>
              
              {/* Sticky Footer */}
              <div className="sticky bottom-0 z-10 flex items-center gap-3 px-4 py-4 border-t border-border bg-background">
                <button
                  onClick={handleClearFilters}
                  className="flex-1 min-h-[44px] px-4 py-3 text-sm font-medium text-foreground bg-muted rounded-lg"
                  data-testid="button-clear-all-mobile"
                >
                  Clear All
                </button>
                <button
                  onClick={() => setIsOpen(false)}
                  className="flex-1 min-h-[44px] px-4 py-3 text-sm font-medium text-primary-foreground bg-primary rounded-lg"
                  data-testid="button-apply-filters-mobile"
                >
                  Show Results
                </button>
              </div>
            </div>
          </div>

          {/* Desktop: Dropdown */}
          <div className="hidden md:block absolute top-full left-0 mt-2 w-80 bg-card border border-border rounded-lg shadow-lg z-50 max-h-[70vh] overflow-y-auto">
            {filterContent(false)}
          </div>
        </>
      )}
    </div>
  );
}
