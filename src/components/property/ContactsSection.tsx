'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, ListPlus } from 'lucide-react';
import { EmailStatusIcon, PhoneStatusIcon, LinkedInStatusIcon, hasAnyPhone, hasOnlyOfficeLine } from '@/components/ContactStatusIcons';
import { Button } from '@/components/ui/button';
import { ROLE_LABELS, ROLE_COLORS } from '@/lib/constants';
import { AdminOnly } from '@/components/PermissionGate';
import GreenfinchAgentIcon from '@/components/icons/GreenfinchAgentIcon';
import type { Contact } from './types';

const ROLE_PRIORITY: Record<string, number> = {
  property_manager: 1,
  facilities_manager: 2,
  owner: 3,
  leasing: 4,
  other: 5,
};

function sortContactsByRelevance(contacts: Contact[]): Contact[] {
  return [...contacts].sort((a, b) => {
    const formerA = a.relationshipStatus === 'former' ? 1 : 0;
    const formerB = b.relationshipStatus === 'former' ? 1 : 0;
    if (formerA !== formerB) return formerA - formerB;
    const priorityA = ROLE_PRIORITY[a.role] || 99;
    const priorityB = ROLE_PRIORITY[b.role] || 99;
    return priorityA - priorityB;
  });
}

function ContactAvatar({ photoUrl, name }: { photoUrl?: string | null; name: string }) {
  const [imageError, setImageError] = useState(false);
  const showImage = photoUrl && !imageError;
  
  if (showImage) {
    return (
      <img 
        src={photoUrl} 
        alt={name || 'Contact'} 
        className="w-10 h-10 rounded-full object-cover flex-shrink-0"
        onError={() => setImageError(true)}
      />
    );
  }
  
  return (
    <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
      <span className="text-green-700 font-medium text-sm">
        {name?.charAt(0) || '?'}
      </span>
    </div>
  );
}

function ContactInfoIcons({ contact }: { contact: Contact }) {
  return (
    <div className="flex items-center gap-2" data-testid={`contact-info-icons-${contact.id}`}>
      <EmailStatusIcon hasEmail={!!contact.email} status={contact.emailValidationStatus} />
      <PhoneStatusIcon hasPhone={hasAnyPhone(contact)} isOfficeOnly={hasOnlyOfficeLine(contact)} />
      <LinkedInStatusIcon hasLinkedIn={!!contact.linkedinUrl} />
    </div>
  );
}

interface ContactsSectionProps {
  contacts: Contact[];
  onShowAddContactModal: () => void;
  onEnrichment: () => void;
  onSetContactForListModal: (id: string) => void;
}

export default function ContactsSection({
  contacts,
  onShowAddContactModal,
  onEnrichment,
  onSetContactForListModal,
}: ContactsSectionProps) {
  const router = useRouter();

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">
          Contacts ({contacts.length})
        </h2>
        <Button
          variant="outline"
          size="sm"
          onClick={onShowAddContactModal}
          data-testid="button-add-contact"
        >
          <Plus className="w-4 h-4 mr-1" />
          Add Contact
        </Button>
      </div>
      {contacts.length > 0 ? (
        <div className="space-y-3">
          {sortContactsByRelevance(contacts).map((contact, i) => {
            const isFormer = contact.relationshipStatus === 'former';
            return (
              <div 
                key={`${contact.id || contact.email}-${i}`} 
                className={`p-4 rounded-lg transition-colors ${isFormer ? 'bg-gray-100 opacity-60' : 'bg-gray-50'} ${contact.id ? 'cursor-pointer hover:bg-gray-100' : ''}`}
                onClick={() => contact.id && router.push(`/contact/${contact.id}`)}
                data-testid={`contact-row-${contact.id}`}
              >
                <div className="flex items-start space-x-3">
                  <ContactAvatar photoUrl={contact.photoUrl} name={contact.fullName || ''} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center flex-wrap gap-2 mb-1">
                      <p className={`font-medium ${isFormer ? 'text-gray-500 line-through' : 'text-gray-900'}`}>{contact.fullName}</p>
                      {contact.role && (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${ROLE_COLORS[contact.role] || ROLE_COLORS.other}`}>
                          {ROLE_LABELS[contact.role] || contact.role}
                        </span>
                      )}
                      {isFormer && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
                          Former
                        </span>
                      )}
                    </div>
                    
                    {isFormer && contact.relationshipStatusReason && (
                      <p className="text-xs text-red-600 mb-1">{contact.relationshipStatusReason}</p>
                    )}
                    {contact.title && (
                      <p className="text-sm text-gray-600 mb-1">{contact.title}</p>
                    )}
                    {contact.employerName && (
                      <p className="text-sm text-gray-500 mb-1">{contact.employerName}</p>
                    )}
                    
                    <div className="flex items-center justify-between mt-2">
                      <ContactInfoIcons contact={contact} />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSetContactForListModal(contact.id);
                        }}
                        className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-full transition-colors"
                        title="Add to list"
                        data-testid={`button-add-contact-to-list-${contact.id}`}
                      >
                        <ListPlus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-8">
          <div className="w-12 h-12 text-gray-300 mx-auto mb-3 flex items-center justify-center">
            <GreenfinchAgentIcon size={48} className="text-gray-300" />
          </div>
          <p className="text-gray-500 mb-3">No contacts discovered yet</p>
          <AdminOnly>
            <button
              onClick={onEnrichment}
              className="text-sm text-green-600 hover:text-green-700"
            >
              Click "Research" to discover contacts
            </button>
          </AdminOnly>
        </div>
      )}
    </div>
  );
}
