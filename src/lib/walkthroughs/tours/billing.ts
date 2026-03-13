import { TourDefinition } from '../types';

export const billingTour: TourDefinition = {
  id: 'billing-overview',
  route: '/billing',
  title: 'Billing & Credits',
  trigger: 'first-visit',
  steps: [
    {
      element: '[data-tour="billing-plan"]',
      title: 'Your Plan',
      description: 'See your current subscription tier, renewal date, and monthly credit usage at a glance.',
      side: 'bottom',
    },
    {
      element: '[data-tour="billing-balance"]',
      title: 'Credit Balance',
      description: 'Track your current period credits, rollover balance, and any purchased credits.',
      side: 'bottom',
    },
    {
      element: '[data-tour="billing-seats"]',
      title: 'Seat Management',
      description: 'View how many seats are in use and manage team member access.',
      side: 'bottom',
    },
    {
      element: '[data-tour="billing-costs"]',
      title: 'Action Costs',
      description: 'See how many credits each action costs so you can plan your usage effectively.',
      side: 'top',
    },
  ],
};
