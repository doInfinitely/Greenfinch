'use client';

import { useState, useEffect, useRef } from 'react';
import { Flag } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ContactStatusSummary } from '@/components/ContactStatusIcons';
import type { Contact } from './types';

const CONTACT_TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  individual: { label: 'Individual', color: 'bg-green-100 text-green-700' },
  general: { label: 'Office Line', color: 'bg-blue-100 text-blue-700' },
};

interface ContactHeaderProps {
  contact: Contact;
  onReportDataIssue: () => void;
}

export default function ContactHeader({ contact, onReportDataIssue }: ContactHeaderProps) {
  const [profilePhotoUrl, setProfilePhotoUrl] = useState<string | null>(null);
  const [isLoadingPhoto, setIsLoadingPhoto] = useState(false);
  const photoFetchAttemptedRef = useRef<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    
    if (!contact) {
      setProfilePhotoUrl(null);
      setIsLoadingPhoto(false);
      return;
    }
    
    if (contact.photoUrl) {
      setProfilePhotoUrl(contact.photoUrl);
      setIsLoadingPhoto(false);
      return;
    }
    
    if (contact.linkedinUrl && !contact.photoUrl && photoFetchAttemptedRef.current !== contact.id) {
      photoFetchAttemptedRef.current = contact.id;
      setIsLoadingPhoto(true);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);
      
      fetch(`/api/contacts/${contact.id}/profile-photo`, { signal: controller.signal })
        .then(res => res.json())
        .then(data => {
          if (!isMounted) return;
          if (data.success && data.url) {
            setProfilePhotoUrl(data.url);
          }
        })
        .catch(err => {
          if (!isMounted) return;
          if (err.name !== 'AbortError') {
            console.error('Failed to auto-fetch profile photo:', err);
          }
        })
        .finally(() => {
          clearTimeout(timeoutId);
          if (isMounted) {
            setIsLoadingPhoto(false);
          }
        });
    }
    
    return () => { isMounted = false; };
  }, [contact]);

  return (
    <div className="flex items-start gap-4">
      <div className="relative flex-shrink-0" data-testid="contact-avatar-container">
        <Avatar className="w-20 h-20" data-testid="contact-avatar">
          {isLoadingPhoto ? (
            <AvatarFallback className="bg-muted" data-testid="avatar-loading">
              <div className="w-6 h-6 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin"></div>
            </AvatarFallback>
          ) : (
            <>
              {profilePhotoUrl && (
                <AvatarImage 
                  src={profilePhotoUrl} 
                  alt={contact.fullName || 'Contact'}
                  onError={() => setProfilePhotoUrl(null)}
                  data-testid="avatar-image"
                />
              )}
              <AvatarFallback className="bg-green-100 text-green-700 text-2xl font-semibold" data-testid="avatar-fallback">
                {contact.fullName
                  ? contact.fullName.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
                  : '?'}
              </AvatarFallback>
            </>
          )}
        </Avatar>
      </div>
      
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-gray-900">{contact.fullName || 'Unknown Contact'}</h1>
          {contact.contactType && CONTACT_TYPE_CONFIG[contact.contactType] && (
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${CONTACT_TYPE_CONFIG[contact.contactType].color}`}>
              {CONTACT_TYPE_CONFIG[contact.contactType].label}
            </span>
          )}
        </div>
        {contact.title && (
          <p className="text-lg text-gray-600 mt-1">{contact.title}</p>
        )}
        {contact.location && (
          <p className="text-sm text-gray-500 mt-1 flex items-center gap-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {contact.location}
          </p>
        )}
        {(contact.employerName || contact.companyDomain) && (
          <div className="flex flex-wrap items-center gap-2 mt-1">
            {contact.employerName && (
              <span className="text-gray-600">{contact.employerName}</span>
            )}
            {contact.employerName && contact.companyDomain && (
              <span className="text-gray-400">&bull;</span>
            )}
            {contact.companyDomain && (
              <a 
                href={`https://${contact.companyDomain}`} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-green-600 hover:text-green-700 hover:underline"
              >
                {contact.companyDomain}
              </a>
            )}
          </div>
        )}
        <div className="mt-2 flex items-center gap-3">
          <ContactStatusSummary 
            contact={{
              email: contact.email,
              emailValidationStatus: contact.emailValidationStatus,
              phone: contact.phone,
              aiPhone: contact.aiPhone,
              enrichmentPhoneWork: contact.enrichmentPhoneWork,
              enrichmentPhonePersonal: contact.enrichmentPhonePersonal,
              phoneLabel: contact.phoneLabel,
              aiPhoneLabel: contact.aiPhoneLabel,
              linkedinUrl: contact.linkedinUrl,
              linkedinConfidence: contact.linkedinConfidence,
            }}
          />
          <button
            onClick={onReportDataIssue}
            className="text-gray-400 hover:text-amber-600 transition-colors p-1 rounded hover:bg-amber-50"
            title="Report data issue"
            data-testid="button-report-data-issue"
          >
            <Flag className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
