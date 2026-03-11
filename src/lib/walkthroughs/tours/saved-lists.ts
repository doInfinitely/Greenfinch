import { TourDefinition } from '../types';

export const savedListsTour: TourDefinition = {
  id: 'saved-lists',
  route: '/lists',
  title: 'Saved Lists',
  trigger: 'first-visit',
  steps: [
    {
      element: '[data-tour="create-list"]',
      title: 'Create a List',
      description: 'Create custom lists to organize properties or contacts for campaigns, follow-ups, or team collaboration.',
      side: 'bottom',
    },
    {
      element: '[data-tour="list-tabs"]',
      title: 'Filter by Type',
      description: 'Switch between all lists, property lists, and contact lists to find what you need.',
      side: 'bottom',
    },
  ],
};
