import { TourDefinition } from './types';
import { mapOverviewTour } from './tours/map-overview';
import { listFilteringTour } from './tours/list-filtering';
import { pipelineBoardTour } from './tours/pipeline-board';
import { contactsPageTour } from './tours/contacts-page';
import { savedListsTour } from './tours/saved-lists';

export const ALL_TOURS: TourDefinition[] = [
  mapOverviewTour,
  listFilteringTour,
  pipelineBoardTour,
  contactsPageTour,
  savedListsTour,
];

export function getToursForRoute(pathname: string): TourDefinition[] {
  return ALL_TOURS.filter((tour) => pathname.startsWith(tour.route));
}

export function getTourById(id: string): TourDefinition | undefined {
  return ALL_TOURS.find((tour) => tour.id === id);
}
