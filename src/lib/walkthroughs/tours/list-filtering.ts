import { TourDefinition } from '../types';

export const listFilteringTour: TourDefinition = {
  id: 'list-filtering',
  route: '/dashboard/list',
  title: 'the Property List',
  trigger: 'first-visit',
  steps: [
    {
      element: '[data-tour="list-filters"]',
      title: 'Filter Properties',
      description: 'Use filters to narrow down properties by type, status, size, and more.',
      side: 'bottom',
    },
    {
      element: '[data-tour="list-sort"]',
      title: 'Sort Results',
      description: 'Click column headers to sort properties by contacts, lot size, or building square footage.',
      side: 'bottom',
    },
    {
      element: '[data-tour="bulk-actions"]',
      title: 'Bulk Actions',
      description: 'Select multiple properties to run AI research or add them to a list in bulk.',
      side: 'top',
    },
    {
      element: '[data-tour="view-toggle"]',
      title: 'Switch to Map',
      description: 'Toggle back to the map view to see your properties geographically.',
      side: 'bottom',
    },
  ],
};
