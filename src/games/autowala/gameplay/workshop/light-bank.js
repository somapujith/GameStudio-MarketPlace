// The showroom's lights are BORROWED, not added. Every light is part of every lit shader program (three.js keys a program on the number of point and
// spot lights), so a workshop that adds two point lights and a spot is a whole second set of programs: 75 camera + 7 depth programs, ~2 s each to build on
// the integrated GPU, and it was built in play (a trickle of 700-850 ms frames) or, if nobody had built it, in one freeze when the door opened.
// Borrowed instead: the first two lights of the street-lamp pool (world/props.js `lend`) are the pink and cyan rims, and the auto's own headlight spot is
// the key light while the auto stands in the bay. Same light set as the street's own at that hour (day: the pool lights stay visible at intensity 0, see
// props.update; night: the pool), so entering the garage compiles nothing, and the frame is no heavier than the street's.
//
//   const bank = borrowLights({ scene, auto, props });   // null when the auto has no headlight / the pool cannot lend: the caller adds its own lights
//   bank.key, bank.pink, bank.cyan                        // a SpotLight and two PointLights, the caller sets colour / intensity / reach / position (world space)
//   bank.release()                                        // everything back as it was
export function borrowLights({ scene, auto, props }) {
  const head = auto && auto.userData && auto.userData.headlight;
  if (!head || !props || typeof props.lend !== 'function') return null;
  const rims = props.lend(2);
  if (rims.length < 2) {
    props.unlend();
    return null;
  }
  const saved = {
    parent: head.parent,
    targetParent: head.target.parent,
    position: head.position.clone(),
    targetPosition: head.target.position.clone(),
    color: head.color.getHex(),
    distance: head.distance,
    angle: head.angle,
    penumbra: head.penumbra,
    decay: head.decay,
  };
  // into the scene, keeping the world position: the key stands in the bay, the auto's moves (and rolls) do not carry it around
  scene.attach(head);
  scene.attach(head.target);
  head.quaternion.identity();
  head.scale.set(1, 1, 1);
  head.target.quaternion.identity();
  auto.userData.headlightLent = true; // Game.syncAuto leaves the intensity alone while it is lent
  let released = false;
  return {
    key: head,
    pink: rims[0],
    cyan: rims[1],
    release() {
      if (released) return;
      released = true;
      head.removeFromParent();
      head.target.removeFromParent();
      (saved.parent || auto).add(head);
      (saved.targetParent || auto).add(head.target);
      head.quaternion.identity();
      head.target.quaternion.identity();
      head.position.copy(saved.position);
      head.target.position.copy(saved.targetPosition);
      // the colour the loadout wants NOW (a headlight bought in the workshop changed it while the spot was lent: sim/customize.js keeps it in headlightHex)
      if (auto.userData.headlightHex) head.color.set(auto.userData.headlightHex);
      else head.color.setHex(saved.color);
      head.distance = saved.distance;
      head.angle = saved.angle;
      head.penumbra = saved.penumbra;
      head.decay = saved.decay;
      head.intensity = 0; // syncAuto sets the headlight's own level on the next frame
      auto.userData.headlightLent = false;
      props.unlend();
    },
  };
}
