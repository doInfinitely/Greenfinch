export interface WalkthroughState {
  completedTours: string[];
  dismissedTooltips: string[];
  skippedAll: boolean;
}

export interface WalkthroughStep {
  element: string; // data-tour attribute selector
  title: string;
  description: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
}

export interface TourDefinition {
  id: string;
  route: string; // pathname prefix to match
  title: string; // displayed in prompt
  trigger: 'first-visit';
  triggerDelay?: number; // ms before showing prompt (default 1500)
  steps: WalkthroughStep[];
}
