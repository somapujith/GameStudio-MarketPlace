// Resigning: who may, the words, and the one place that sends it.
//   The engine allows RESIGN at any time for a player who is still in (doResign: the bank takes ALL the cash and districts,
//   upgrades are sold, mortgages cleared; only a debt owed to a player is paid, by the bank, up to the assets' worth; the
//   last one left wins). Two UI entry points open a confirm dialog (menu, your own player sheet); the debt sheet
//   has its own "Declare bankruptcy". Nothing here ever resigns without that confirm.
//   Leaving a running game with the back button resigns too (the room does it for the leaver); the difference is that
//   Resign keeps you at the table, watching.
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatINR } from '@shared/format.js';
import { bankruptcySummary } from '../ui/bankruptcy.js';

export const RESIGN_TITLE = 'Resign from this game?';
export const RESIGN_TEXT = "You lose: the bank takes ALL your cash and your districts go back to the bank, free for anyone to buy. You can't rejoin, but you can stay and watch the rest of the game.";

/**
 * The resign dialog's text. With no debt it is RESIGN_TEXT; when you owe a player something it also says exactly what the
 * bank pays them (the debt, up to what your assets are worth), the same numbers the engine uses.
 */
export function resignText(session) {
  const s = session?.view ? bankruptcySummary(session.view, session.me) : null;
  if (!s || s.bank) return RESIGN_TEXT;
  const to = s.payouts.length ? s.payouts.map((r) => `${r.name} is paid ${formatINR(r.amount)}`).join(', ') : 'nobody can be paid, you have nothing left';
  return `${RESIGN_TEXT} You still owe: ${to} (up to what your assets are worth).`;
}
export const RESIGN_CONFIRM = 'Resign';
export const RESIGN_KEEP = 'Keep playing';

/**
 * Where the viewer stands: 'playing' (in the game), 'out' (bankrupt or resigned), 'over' (the game has ended), 'spectator'.
 * Reads the authoritative `view`, not the animated `display` and not `session.options` (those are blank while the table
 * animates), so the button is there at any moment.
 */
export function resignStatus(session) {
  const view = session?.view;
  const me = session?.me;
  if (!view || !Array.isArray(view.players)) return 'spectator';
  const mine = view.players.find((p) => String(p.id) === String(me));
  if (!mine) return 'spectator';
  if (view.phase === 'over' || session.result) return 'over';
  if (mine.bankrupt) return 'out';
  return 'playing';
}

/** Resign is offered while the game runs and you are still in it. */
export const canResign = (session) => resignStatus(session) === 'playing';

/** What the back button's confirm says. Leaving a running game forfeits it, so it must not read like a harmless "back". */
export function leaveDialog(status) {
  switch (status) {
    case 'playing':
      return {
        title: 'Leave the game?',
        text: "Leaving counts as resigning: you lose, the bank takes all your cash and your districts return to the bank, and you can't rejoin. To keep watching the table instead, use Resign in the menu.",
        confirm: 'Leave and resign',
        cancel: 'Keep playing',
      };
    case 'out':
      return { title: 'Leave the table?', text: 'You are already out of this game. Leaving closes the table for you.', confirm: 'Leave', cancel: 'Keep watching' };
    case 'over':
      return { title: 'Leave the table?', text: 'The game is over.', confirm: 'Leave', cancel: 'Stay' };
    default:
      return { title: 'Leave the table?', text: 'You are only watching.', confirm: 'Leave', cancel: 'Stay' };
  }
}

/** The calm line that replaces the action while you watch. */
export function watchingLine(session, resigned = false) {
  return resigned || session?.resigned ? 'You resigned – watching' : 'You are out – watching';
}

/** Tries before it gives up: the room ignores an action while it is still answering the previous one. */
export const RESIGN_TRIES = 4;
export const RESIGN_RETRY_MS = 1600;

/** What the resign flow does next. Pure. -> 'idle' | 'done' | 'wait' | 'send' | 'give_up' */
export function resignStep({ pending, status, busy, canSend, tries }) {
  if (!pending) return 'idle';
  if (status !== 'playing') return 'done'; // you are out (it worked), or the game ended first
  if (busy || !canSend) return 'wait'; // the table is animating: the room ignores actions until it has settled
  return tries >= RESIGN_TRIES ? 'give_up' : 'send';
}

/**
 * The resign flow for the game screen.
 *   ask()      open the confirm dialog           cancel()   close it
 *   confirm()  the player said yes: sends RESIGN as soon as the table has settled (`session.dispatch` is a no-op while
 *              the table is animating or an earlier action is still being answered), retried a few times
 *   asking / pending / resigned    dialog open / confirmed but not answered yet / you resigned in this visit
 * Gives up quietly when the game ends or you are out.
 */
export function useResign(session) {
  const [asking, setAsking] = useState(false);
  const [pending, setPending] = useState(false);
  const [resigned, setResigned] = useState(false);
  const status = resignStatus(session);
  const dispatchRef = useRef(session?.dispatch);
  dispatchRef.current = session?.dispatch;
  const canSend = typeof session?.dispatch === 'function';
  const busy = !!session?.busy;
  const tries = useRef(0);

  const ask = useCallback(() => setAsking(true), []);
  const cancel = useCallback(() => setAsking(false), []);
  const confirm = useCallback(() => {
    tries.current = 0;
    setAsking(false);
    setResigned(true);
    setPending(true);
  }, []);

  useEffect(() => {
    const look = () => resignStep({ pending, status, busy, canSend, tries: tries.current });
    const act = () => {
      const what = look();
      if (what === 'give_up') {
        setPending(false);
        setResigned(false);
      } else if (what === 'send') {
        tries.current += 1;
        dispatchRef.current?.({ type: 'RESIGN' });
      }
    };
    const first = look();
    if (first === 'done') setPending(false); // answered (you are out), or the game ended first
    if (first !== 'send') return undefined; // idle, or waiting for the table to settle
    act();
    const t = setInterval(act, RESIGN_RETRY_MS);
    return () => clearInterval(t);
  }, [pending, status, busy, canSend]);

  return { asking, pending, resigned: resigned && status !== 'playing', resigning: pending && status === 'playing', status, ask, cancel, confirm };
}
