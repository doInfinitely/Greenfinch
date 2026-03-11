import { CUSTOMER_FLAG_TYPES, CUSTOMER_FLAG_LABELS, type CustomerFlagType } from './schema';

export interface CustomerFlagConfig {
  label: string;
  color: string;       // Tailwind bg class
  textColor: string;   // Tailwind text class
  icon: string;        // Lucide icon name
  hasCompetitor: boolean;
}

export const CUSTOMER_FLAG_CONFIG: Record<CustomerFlagType, CustomerFlagConfig> = {
  existing_customer: {
    label: CUSTOMER_FLAG_LABELS.existing_customer,
    color: 'bg-purple-100',
    textColor: 'text-purple-700',
    icon: 'UserCheck',
    hasCompetitor: false,
  },
  competitor_serviced: {
    label: CUSTOMER_FLAG_LABELS.competitor_serviced,
    color: 'bg-orange-100',
    textColor: 'text-orange-700',
    icon: 'Swords',
    hasCompetitor: true,
  },
  do_not_contact: {
    label: CUSTOMER_FLAG_LABELS.do_not_contact,
    color: 'bg-red-100',
    textColor: 'text-red-700',
    icon: 'Ban',
    hasCompetitor: false,
  },
  hot_lead: {
    label: CUSTOMER_FLAG_LABELS.hot_lead,
    color: 'bg-amber-100',
    textColor: 'text-amber-700',
    icon: 'Flame',
    hasCompetitor: false,
  },
  under_contract: {
    label: CUSTOMER_FLAG_LABELS.under_contract,
    color: 'bg-blue-100',
    textColor: 'text-blue-700',
    icon: 'FileSignature',
    hasCompetitor: false,
  },
  past_customer: {
    label: CUSTOMER_FLAG_LABELS.past_customer,
    color: 'bg-gray-100',
    textColor: 'text-gray-600',
    icon: 'History',
    hasCompetitor: false,
  },
};

export { CUSTOMER_FLAG_TYPES, CUSTOMER_FLAG_LABELS, type CustomerFlagType };
