'use client';

import { useRouter } from 'next/navigation';
import type { OrgRelation } from './types';

const ORG_TYPE_COLORS: Record<string, string> = {
  owner: 'bg-purple-100 text-purple-700',
  management: 'bg-blue-100 text-blue-700',
  tenant: 'bg-green-100 text-green-700',
  developer: 'bg-orange-100 text-orange-700',
  other: 'bg-gray-100 text-gray-700',
};

interface ContactOrganizationsProps {
  organizations: OrgRelation[];
}

export default function ContactOrganizations({ organizations }: ContactOrganizationsProps) {
  const router = useRouter();

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">
        Organizations
        <span className="ml-2 text-sm font-normal text-gray-500">({organizations.length})</span>
      </h2>
      
      {organizations.length === 0 ? (
        <p className="text-gray-500 text-center py-4">No organizations linked.</p>
      ) : (
        <div className="space-y-3">
          {organizations.map((org) => (
            <div 
              key={org.id} 
              className="p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 hover:shadow-sm transition-all"
              onClick={() => router.push(`/organization/${org.id}`)}
              data-testid={`org-card-${org.id}`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-gray-900">{org.name || 'Unknown'}</p>
                    <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                  {org.title && (
                    <p className="text-sm text-gray-600">{org.title}</p>
                  )}
                  {org.domain && (
                    <span
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(`https://${org.domain}`, '_blank');
                      }}
                      className="text-sm text-green-600 hover:underline cursor-pointer"
                    >
                      {org.domain}
                    </span>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1">
                  {org.orgType && (
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ORG_TYPE_COLORS[org.orgType] || ORG_TYPE_COLORS.other}`}>
                      {org.orgType}
                    </span>
                  )}
                  {org.isCurrent !== null && (
                    <span className={`text-xs ${org.isCurrent ? 'text-green-600' : 'text-gray-400'}`}>
                      {org.isCurrent ? 'Current' : 'Former'}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
