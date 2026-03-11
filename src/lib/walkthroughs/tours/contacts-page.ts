import { TourDefinition } from '../types';

export const contactsPageTour: TourDefinition = {
  id: 'contacts-page',
  route: '/contacts',
  title: 'Contacts',
  trigger: 'first-visit',
  steps: [
    {
      element: '[data-tour="contact-list"]',
      title: 'Your Contacts',
      description: 'Browse all contacts discovered through AI research. See their roles, organizations, and contact information.',
      side: 'right',
    },
    {
      element: '[data-tour="contact-enrich"]',
      title: 'Reveal Contact Info',
      description: 'Click to reveal verified email addresses and phone numbers for any contact. Each reveal uses one credit.',
      side: 'left',
    },
  ],
};
