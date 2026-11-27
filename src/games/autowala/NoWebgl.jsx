// Shown instead of the game when this device has no WebGL 2: decided by manifest.js BEFORE the 3D chunks (three.js, the city) are downloaded,
// so a phone that cannot run Autowala says so at once instead of after 5-9 s of loading. The same screen the game shows if it fails later.
import './ui/autowala.css';
import { FailureScreen } from './ui/menus/BootScreens.jsx';

export default function NoWebgl() {
  return (
    <div className="aw">
      <FailureScreen kind="webgl" />
    </div>
  );
}
