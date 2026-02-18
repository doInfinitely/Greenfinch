'use client';

import { AlertTriangle } from 'lucide-react';
import { 
  EmailStatusIcon, 
  PhoneStatusIcon,
} from '@/components/ContactStatusIcons';
import { formatPhoneNumber } from '@/lib/phone-format';
import type { Contact } from './types';

const PHONE_LABEL_CONFIG: Record<string, { label: string; color: string }> = {
  direct_work: { label: 'Direct', color: 'bg-green-100 text-green-700' },
  office: { label: 'Office', color: 'bg-blue-100 text-blue-700' },
  personal: { label: 'Personal', color: 'bg-purple-100 text-purple-700' },
  mobile: { label: 'Mobile', color: 'bg-teal-100 text-teal-700' },
};

interface ContactInfoProps {
  contact: Contact;
}

export default function ContactInfo({ contact }: ContactInfoProps) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Contact Information</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-gray-500 mb-1">Full Name</label>
          <p className="text-gray-900">{contact.fullName || '\u2014'}</p>
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-500 mb-1">Title</label>
          <p className="text-gray-900">{contact.title || '\u2014'}</p>
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-500 mb-1">Email</label>
          <div className="flex items-center gap-2">
            <EmailStatusIcon hasEmail={!!contact.email} status={contact.emailValidationStatus} />
            {contact.email ? (
              <a href={`mailto:${contact.email}`} className="text-green-600 hover:text-green-700 hover:underline">
                {contact.email}
              </a>
            ) : (
              <span className="text-gray-400">&mdash;</span>
            )}
          </div>
        </div>
        
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-500 mb-1">Phone Numbers</label>
          <div className="space-y-2">
            {(contact.phone || contact.normalizedPhone) && (
              <div className="flex items-center gap-2">
                <PhoneStatusIcon hasPhone={true} isOfficeOnly={contact.phoneLabel === 'office'} />
                <a href={`tel:${contact.normalizedPhone || contact.phone}`} className="text-gray-900 hover:text-green-600">
                  {formatPhoneNumber(contact.phone || contact.normalizedPhone)}
                </a>
                {contact.phoneLabel && PHONE_LABEL_CONFIG[contact.phoneLabel] && (
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${PHONE_LABEL_CONFIG[contact.phoneLabel].color}`}>
                    {PHONE_LABEL_CONFIG[contact.phoneLabel].label}
                  </span>
                )}
              </div>
            )}
            {contact.enrichmentPhoneWork && contact.enrichmentPhoneWork !== contact.phone && (
              <div className="flex items-center gap-2">
                <PhoneStatusIcon hasPhone={true} />
                <a href={`tel:${contact.enrichmentPhoneWork}`} className="text-gray-900 hover:text-green-600">
                  {formatPhoneNumber(contact.enrichmentPhoneWork)}
                </a>
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
                  Work
                </span>
              </div>
            )}
            {contact.enrichmentPhonePersonal && contact.enrichmentPhonePersonal !== contact.phone && (
              <div className="flex items-center gap-2">
                <PhoneStatusIcon hasPhone={true} />
                <a href={`tel:${contact.enrichmentPhonePersonal}`} className="text-gray-900 hover:text-green-600">
                  {formatPhoneNumber(contact.enrichmentPhonePersonal)}
                </a>
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-teal-100 text-teal-700">
                  Mobile
                </span>
              </div>
            )}
            {contact.aiPhone && contact.aiPhone !== contact.phone && contact.aiPhone !== contact.enrichmentPhoneWork && contact.aiPhone !== contact.enrichmentPhonePersonal && (
              <div className="flex items-center gap-2">
                <PhoneStatusIcon hasPhone={true} />
                <a href={`tel:${contact.aiPhone}`} className="text-gray-900 hover:text-green-600">
                  {formatPhoneNumber(contact.aiPhone)}
                </a>
                {contact.aiPhoneLabel && PHONE_LABEL_CONFIG[contact.aiPhoneLabel] ? (
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${PHONE_LABEL_CONFIG[contact.aiPhoneLabel].color}`}>
                    {PHONE_LABEL_CONFIG[contact.aiPhoneLabel].label}
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
                    {contact.aiPhoneLabel || 'Other'}
                  </span>
                )}
              </div>
            )}
            {!contact.phone && !contact.normalizedPhone && !contact.enrichmentPhoneWork && !contact.enrichmentPhonePersonal && !contact.aiPhone && (
              <div className="flex items-center gap-2">
                <PhoneStatusIcon hasPhone={false} />
                <span className="text-gray-400">&mdash;</span>
              </div>
            )}
          </div>
        </div>
        
        {contact.reviewReason && (
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-500 mb-1">Review Reason</label>
            <p className="text-yellow-700 bg-yellow-50 px-3 py-2 rounded">{contact.reviewReason}</p>
          </div>
        )}
      </div>
    </div>
  );
}
