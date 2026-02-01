'use client';

import { Mail, Phone, CheckCircle, HelpCircle, XCircle, AlertTriangle, Linkedin } from 'lucide-react';
import linkedinLogo from '@/assets/linkedin-logo.png';

interface EmailStatusIconProps {
  hasEmail: boolean;
  status: string | null | undefined;
  size?: 'sm' | 'md';
}

interface PhoneStatusIconProps {
  hasPhone: boolean;
  isOfficeOnly?: boolean;
  size?: 'sm' | 'md';
}

interface LinkedInStatusIconProps {
  hasLinkedIn: boolean;
  size?: 'sm' | 'md';
}

interface ContactInfoData {
  email?: string | null;
  emailStatus?: string | null;
  emailValidationStatus?: string | null;
  phone?: string | null;
  aiPhone?: string | null;
  enrichmentPhoneWork?: string | null;
  enrichmentPhonePersonal?: string | null;
  phoneLabel?: string | null;
  aiPhoneLabel?: string | null;
  linkedinUrl?: string | null;
  linkedinConfidence?: number | null;
}

const ICON_SIZES = {
  sm: { icon: 'w-3.5 h-3.5', badge: 'w-2 h-2' },
  md: { icon: 'w-4 h-4', badge: 'w-2.5 h-2.5' },
};

export function EmailStatusIcon({ hasEmail, status, size = 'md' }: EmailStatusIconProps) {
  const sizes = ICON_SIZES[size];
  
  if (!hasEmail) {
    return (
      <span title="No email" className="inline-flex items-center text-gray-400" aria-label="No email available">
        <span className="relative">
          <Mail className={sizes.icon} />
          <XCircle className={`${sizes.badge} absolute -bottom-0.5 -right-0.5 text-gray-400 bg-white rounded-full`} />
        </span>
      </span>
    );
  }
  
  const normalizedStatus = status?.toLowerCase();
  
  if (normalizedStatus === 'valid') {
    return (
      <span title="Email validated" className="inline-flex items-center text-green-600" aria-label="Email validated">
        <span className="relative">
          <Mail className={sizes.icon} />
          <CheckCircle className={`${sizes.badge} absolute -bottom-0.5 -right-0.5 text-green-600 bg-white rounded-full`} />
        </span>
      </span>
    );
  }
  
  if (normalizedStatus === 'catch-all' || normalizedStatus === 'catchall') {
    return (
      <span title="Catch-all domain - email may not reach intended recipient" className="inline-flex items-center text-amber-500" aria-label="Catch-all email">
        <span className="relative">
          <Mail className={sizes.icon} />
          <AlertTriangle className={`${sizes.badge} absolute -bottom-0.5 -right-0.5 text-amber-500 bg-white rounded-full`} />
        </span>
      </span>
    );
  }
  
  if (normalizedStatus === 'pending') {
    return (
      <span title="Validating email..." className="inline-flex items-center text-amber-500" aria-label="Email validation pending">
        <span className="relative">
          <Mail className={sizes.icon} />
          <div className={`${sizes.badge} absolute -bottom-0.5 -right-0.5 border border-amber-500 border-t-transparent rounded-full animate-spin bg-white`} />
        </span>
      </span>
    );
  }
  
  if (normalizedStatus === 'invalid') {
    return (
      <span title="Email invalid" className="inline-flex items-center text-red-500" aria-label="Email invalid">
        <span className="relative">
          <Mail className={sizes.icon} />
          <XCircle className={`${sizes.badge} absolute -bottom-0.5 -right-0.5 text-red-500 bg-white rounded-full`} />
        </span>
      </span>
    );
  }
  
  return (
    <span title="Email not validated" className="inline-flex items-center text-amber-500" aria-label="Email not validated">
      <span className="relative">
        <Mail className={sizes.icon} />
        <HelpCircle className={`${sizes.badge} absolute -bottom-0.5 -right-0.5 text-amber-500 bg-white rounded-full`} />
      </span>
    </span>
  );
}

export function PhoneStatusIcon({ hasPhone, isOfficeOnly = false, size = 'md' }: PhoneStatusIconProps) {
  const sizes = ICON_SIZES[size];
  
  if (!hasPhone) {
    return (
      <span title="No phone" className="inline-flex items-center text-gray-400" aria-label="No phone available">
        <span className="relative">
          <Phone className={sizes.icon} />
          <XCircle className={`${sizes.badge} absolute -bottom-0.5 -right-0.5 text-gray-400 bg-white rounded-full`} />
        </span>
      </span>
    );
  }
  
  if (isOfficeOnly) {
    return (
      <span title="Office line only - no direct or mobile number" className="inline-flex items-center text-amber-500" aria-label="Office phone only">
        <span className="relative">
          <Phone className={sizes.icon} />
          <HelpCircle className={`${sizes.badge} absolute -bottom-0.5 -right-0.5 text-amber-500 bg-white rounded-full`} />
        </span>
      </span>
    );
  }
  
  return (
    <span title="Direct or mobile phone available" className="inline-flex items-center text-green-600" aria-label="Direct phone available">
      <span className="relative">
        <Phone className={sizes.icon} />
        <CheckCircle className={`${sizes.badge} absolute -bottom-0.5 -right-0.5 text-green-600 bg-white rounded-full`} />
      </span>
    </span>
  );
}

export function LinkedInStatusIcon({ hasLinkedIn, size = 'md' }: LinkedInStatusIconProps) {
  const sizes = ICON_SIZES[size];
  
  if (!hasLinkedIn) {
    return (
      <span title="No LinkedIn" className="inline-flex items-center text-gray-400" aria-label="No LinkedIn profile">
        <Linkedin className={sizes.icon} />
      </span>
    );
  }
  
  return (
    <span title="LinkedIn profile available" className="inline-flex items-center text-green-600" aria-label="LinkedIn available">
      <Linkedin className={sizes.icon} />
    </span>
  );
}

interface LinkedInLinkProps {
  linkedinUrl: string | null | undefined;
  size?: 'sm' | 'md';
}

export function LinkedInLink({ linkedinUrl, size = 'sm' }: LinkedInLinkProps) {
  const logoSize = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';
  
  if (!linkedinUrl) {
    return null;
  }
  
  return (
    <a
      href={linkedinUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center hover:opacity-80 transition-opacity"
      title="View LinkedIn profile"
      aria-label="View LinkedIn profile"
    >
      <img 
        src={linkedinLogo.src} 
        alt="LinkedIn" 
        className={logoSize}
      />
    </a>
  );
}

export function hasHighQualityPhone(contact: ContactInfoData): boolean {
  if (contact.enrichmentPhonePersonal) return true;
  if (contact.enrichmentPhoneWork) return true;
  const phoneLabel = contact.phoneLabel?.toLowerCase();
  if (phoneLabel === 'mobile' || phoneLabel === 'direct_work' || phoneLabel === 'personal') return true;
  if (contact.aiPhone && contact.aiPhoneLabel) {
    const aiLabel = contact.aiPhoneLabel.toLowerCase();
    if (aiLabel === 'mobile' || aiLabel === 'direct_work' || aiLabel === 'personal' || aiLabel === 'direct') return true;
  }
  return false;
}

export function hasAnyPhone(contact: ContactInfoData): boolean {
  return !!(contact.phone || contact.aiPhone || contact.enrichmentPhoneWork || contact.enrichmentPhonePersonal);
}

export function hasOnlyOfficeLine(contact: ContactInfoData): boolean {
  if (!hasAnyPhone(contact)) return false;
  return !hasHighQualityPhone(contact);
}

interface ContactStatusSummaryProps {
  contact: ContactInfoData;
  size?: 'sm' | 'md';
}

export function ContactStatusSummary({ contact, size = 'md' }: ContactStatusSummaryProps) {
  const hasPhone = hasAnyPhone(contact);
  const isOfficeOnly = hasOnlyOfficeLine(contact);
  const emailStatus = contact.emailValidationStatus || contact.emailStatus;
  
  return (
    <div className="flex items-center gap-2">
      <EmailStatusIcon 
        hasEmail={!!contact.email} 
        status={emailStatus}
        size={size}
      />
      <PhoneStatusIcon 
        hasPhone={hasPhone}
        isOfficeOnly={isOfficeOnly}
        size={size}
      />
      <LinkedInStatusIcon 
        hasLinkedIn={!!contact.linkedinUrl}
        size={size}
      />
    </div>
  );
}
