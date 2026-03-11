'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { AdminOnly } from '@/components/PermissionGate';
import { useEnrichment } from '@/hooks/use-enrichment';
import { useEnrichmentQueue } from '@/contexts/EnrichmentQueueContext';
import { Loader2, XCircle, MoreVertical, FileJson, Users, Building2, Phone, Mail, Globe, Calendar, Briefcase, ListPlus } from 'lucide-react';
import { SiLinkedin, SiFacebook, SiCrunchbase, SiInstagram, SiYoutube, SiGithub, SiPinterest, SiReddit, SiTelegram, SiSnapchat } from 'react-icons/si';
import GreenfinchAgentIcon from '@/components/icons/GreenfinchAgentIcon';
import { EmailStatusIcon, PhoneStatusIcon, LinkedInStatusIcon, hasAnyPhone, hasOnlyOfficeLine } from '@/components/ContactStatusIcons';
import linkedinLogo from '@/assets/linkedin-logo.png';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { ROLE_LABELS, ROLE_COLORS, formatRoleLabel } from '@/lib/constants';
import { capitalizeSentences } from '@/lib/normalization';
import { decode } from 'blurhash';
import BulkAddToListModal from '@/components/BulkAddToListModal';
import SetParentOrgModal from '@/components/SetParentOrgModal';

// Helper to title-case ALL CAPS names for better display
function formatPropertyName(name: string | null): string | null {
  if (!name) return null;
  // If the name is mostly uppercase (>80%), convert to title case
  const upperCount = (name.match(/[A-Z]/g) || []).length;
  const letterCount = (name.match(/[a-zA-Z]/g) || []).length;
  if (letterCount > 0 && upperCount / letterCount > 0.8) {
    return name.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }
  return name;
}

interface PropertyRelation {
  id: string;
  propertyKey: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  commonName: string | null;
  assetCategory: string | null;
  assetSubcategory: string | null;
  role: string | null;
}

interface ContactRelation {
  id: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  phoneLabel: string | null;
  aiPhone: string | null;
  aiPhoneLabel: string | null;
  enrichmentPhoneWork: string | null;
  enrichmentPhonePersonal: string | null;
  title: string | null;
  emailStatus: string | null;
  emailValidationStatus: string | null;
  linkedinUrl: string | null;
  isCurrent: boolean | null;
  contactTitle: string | null;
}

interface Organization {
  id: string;
  name: string | null;
  legalName: string | null;
  domain: string | null;
  orgType: string | null;
  description: string | null;
  foundedYear: number | null;
  
  // Industry classification
  sector: string | null;
  industryGroup: string | null;
  industry: string | null;
  subIndustry: string | null;
  
  // Company size
  employees: number | null;
  employeesRange: string | null;
  estimatedAnnualRevenue: string | null;
  
  // Location
  location: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  
  // Social profiles
  linkedinHandle: string | null;
  twitterHandle: string | null;
  facebookHandle: string | null;
  crunchbaseHandle: string | null;
  
  // Logo
  logoUrl: string | null;
  
  // Contact info
  phoneNumbers: string[] | null;
  emailAddresses: string[] | null;
  tags: string[] | null;
  
  // Parent companies
  parentDomain: string | null;
  parentOrgId: string | null;
  ultimateParentDomain: string | null;
  ultimateParentOrgId: string | null;
  
  // Enrichment status
  enrichmentStatus: string | null;
  enrichmentSource: string | null;
  lastEnrichedAt: string | null;
  providerId: string | null;
  
  createdAt: string;
  updatedAt: string;
}

const ORG_TYPE_COLORS: Record<string, string> = {
  owner: 'bg-purple-100 text-purple-700',
  management: 'bg-blue-100 text-blue-700',
  tenant: 'bg-green-100 text-green-700',
  developer: 'bg-orange-100 text-orange-700',
  other: 'bg-gray-100 text-gray-700',
};

const COMPANY_TYPE_LABELS: Record<string, string> = {
  'private': 'Private',
  'public': 'Public',
  'nonprofit': 'Nonprofit',
  'government': 'Government',
  'personal': 'Personal',
  'education': 'Education',
};

interface BrandData {
  name: string | null;
  domain: string;
  logo: string | null;
  blurhash: string | null;
  colors: Array<{ r: number; g: number; b: number; hex: string }>;
  socials: Record<string, string>;
}

const SOCIAL_ICON_MAP: Record<string, { icon: typeof SiLinkedin; label: string }> = {
  linkedin: { icon: SiLinkedin, label: 'LinkedIn' },
  twitter: { icon: (props: any) => (
    <svg {...props} fill="currentColor" viewBox="0 0 24 24">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
    </svg>
  ) as any, label: 'X (Twitter)' },
  facebook: { icon: SiFacebook, label: 'Facebook' },
  instagram: { icon: SiInstagram, label: 'Instagram' },
  youtube: { icon: SiYoutube, label: 'YouTube' },
  github: { icon: SiGithub, label: 'GitHub' },
  pinterest: { icon: SiPinterest, label: 'Pinterest' },
  reddit: { icon: SiReddit, label: 'Reddit' },
  telegram: { icon: SiTelegram, label: 'Telegram' },
  snapchat: { icon: SiSnapchat, label: 'Snapchat' },
  crunchbase: { icon: SiCrunchbase, label: 'Crunchbase' },
};

function BlurhashImage({ 
  blurhash, 
  src, 
  alt, 
  className,
  width = 64,
  height = 64,
}: { 
  blurhash: string | null; 
  src: string; 
  alt: string; 
  className?: string;
  width?: number;
  height?: number;
}) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!blurhash || loaded || !canvasRef.current) return;
    try {
      const pixels = decode(blurhash, 32, 32);
      const ctx = canvasRef.current.getContext('2d');
      if (!ctx) return;
      const imageData = ctx.createImageData(32, 32);
      imageData.data.set(pixels);
      ctx.putImageData(imageData, 0, 0);
    } catch (e) {
      console.warn('[BlurhashImage] Failed to decode blurhash:', e);
    }
  }, [blurhash, loaded]);

  if (error) return null;

  return (
    <div className={`relative overflow-hidden ${className || ''}`} style={{ width, height }}>
      {blurhash && !loaded && (
        <canvas
          ref={canvasRef}
          width={32}
          height={32}
          className="absolute inset-0 w-full h-full rounded-lg"
          style={{ imageRendering: 'auto' }}
        />
      )}
      <img
        src={src}
        alt={alt}
        className={`w-full h-full object-contain rounded-lg transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
        data-testid="img-org-brand-logo"
      />
    </div>
  );
}

function BrandColorBar({ colors }: { colors: Array<{ hex: string }> }) {
  if (!colors.length) return null;
  return (
    <div className="flex h-1.5 rounded-full overflow-hidden" data-testid="brand-color-bar">
      {colors.slice(0, 5).map((color, i) => (
        <div
          key={i}
          className="flex-1"
          style={{ backgroundColor: color.hex }}
        />
      ))}
    </div>
  );
}

function getEmailStatusColor(status: string | null): string {
  switch (status?.toLowerCase()) {
    case 'valid':
      return 'bg-green-100 text-green-700';
    case 'invalid':
      return 'bg-red-100 text-red-700';
    case 'pending':
    case 'unverified':
      return 'bg-yellow-100 text-yellow-700';
    default:
      return 'bg-gray-100 text-gray-600';
  }
}

interface ConsolidatedProperty extends PropertyRelation {
  allRoles: string[];
}

function consolidatePropertiesForDisplay(propsToConsolidate: PropertyRelation[]): ConsolidatedProperty[] {
  const grouped = new Map<string, { property: PropertyRelation; roles: Set<string> }>();
  
  propsToConsolidate.forEach((property) => {
    const key = property.propertyKey || property.id;
    
    if (!grouped.has(key)) {
      grouped.set(key, {
        property,
        roles: new Set(),
      });
    }
    
    if (property.role) {
      property.role.split(',').forEach((role) => {
        grouped.get(key)!.roles.add(role.trim());
      });
    }
  });
  
  return Array.from(grouped.values()).map((entry) => ({
    ...entry.property,
    allRoles: Array.from(entry.roles),
  }));
}

function ExpandableOrgDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (ref.current) {
      setClamped(ref.current.scrollHeight > ref.current.clientHeight + 2);
    }
  }, [text]);

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
      <p
        ref={ref}
        className={`text-gray-700 text-sm leading-relaxed ${expanded ? '' : 'line-clamp-3'}`}
        data-testid="text-org-description"
      >
        {text}
      </p>
      {clamped && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-green-600 hover:underline mt-1"
          data-testid="button-toggle-description"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

export default function OrganizationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const orgId = params?.id as string;

  const [organization, setOrganization] = useState<Organization | null>(null);
  const [properties, setProperties] = useState<PropertyRelation[]>([]);
  const [contacts, setContacts] = useState<ContactRelation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enrichMessage, setEnrichMessage] = useState<string | null>(null);
  const [brandData, setBrandData] = useState<BrandData | null>(null);
  const [brandLoading, setBrandLoading] = useState(false);
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());
  const [showBulkAddToList, setShowBulkAddToList] = useState(false);
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<Set<string>>(new Set());
  const [showBulkAddPropertiesToList, setShowBulkAddPropertiesToList] = useState(false);
  const [childOrgs, setChildOrgs] = useState<Array<{ id: string; name: string | null; domain: string | null; industry: string | null; employees: number | null; logoUrl: string | null }>>([]);
  const [parentOrg, setParentOrg] = useState<{ id: string; name: string | null; domain: string | null; logoUrl: string | null } | null>(null);
  const [ultimateParentOrg, setUltimateParentOrg] = useState<{ id: string; name: string | null; domain: string | null; logoUrl: string | null } | null>(null);
  const [showSetParentModal, setShowSetParentModal] = useState(false);
  const [portfolioData, setPortfolioData] = useState<{ totalOrgs: number; totalProperties: number; properties: any[] } | null>(null);
  const [portfolioLoading, setPortfolioLoading] = useState(false);
  const enrichTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { startEnrichment } = useEnrichment();
  const { getEnrichmentStatus } = useEnrichmentQueue();

  useEffect(() => {
    return () => {
      if (enrichTimerRef.current) clearTimeout(enrichTimerRef.current);
    };
  }, []);

  const handleEnrichOrganization = async () => {
    if (!organization) return;
    
    setEnrichMessage('greenfinch.ai is researching - check the queue for progress');
    
    startEnrichment({
      type: 'organization',
      entityId: orgId as string,
      entityName: organization.name || organization.domain || 'Unknown Organization',
      apiEndpoint: `/api/organizations/${orgId}/enrich`,
      onSuccess: (data: unknown) => {
        const result = data as { organization: Organization };
        if (result.organization) {
          setOrganization(result.organization);
          setEnrichMessage('Research complete');
          if (enrichTimerRef.current) clearTimeout(enrichTimerRef.current);
          enrichTimerRef.current = setTimeout(() => setEnrichMessage(null), 5000);
        } else {
          setEnrichMessage(null);
        }
      },
      onError: () => {
        setEnrichMessage(null);
      },
    });
  };

  useEffect(() => {
    if (!orgId) return;

    const fetchOrganization = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/organizations/${orgId}`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to fetch organization');
        }

        setOrganization(data.organization);
        setProperties(data.properties || []);
        setContacts(data.contacts || []);
        setChildOrgs(data.childOrgs || []);
        setParentOrg(data.parentOrg || null);
        setUltimateParentOrg(data.ultimateParentOrg || null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setIsLoading(false);
      }
    };

    fetchOrganization();
  }, [orgId]);

  useEffect(() => {
    if (!organization?.domain) return;
    setBrandLoading(true);
    const fetchBrandData = async () => {
      try {
        const res = await fetch(`/api/brand/${encodeURIComponent(organization.domain!)}`);
        if (res.ok) {
          const data = await res.json();
          setBrandData(data);
        }
      } catch (e) {
        console.warn('[Brand] Failed to fetch brand data:', e);
      } finally {
        setBrandLoading(false);
      }
    };
    fetchBrandData();
  }, [organization?.domain]);

  const socialLinks = useMemo(() => {
    if (!organization) return [];
    const links: Array<{ platform: string; url: string }> = [];
    if (organization.twitterHandle) {
      links.push({ platform: 'twitter', url: `https://x.com/${organization.twitterHandle}` });
    }
    if (organization.facebookHandle) {
      links.push({ platform: 'facebook', url: `https://facebook.com/${organization.facebookHandle}` });
    }
    if (organization.crunchbaseHandle) {
      links.push({ platform: 'crunchbase', url: `https://www.crunchbase.com/organization/${organization.crunchbaseHandle}` });
    }
    return links;
  }, [organization]);

  const logoSrc = organization ? (brandData?.logo || organization.logoUrl) : null;
  const brandColors = brandData?.colors || [];
  const primaryBrandColor = brandColors.length > 0 ? brandColors[0].hex : null;
  const industryDisplay = organization ? [organization.industry, organization.subIndustry].filter(Boolean).join(' - ') : '';
  const companyTypeLabel = organization?.orgType ? (COMPANY_TYPE_LABELS[organization.orgType.toLowerCase()] || organization.orgType) : null;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <main className="w-full px-4 sm:px-6 py-6 sm:py-8">
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-green-600"></div>
          </div>
        </main>
      </div>
    );
  }

  if (error || !organization) {
    return (
      <div className="min-h-screen bg-gray-50">
        <main className="w-full px-4 sm:px-6 py-6 sm:py-8">
          <div className="text-center py-16">
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              {error || 'Organization not found'}
            </h2>
            <button
              onClick={() => router.back()}
              className="text-green-600 hover:text-green-700"
            >
              Go back
            </button>
          </div>
        </main>
      </div>
    );
  }

  const handleExportOrganizationData = () => {
    // Prepare organization data for export
    const exportData = {
      organization: {
        id: organization.id,
        name: organization.name,
        legalName: organization.legalName,
        domain: organization.domain,
        orgType: organization.orgType,
        description: organization.description,
        sector: organization.sector,
        industry: organization.industry,
        subIndustry: organization.subIndustry,
        employees: organization.employees,
        employeesRange: organization.employeesRange,
        location: organization.location,
        city: organization.city,
        state: organization.state,
        country: organization.country,
        linkedinHandle: organization.linkedinHandle,
        twitterHandle: organization.twitterHandle,
        logoUrl: organization.logoUrl,
      },
      properties: properties,
      contacts: contacts,
    };

    // Create and trigger download
    const element = document.createElement('a');
    element.setAttribute('href', 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(exportData, null, 2)));
    element.setAttribute('download', `${organization.name || 'organization'}-export.json`);
    element.style.display = 'none';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="w-full px-4 sm:px-6 py-6 sm:py-8">
        <div className="mb-6">
          <button
            onClick={() => router.back()}
            className="flex items-center text-gray-600 hover:text-gray-900 mb-4"
            data-testid="button-back"
          >
            <svg className="w-5 h-5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </button>

          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            {brandColors.length > 0 && (
              <BrandColorBar colors={brandColors} />
            )}
            <div className="p-5">
              <div className="flex items-start gap-4">
                {logoSrc ? (
                  <BlurhashImage
                    blurhash={brandData?.blurhash || null}
                    src={logoSrc}
                    alt={`${organization.name} logo`}
                    className="flex-shrink-0 rounded-lg bg-white border border-gray-100 p-1"
                    width={64}
                    height={64}
                  />
                ) : brandLoading ? (
                  <div className="w-16 h-16 flex-shrink-0 rounded-lg bg-gray-100 border border-gray-200 animate-pulse" />
                ) : !organization.domain ? (
                  <div className="w-16 h-16 flex-shrink-0 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center">
                    <Building2 className="w-7 h-7 text-gray-400" />
                  </div>
                ) : null}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h1 className="text-2xl font-bold text-gray-900" data-testid="text-org-name">
                        {organization.name || 'Unnamed Organization'}
                      </h1>
                      {organization.legalName && organization.legalName !== organization.name && (
                        <p className="text-sm text-gray-500">{organization.legalName}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    {companyTypeLabel && (
                      <span 
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${primaryBrandColor ? '' : 'bg-blue-50 text-blue-700'}`}
                        style={primaryBrandColor ? { 
                          backgroundColor: `${primaryBrandColor}15`, 
                          color: primaryBrandColor 
                        } : undefined}
                        data-testid="badge-org-type"
                      >
                        <Briefcase className="w-3 h-3" />
                        {companyTypeLabel}
                      </span>
                    )}
                    {organization.foundedYear && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600" data-testid="badge-founded-year">
                        <Calendar className="w-3 h-3" />
                        Founded {organization.foundedYear}
                      </span>
                    )}
                    {organization.domain && (
                      <a
                        href={`https://${organization.domain}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-green-600 hover:text-green-700 hover:underline text-sm"
                        data-testid="link-org-domain"
                      >
                        <Globe className="w-3.5 h-3.5" />
                        {organization.domain}
                      </a>
                    )}
                    {organization.linkedinHandle && (
                      <a
                        href={`https://www.linkedin.com/company/${organization.linkedinHandle}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[#0A66C2] hover:underline text-sm"
                        data-testid="link-org-linkedin"
                      >
                        <SiLinkedin className="w-3.5 h-3.5" />
                        LinkedIn
                      </a>
                    )}
                  </div>

                  {socialLinks.length > 0 && (
                    <div className="flex items-center gap-1 mt-3" data-testid="social-links">
                      {socialLinks.map(({ platform, url }) => {
                        const socialConfig = SOCIAL_ICON_MAP[platform];
                        if (!socialConfig) return null;
                        const IconComp = socialConfig.icon;
                        return (
                          <a
                            key={platform}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-2 rounded-md text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors"
                            title={socialConfig.label}
                            data-testid={`link-social-${platform}`}
                          >
                            <IconComp className="w-5 h-5" />
                          </a>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {organization.description && (
          <ExpandableOrgDescription text={capitalizeSentences(organization.description)} />
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {industryDisplay && (
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Industry</p>
              <p className="text-sm font-medium text-gray-900" data-testid="text-org-industry">{industryDisplay}</p>
              {organization.sector && (
                <p className="text-xs text-gray-500 mt-1">Sector: {organization.sector}</p>
              )}
            </div>
          )}
          
          {(organization.employees || organization.employeesRange) && (
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Company Size</p>
              <p className="text-sm font-medium text-gray-900" data-testid="text-org-employees">
                {organization.employees?.toLocaleString() || organization.employeesRange} employees
              </p>
              {organization.estimatedAnnualRevenue && (
                <p className="text-xs text-gray-500 mt-1">Revenue: {organization.estimatedAnnualRevenue}</p>
              )}
            </div>
          )}
          
          {organization.location && (
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Location</p>
              <p className="text-sm font-medium text-gray-900" data-testid="text-org-location">{organization.location}</p>
            </div>
          )}
        </div>

        {(organization.phoneNumbers?.length || organization.emailAddresses?.length) ? (
          <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">Company Contact</p>
            <div className="flex flex-wrap gap-4">
              {organization.phoneNumbers?.map((phone, i) => (
                <a
                  key={i}
                  href={`tel:${phone}`}
                  className="inline-flex items-center gap-1.5 text-sm text-gray-700 hover:text-gray-900"
                  data-testid={`link-org-phone-${i}`}
                >
                  <Phone className="w-4 h-4 text-gray-400" />
                  {phone}
                </a>
              ))}
              {organization.emailAddresses?.map((email, i) => (
                <a
                  key={i}
                  href={`mailto:${email}`}
                  className="inline-flex items-center gap-1.5 text-sm text-gray-700 hover:text-gray-900"
                  data-testid={`link-org-email-${i}`}
                >
                  <Mail className="w-4 h-4 text-gray-400" />
                  {email}
                </a>
              ))}
            </div>
          </div>
        ) : null}

        {organization.tags?.length ? (
          <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">Tags</p>
            <div className="flex flex-wrap gap-1.5">
              {organization.tags.map((tag) => (
                <span key={tag} className="inline-block px-2 py-0.5 text-xs rounded bg-gray-100 text-gray-600">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {(parentOrg || ultimateParentOrg || childOrgs.length > 0 || organization.parentDomain || organization.ultimateParentDomain) && (
          <div className="bg-white rounded-lg border border-gray-200 p-4 mb-6">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Organization Hierarchy</p>
              <AdminOnly>
                <button
                  onClick={() => setShowSetParentModal(true)}
                  className="text-xs text-green-600 hover:text-green-700 font-medium"
                >
                  Set Parent Organization
                </button>
              </AdminOnly>
            </div>

            {/* Parent chain */}
            {(parentOrg || organization.parentDomain) && (
              <div className="mb-3">
                <p className="text-xs text-gray-500 mb-1">Parent Company</p>
                <div className="flex items-center gap-2">
                  {parentOrg?.logoUrl && (
                    <img src={parentOrg.logoUrl} alt="" className="w-5 h-5 rounded object-contain" />
                  )}
                  {parentOrg ? (
                    <Link
                      href={`/organization/${parentOrg.id}`}
                      className="text-sm text-green-600 hover:text-green-700 hover:underline font-medium"
                      data-testid="link-parent-org"
                    >
                      {parentOrg.name || parentOrg.domain || organization.parentDomain}
                    </Link>
                  ) : organization.parentDomain ? (
                    <a
                      href={`https://${organization.parentDomain}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-green-600 hover:text-green-700 hover:underline"
                    >
                      {organization.parentDomain}
                    </a>
                  ) : null}
                </div>
              </div>
            )}

            {/* Ultimate parent */}
            {(ultimateParentOrg || (organization.ultimateParentDomain && organization.ultimateParentDomain !== organization.parentDomain)) && (
              <div className="mb-3">
                <p className="text-xs text-gray-500 mb-1">Ultimate Parent</p>
                <div className="flex items-center gap-2">
                  {ultimateParentOrg?.logoUrl && (
                    <img src={ultimateParentOrg.logoUrl} alt="" className="w-5 h-5 rounded object-contain" />
                  )}
                  {ultimateParentOrg ? (
                    <Link
                      href={`/organization/${ultimateParentOrg.id}`}
                      className="text-sm text-green-600 hover:text-green-700 hover:underline font-medium"
                      data-testid="link-ultimate-parent-org"
                    >
                      {ultimateParentOrg.name || ultimateParentOrg.domain || organization.ultimateParentDomain}
                    </Link>
                  ) : organization.ultimateParentDomain ? (
                    <a
                      href={`https://${organization.ultimateParentDomain}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-green-600 hover:text-green-700 hover:underline"
                    >
                      {organization.ultimateParentDomain}
                    </a>
                  ) : null}
                </div>
              </div>
            )}

            {/* Subsidiaries */}
            {childOrgs.length > 0 && (
              <div>
                <p className="text-xs text-gray-500 mb-2">Subsidiaries ({childOrgs.length})</p>
                <div className="space-y-1.5">
                  {childOrgs.map(child => (
                    <div key={child.id} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {child.logoUrl && (
                          <img src={child.logoUrl} alt="" className="w-4 h-4 rounded object-contain" />
                        )}
                        <Link
                          href={`/organization/${child.id}`}
                          className="text-sm text-green-600 hover:text-green-700 hover:underline"
                        >
                          {child.name || child.domain}
                        </Link>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-gray-400">
                        {child.industry && <span>{child.industry}</span>}
                        {child.employees && <span>{child.employees.toLocaleString()} emp.</span>}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Portfolio view button */}
                <button
                  onClick={async () => {
                    if (portfolioData) {
                      setPortfolioData(null);
                      return;
                    }
                    setPortfolioLoading(true);
                    try {
                      const res = await fetch(`/api/organizations/${orgId}/portfolio`);
                      if (res.ok) {
                        setPortfolioData(await res.json());
                      }
                    } catch (e) {
                      console.error('Failed to fetch portfolio:', e);
                    } finally {
                      setPortfolioLoading(false);
                    }
                  }}
                  className="mt-3 text-xs text-green-600 hover:text-green-700 font-medium"
                >
                  {portfolioLoading ? 'Loading...' : portfolioData ? 'Hide portfolio' : 'View full portfolio'}
                </button>

                {portfolioData && (
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    <p className="text-xs text-gray-500 mb-2">
                      Portfolio: {portfolioData.totalProperties} properties across {portfolioData.totalOrgs} organizations
                    </p>
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {portfolioData.properties.map((p: any) => (
                        <div key={p.id} className="flex items-center justify-between text-xs">
                          <Link
                            href={`/property/${p.propertyKey || p.id}`}
                            className="text-green-600 hover:underline truncate max-w-[60%]"
                          >
                            {p.commonName || p.address || 'Unknown'}
                          </Link>
                          <span className="text-gray-400 truncate max-w-[35%]">
                            {p.orgs?.map((o: any) => o.name).filter(Boolean).join(', ')}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Admin-only: Set Parent when no hierarchy exists yet */}
        {!parentOrg && !organization.parentDomain && childOrgs.length === 0 && (
          <AdminOnly>
            <div className="mb-6">
              <button
                onClick={() => setShowSetParentModal(true)}
                className="text-xs text-gray-400 hover:text-green-600 font-medium"
              >
                + Set Parent Organization
              </button>
            </div>
          </AdminOnly>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div id="properties-section" className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-semibold text-gray-900">
                    Properties ({properties.length})
                  </h2>
                  {properties.length > 0 && (
                    <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer" data-testid="checkbox-select-all-properties">
                      <input
                        type="checkbox"
                        className="rounded border-gray-300 text-green-600 focus:ring-green-500"
                        checked={properties.length > 0 && selectedPropertyIds.size === consolidatePropertiesForDisplay(properties).length}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedPropertyIds(new Set(consolidatePropertiesForDisplay(properties).map(p => p.propertyKey || p.id)));
                          } else {
                            setSelectedPropertyIds(new Set());
                          }
                        }}
                      />
                      Select all
                    </label>
                  )}
                </div>
                {selectedPropertyIds.size > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowBulkAddPropertiesToList(true)}
                    data-testid="button-bulk-add-properties-to-list"
                  >
                    <ListPlus className="w-4 h-4 mr-1.5" />
                    Add {selectedPropertyIds.size} to List
                  </Button>
                )}
              </div>
            </div>
            <div className="divide-y divide-gray-200 max-h-[500px] overflow-y-auto">
              {properties.length === 0 ? (
                <div className="px-6 py-8 text-center text-gray-500">
                  No properties associated with this organization
                </div>
              ) : (
                consolidatePropertiesForDisplay(properties).map((property) => {
                  const propertyId = property.propertyKey || property.id;
                  return (
                    <div
                      key={propertyId}
                      className="flex items-center px-6 py-4 hover:bg-gray-50 gap-3"
                      data-testid={`row-property-${propertyId}`}
                    >
                      <input
                        type="checkbox"
                        className="rounded border-gray-300 text-green-600 focus:ring-green-500 flex-shrink-0"
                        checked={selectedPropertyIds.has(propertyId)}
                        onChange={(e) => {
                          const next = new Set(selectedPropertyIds);
                          if (e.target.checked) {
                            next.add(propertyId);
                          } else {
                            next.delete(propertyId);
                          }
                          setSelectedPropertyIds(next);
                        }}
                        data-testid={`checkbox-property-${propertyId}`}
                      />
                      <Link
                        href={`/property/${propertyId}`}
                        className="flex-1 min-w-0"
                        data-testid={`link-property-${propertyId}`}
                        aria-label={`View property ${property.commonName || property.address || 'details'}`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            {property.commonName && (
                              <p className="text-sm font-medium text-gray-900 truncate">
                                {formatPropertyName(property.commonName)}
                              </p>
                            )}
                            <p className="text-sm text-gray-600 truncate">
                              {property.address || 'No address'}
                            </p>
                            <p className="text-xs text-gray-400">
                              {[property.city, property.state, property.zip].filter(Boolean).join(', ')}
                            </p>
                          </div>
                          <div className="ml-4 flex flex-col items-end gap-2">
                            {property.allRoles && property.allRoles.length > 0 && (
                              <div className="flex flex-wrap justify-end gap-1">
                                {property.allRoles.map((role) => (
                                  <span
                                    key={role}
                                    className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${ROLE_COLORS[role] || ROLE_COLORS.other}`}
                                  >
                                    {formatRoleLabel(role)}
                                  </span>
                                ))}
                              </div>
                            )}
                            {property.assetCategory && (
                              <span className="text-xs text-gray-400">
                                {property.assetCategory}
                              </span>
                            )}
                          </div>
                        </div>
                      </Link>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div id="contacts-section" className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-semibold text-gray-900">
                    Contacts ({contacts.length})
                  </h2>
                  {contacts.length > 0 && (
                    <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer" data-testid="checkbox-select-all-contacts">
                      <input
                        type="checkbox"
                        className="rounded border-gray-300 text-green-600 focus:ring-green-500"
                        checked={contacts.length > 0 && selectedContactIds.size === contacts.length}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedContactIds(new Set(contacts.map(c => c.id)));
                          } else {
                            setSelectedContactIds(new Set());
                          }
                        }}
                      />
                      Select all
                    </label>
                  )}
                </div>
                {selectedContactIds.size > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowBulkAddToList(true)}
                    data-testid="button-bulk-add-contacts-to-list"
                  >
                    <ListPlus className="w-4 h-4 mr-1.5" />
                    Add {selectedContactIds.size} to List
                  </Button>
                )}
              </div>
            </div>
            <div className="divide-y divide-gray-200 max-h-[500px] overflow-y-auto">
              {contacts.length === 0 ? (
                <div className="px-6 py-8 text-center text-gray-500">
                  No contacts associated with this organization
                </div>
              ) : (
                contacts.map((contact) => (
                  <div
                    key={contact.id}
                    className="flex items-center px-6 py-4 hover:bg-gray-50 gap-3"
                    data-testid={`row-contact-${contact.id}`}
                  >
                    <input
                      type="checkbox"
                      className="rounded border-gray-300 text-green-600 focus:ring-green-500 flex-shrink-0"
                      checked={selectedContactIds.has(contact.id)}
                      onChange={(e) => {
                        const next = new Set(selectedContactIds);
                        if (e.target.checked) {
                          next.add(contact.id);
                        } else {
                          next.delete(contact.id);
                        }
                        setSelectedContactIds(next);
                      }}
                      data-testid={`checkbox-contact-${contact.id}`}
                    />
                    <Link
                      href={`/contact/${contact.id}`}
                      className="flex-1 min-w-0"
                      data-testid={`link-contact-${contact.id}`}
                      aria-label={`View contact ${contact.fullName || 'details'}`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {contact.fullName || 'Unnamed Contact'}
                          </p>
                          {contact.title && (
                            <p className="text-sm text-gray-600 truncate">
                              {contact.title}
                            </p>
                          )}
                          {contact.email && (
                            <p className="text-xs text-gray-400 truncate">
                              {contact.email}
                            </p>
                          )}
                        </div>
                        <div className="ml-4 flex items-center gap-1.5">
                          <EmailStatusIcon 
                            hasEmail={!!contact.email} 
                            status={contact.emailValidationStatus || contact.emailStatus}
                            size="sm"
                          />
                          <PhoneStatusIcon 
                            hasPhone={hasAnyPhone({
                              phone: contact.phone,
                              aiPhone: contact.aiPhone,
                              enrichmentPhoneWork: contact.enrichmentPhoneWork,
                              enrichmentPhonePersonal: contact.enrichmentPhonePersonal,
                            })}
                            isOfficeOnly={hasOnlyOfficeLine({
                              phone: contact.phone,
                              phoneLabel: contact.phoneLabel,
                              aiPhone: contact.aiPhone,
                              aiPhoneLabel: contact.aiPhoneLabel,
                              enrichmentPhoneWork: contact.enrichmentPhoneWork,
                              enrichmentPhonePersonal: contact.enrichmentPhonePersonal,
                            })}
                            size="sm"
                          />
                          <LinkedInStatusIcon 
                            hasLinkedIn={!!contact.linkedinUrl}
                            size="sm"
                          />
                        </div>
                      </div>
                    </Link>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

      </main>

      <BulkAddToListModal
        isOpen={showBulkAddToList}
        onClose={() => {
          setShowBulkAddToList(false);
          setSelectedContactIds(new Set());
        }}
        itemIds={Array.from(selectedContactIds)}
        itemType="contacts"
      />

      <BulkAddToListModal
        isOpen={showBulkAddPropertiesToList}
        onClose={() => {
          setShowBulkAddPropertiesToList(false);
          setSelectedPropertyIds(new Set());
        }}
        itemIds={Array.from(selectedPropertyIds)}
        itemType="properties"
      />

      <SetParentOrgModal
        isOpen={showSetParentModal}
        onClose={() => setShowSetParentModal(false)}
        orgId={orgId}
        currentParentOrgId={organization?.parentOrgId || null}
        onSuccess={(updatedOrg) => {
          setOrganization(updatedOrg);
          // Refetch hierarchy data
          fetch(`/api/organizations/${orgId}`)
            .then(res => res.json())
            .then(data => {
              setChildOrgs(data.childOrgs || []);
              setParentOrg(data.parentOrg || null);
              setUltimateParentOrg(data.ultimateParentOrg || null);
            })
            .catch(() => {});
          setShowSetParentModal(false);
        }}
      />
    </div>
  );
}
