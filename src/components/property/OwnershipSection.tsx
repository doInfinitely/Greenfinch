'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Flag, Globe, Phone, Mail } from 'lucide-react';
import { SiLinkedin, SiX, SiFacebook } from 'react-icons/si';
import { ROLE_LABELS, ROLE_COLORS } from '@/lib/constants';
import { toTitleCase, capitalizeSentences } from '@/lib/normalization';
import type { Property, EnrichedPropertyData, Organization } from './types';

function ExpandableDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (ref.current) {
      setClamped(ref.current.scrollHeight > ref.current.clientHeight + 2);
    }
  }, [text]);

  return (
    <div className="mt-2">
      <p
        ref={ref}
        className={`text-sm text-gray-600 ${expanded ? '' : 'line-clamp-2'}`}
        data-testid="text-org-description"
      >
        {text}
      </p>
      {clamped && (
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          className="text-xs text-green-600 hover:underline mt-0.5"
          data-testid="button-toggle-description"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

interface OwnershipSectionProps {
  property: Property;
  enrichedProperty: EnrichedPropertyData | null;
  organizations: Organization[];
  onOpenFlagDialog: (type: 'management_company' | 'owner' | 'property_info' | 'other') => void;
}

export default function OwnershipSection({
  property,
  enrichedProperty,
  organizations,
  onOpenFlagDialog,
}: OwnershipSectionProps) {
  const router = useRouter();

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Ownership & Management</h2>
      
      {organizations.length > 0 ? (
        <div className="space-y-3 mb-4">
          {organizations.map((org) => {
            const rawRoles = org.roles?.length ? org.roles : (org.role ? [org.role] : []);
            const displayRoles = [...new Set(rawRoles.flatMap(r => r.split(',').map(s => s.trim())))];
            const isOwner = displayRoles.includes('owner');
            const isManager = displayRoles.includes('property_manager') || displayRoles.includes('facilities_manager');
            const bgColor = isOwner ? 'bg-purple-50 border-purple-100' : isManager ? 'bg-blue-50 border-blue-100' : 'bg-gray-50 border-gray-200';

            const socialLinks = [
              org.linkedinHandle ? {
                icon: SiLinkedin,
                url: org.linkedinHandle.startsWith('http') ? org.linkedinHandle : `https://linkedin.com/company/${org.linkedinHandle}`,
                label: 'LinkedIn',
                color: 'text-[#0A66C2] hover:text-[#004182]',
              } : null,
              org.twitterHandle ? {
                icon: SiX,
                url: org.twitterHandle.startsWith('http') ? org.twitterHandle : `https://x.com/${org.twitterHandle}`,
                label: 'X / Twitter',
                color: 'text-gray-800 hover:text-black',
              } : null,
              org.facebookHandle ? {
                icon: SiFacebook,
                url: org.facebookHandle.startsWith('http') ? org.facebookHandle : `https://facebook.com/${org.facebookHandle}`,
                label: 'Facebook',
                color: 'text-[#1877F2] hover:text-[#0d5fba]',
              } : null,
            ].filter(Boolean) as { icon: any; url: string; label: string; color: string }[];

            const locationParts = [org.city, org.state].filter(Boolean);
            const locationStr = locationParts.length > 0 ? locationParts.join(', ') : null;
            const primaryPhone = org.phoneNumbers?.[0] || null;
            const primaryEmail = org.emailAddresses?.[0] || null;

            return (
              <div 
                key={org.id || org.name}
                className={`p-4 rounded-lg border ${bgColor} ${org.id ? 'cursor-pointer hover:shadow-md transition-shadow' : ''}`}
                onClick={() => org.id && router.push(`/organization/${org.id}`)}
                data-testid={`ownership-org-${org.id}`}
              >
                <div className="flex items-start justify-between gap-3">
                  {org.logoUrl && (
                    <img
                      src={org.logoUrl}
                      alt={org.name || 'Organization logo'}
                      className="w-10 h-10 rounded object-contain flex-shrink-0 bg-white border border-gray-200"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      data-testid={`img-org-logo-${org.id}`}
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-gray-900">{org.name || org.domain || 'Unknown Organization'}</p>
                      <div className="flex flex-wrap gap-1">
                        {displayRoles.map((role) => (
                          <span 
                            key={role}
                            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${ROLE_COLORS[role] || ROLE_COLORS.other}`}
                          >
                            {ROLE_LABELS[role] || role}
                          </span>
                        ))}
                      </div>
                      {org.id && (
                        <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      {org.orgType && (
                        <span className={`inline-block px-2 py-0.5 text-xs rounded ${isOwner ? 'bg-purple-100 text-purple-700' : isManager ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                          {org.orgType}
                        </span>
                      )}
                      {org.industry && (
                        <span className="inline-block px-2 py-0.5 text-xs rounded bg-gray-100 text-gray-600">
                          {org.industry}
                        </span>
                      )}
                      {org.foundedYear && (
                        <span className="text-xs text-gray-500">Est. {org.foundedYear}</span>
                      )}
                      {org.employeesRange && (
                        <span className="text-xs text-gray-500">{org.employeesRange} employees</span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-3 mt-1.5">
                      {org.domain && (
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            window.open(`https://${org.domain}`, '_blank');
                          }}
                          className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                          data-testid={`link-org-domain-${org.id}`}
                        >
                          <Globe className="w-3.5 h-3.5" />
                          {org.domain}
                        </span>
                      )}
                      {socialLinks.length > 0 && (
                        <div className="flex items-center gap-1.5">
                          {socialLinks.map((link) => (
                            <span
                              key={link.label}
                              onClick={(e) => {
                                e.stopPropagation();
                                window.open(link.url, '_blank');
                              }}
                              className={`inline-flex items-center cursor-pointer transition-colors ${link.color}`}
                              title={link.label}
                              data-testid={`link-org-${link.label.toLowerCase().replace(/\s+/g, '-')}-${org.id}`}
                            >
                              <link.icon className="w-3.5 h-3.5" />
                            </span>
                          ))}
                        </div>
                      )}
                      {locationStr && (
                        <span className="text-sm text-gray-500">{locationStr}</span>
                      )}
                    </div>

                    {(primaryPhone || primaryEmail) && (
                      <div className="flex flex-wrap items-center gap-3 mt-1.5">
                        {primaryPhone && (
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              window.open(`tel:${primaryPhone}`, '_self');
                            }}
                            className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 cursor-pointer"
                            data-testid={`link-org-phone-${org.id}`}
                          >
                            <Phone className="w-3.5 h-3.5" />
                            {primaryPhone}
                          </span>
                        )}
                        {primaryEmail && (
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              window.open(`mailto:${primaryEmail}`, '_self');
                            }}
                            className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 cursor-pointer"
                            data-testid={`link-org-email-${org.id}`}
                          >
                            <Mail className="w-3.5 h-3.5" />
                            {primaryEmail}
                          </span>
                        )}
                      </div>
                    )}

                    {org.description && (
                      <ExpandableDescription text={capitalizeSentences(org.description)} />
                    )}

                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenFlagDialog(isOwner ? 'owner' : 'management_company');
                    }}
                    className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-full transition-colors"
                    title="Something doesn't look right? Flag for review by the greenfinch.ai team"
                    data-testid={`button-flag-org-${org.id}`}
                  >
                    <Flag className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <>
          {enrichedProperty?.beneficialOwner && (
            <div className="mb-4 p-4 bg-purple-50 rounded-lg border border-purple-100">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-purple-700 mb-1">Beneficial Owner</p>
                  <p className="font-medium text-gray-900">{enrichedProperty.beneficialOwner}</p>
                  {enrichedProperty.beneficialOwnerType && (
                    <span className="inline-block mt-1 px-2 py-0.5 text-xs bg-purple-100 text-purple-700 rounded">
                      {enrichedProperty.beneficialOwnerType}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => onOpenFlagDialog('owner')}
                  className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-full transition-colors"
                  title="Something doesn't look right? Flag for review by the greenfinch.ai team"
                  data-testid="button-flag-owner"
                >
                  <Flag className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {enrichedProperty?.managementCompany && (
            <div className="mb-4 p-4 bg-blue-50 rounded-lg border border-blue-100">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-blue-700 mb-1">Management Company</p>
                  <p className="font-medium text-gray-900">{enrichedProperty.managementCompany}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    {enrichedProperty.managementType && (
                      <span className="inline-block px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded">
                        {enrichedProperty.managementType.replace('_', ' ')}
                      </span>
                    )}
                    {enrichedProperty.managementCompanyDomain && (
                      <a 
                        href={`https://${enrichedProperty.managementCompanyDomain}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-blue-600 hover:text-blue-800 hover:underline"
                      >
                        {enrichedProperty.managementCompanyDomain}
                      </a>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => onOpenFlagDialog('management_company')}
                  className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-full transition-colors"
                  title="Something doesn't look right? Flag for review by the greenfinch.ai team"
                  data-testid="button-flag-management"
                >
                  <Flag className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {property.accountOwner && !enrichedProperty?.beneficialOwner && (
        <div className="py-2">
          <span className="text-sm text-gray-500 block mb-1">Registered Owner</span>
          <div className="flex items-center space-x-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
            <svg className="w-5 h-5 text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
            <span className="text-gray-700">{toTitleCase(property.accountOwner)}</span>
          </div>
          <p className="text-xs text-gray-400 mt-1">Raw parcel data - run enrichment for beneficial owner details</p>
        </div>
      )}

      {property.constituentOwners && property.constituentOwners.length > 0 && (
        <details className="group">
          <summary className="flex items-center justify-between cursor-pointer py-2 text-sm text-gray-600 hover:text-gray-800">
            <span className="font-medium">Other Registered Owners ({property.constituentOwners.length})</span>
            <svg className="w-4 h-4 transform transition-transform group-open:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </summary>
          <div className="mt-2 space-y-2">
            {property.constituentOwners.map((owner, i) => (
              <div key={i} className="flex items-center space-x-2 p-2 bg-gray-50 rounded text-sm">
                <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                <span className="text-gray-700">{toTitleCase(owner)}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {!enrichedProperty?.beneficialOwner && !enrichedProperty?.managementCompany && !property.accountOwner && (!property.constituentOwners || property.constituentOwners.length === 0) && (
        <p className="text-gray-500">No ownership information available</p>
      )}
    </div>
  );
}
