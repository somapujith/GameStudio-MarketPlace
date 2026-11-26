// One finger per control, and no ghosts. A control "claims" a pointer on pointerdown and only listens to that pointer until it ends.
// isGhostPointer() drops what is not a deliberate press: a palm resting on the glass (a huge contact patch), a right / middle click.
export const PALM_SIZE = 110; // css px: a fingertip is 8-45, a palm well over 100

export function isGhostPointer(e) {
  if (!e) return true;
  if (e.pointerType === 'mouse' && e.button !== undefined && e.button !== 0) return true;
  if (e.pointerType === 'touch') {
    const w = Number(e.width) || 0;
    const h = Number(e.height) || 0;
    if (w >= PALM_SIZE && h >= PALM_SIZE) return true;
  }
  return false;
}

/** A slot that holds at most one pointer id. claim(e) -> true when this event is now the owner. */
export function createPointerSlot() {
  const slot = { id: null };
  slot.claim = (e) => {
    if (slot.id !== null) return false;
    if (isGhostPointer(e)) return false;
    slot.id = e.pointerId;
    return true;
  };
  slot.owns = (e) => slot.id !== null && e.pointerId === slot.id;
  /** Release when `e` is the owner (or when called with no event: a forced release). Returns true if something was released. */
  slot.release = (e) => {
    if (slot.id === null) return false;
    if (e && e.pointerId !== slot.id) return false;
    slot.id = null;
    return true;
  };
  return slot;
}
