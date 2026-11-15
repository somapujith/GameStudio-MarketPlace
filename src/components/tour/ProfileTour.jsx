import { useAccount } from '@/components/shell/hooks.js';
import TourHost from './TourHost.jsx';
import { PROFILE_TOUR_ID, profileSteps } from './steps/profileSteps.js';

/** The profile page's tour (identity, stats, settings); waits for the session to load. */
export default function ProfileTour() {
  const { loading } = useAccount();
  return <TourHost tourId={PROFILE_TOUR_ID} steps={profileSteps} ready={!loading} slot="topbar" label="Tour of the profile page" />;
}
