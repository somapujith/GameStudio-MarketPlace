import { useAccount } from '@/components/shell/hooks.js';
import TourHost from './TourHost.jsx';
import { HOME_TOUR_ID, homeSteps } from './steps/homeSteps.js';

/** The hub home page's tour: opens on a first visit once the session has loaded; "?" replays it. */
export default function HomeTour() {
  const { loading } = useAccount();
  return <TourHost tourId={HOME_TOUR_ID} steps={homeSteps} ready={!loading} slot="topbar" label="Tour of the home page" />;
}
