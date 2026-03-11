import { TourDefinition } from '../types';

export const mapOverviewTour: TourDefinition = {
  id: 'map-overview',
  route: '/dashboard/map',
  title: 'the Property Map',
  trigger: 'first-visit',
  triggerDelay: 2000,
  steps: [
    {
      element: '[data-tour="map-search"]',
      title: 'Search Properties',
      description: 'Search for properties by name, address, or location. Results update the map and sidebar instantly.',
      side: 'bottom',
    },
    {
      element: '[data-tour="map-filters"]',
      title: 'Filter Properties',
      description: 'Narrow down properties by category, status, size, and more. Combine filters to find exactly what you need.',
      side: 'bottom',
    },
    {
      element: '[data-tour="view-toggle"]',
      title: 'Switch Views',
      description: 'Toggle between the map view and a sortable list view of your properties.',
      side: 'bottom',
    },
    {
      element: '[data-tour="map-canvas"]',
      title: 'Interactive Map',
      description: 'Click any pin to see property details. Zoom and pan to explore your market area.',
      side: 'left',
    },
  ],
};
