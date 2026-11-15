import { describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import Podium from '@/platform/home/Podium.jsx';
import RankRow, { RankHead } from '@/platform/home/RankRow.jsx';
import StateCard from './StateCard.jsx';
import { FriendsEmpty, FriendsList, RowSkeleton } from './Rows.jsx';

const COLS = [
  { key: 'wins', label: 'Wins' },
  { key: 'bestScore', label: 'Best net worth', format: 'inr' },
];
const row = (rank, name, extra = {}) => ({ rank, name, avatar: rank, level: 5, wins: 10 - rank, games: 20, bestScore: 150000, ...extra });
const inRouter = (el) => renderToString(h(StaticRouter, { location: '/' }, el));

describe('Podium', () => {
  it('renders the top three with 1st first in the DOM and marks you', () => {
    const html = renderToString(h(Podium, { rows: [row(1, 'Ravi'), row(2, 'Meena'), row(3, 'Asha', { isMe: true }), row(4, 'Kiran')], cols: COLS }));
    expect(html).toContain('sl-slot--1');
    expect(html).toContain('sl-slot--3');
    expect(html).not.toContain('Kiran');
    expect(html.indexOf('Ravi')).toBeLessThan(html.indexOf('Meena'));
    expect(html).toContain('3rd place: Asha (you)');
    expect(html).toContain('₹1.5L'); // money-like scores are compact rupees
  });
  it('copes with fewer than three players', () => {
    const html = renderToString(h(Podium, { rows: [row(1, 'Ravi')], cols: COLS }));
    expect(html).toContain('sl-podium--n1');
    expect(html).not.toContain('sl-slot--2');
  });
});

describe('RankRow', () => {
  it('highlights your row and shows every column', () => {
    const html = renderToString(h(RankRow, { row: row(7, 'Asha', { isMe: true }), cols: COLS }));
    expect(html).toContain('is-me');
    expect(html).toContain('You');
    expect(html).toContain('₹1.5L');
    expect(html).toContain('Best net worth');
    expect(renderToString(h(RankHead, { cols: COLS }))).toContain('Wins');
  });
});

describe('StateCard / friends lists', () => {
  it('state card has a title, text and actions', () => {
    const html = inRouter(h(StateCard, { icon: 'trophy', title: 'No ranked games yet', actions: [{ label: 'Play', to: '/games/x', primary: true }] }, 'Be the first.'));
    expect(html).toContain('No ranked games yet');
    expect(html).toContain('href="/games/x"');
    expect(html).toContain('Be the first.');
  });
  it('friends are grouped by presence: online first', () => {
    const shown = [
      { key: '1', item: { id: 1, name: 'Ravi', avatar: 1, level: 3, online: true, equipped: {} }, leaving: false },
      { key: '2', item: { id: 2, name: 'Kiran', avatar: 2, level: 2, online: false, equipped: {} }, leaving: false },
    ];
    const html = inRouter(h(FriendsList, { shown, room: '', roomState: () => undefined, busy: {}, onOpen() {}, onInvite() {}, onInviteRoom() {}, onRemove() {} }));
    expect(html.indexOf('Online now')).toBeGreaterThan(-1);
    expect(html.indexOf('Online now')).toBeLessThan(html.indexOf('Offline'));
    expect(html.indexOf('Ravi')).toBeLessThan(html.indexOf('Kiran'));
    expect(html).toContain('Invite Ravi to a game');
  });
  it('the empty state teaches how friend codes work', () => {
    const html = renderToString(h(FriendsEmpty, { onShare() {}, canUseShare: false }));
    expect(html).toContain('Share your friend code');
    expect(html).toContain('Copy my invite');
  });
  it('skeleton rows are marked busy', () => {
    expect(renderToString(h(RowSkeleton, { n: 2 }))).toContain('aria-busy="true"');
  });
});
