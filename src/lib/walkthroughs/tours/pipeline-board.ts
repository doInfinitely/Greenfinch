import { TourDefinition } from '../types';

export const pipelineBoardTour: TourDefinition = {
  id: 'pipeline-board',
  route: '/pipeline/board',
  title: 'the Pipeline Board',
  trigger: 'first-visit',
  steps: [
    {
      element: '[data-tour="pipeline-columns"]',
      title: 'Pipeline Stages',
      description: 'Properties move through stages from left to right. Each column represents a deal stage with a count badge.',
      side: 'bottom',
    },
    {
      element: '[data-tour="pipeline-card"]',
      title: 'Property Cards',
      description: 'Each card shows a property in your pipeline. Drag cards between columns to update their status.',
      side: 'right',
    },
    {
      element: '[data-tour="pipeline-owner-filter"]',
      title: 'Filter by Owner',
      description: 'View your pipeline, the full team\'s pipeline, or filter by a specific team member.',
      side: 'bottom',
    },
  ],
};
