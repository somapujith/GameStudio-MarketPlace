import { describe, expect, it } from 'vitest';
import { describeQuality, tierName } from './quality.js';

describe('quality copy', () => {
  it('names the three tiers and nothing else', () => {
    expect(tierName('low')).toBe('Low');
    expect(tierName('medium')).toBe('Medium');
    expect(tierName('high')).toBe('High');
    expect(tierName(null)).toBe('');
    expect(tierName('ultra')).toBe('');
  });

  it('Auto says what it does: picks for the device and may lower it', () => {
    const d = describeQuality({ setting: null, running: 'medium', live: false });
    expect(d.headline).toBe('Auto');
    expect(d.running).toBe('Medium');
    expect(d.lines[0]).toMatch(/Auto picks/);
    expect(d.lines[0]).toMatch(/Medium right now/);
    expect(d.lines[0]).toMatch(/lowers it/);
    expect(d.reload).toBe(false);
  });

  it('a changed choice needs a reload when the renderer cannot switch live, and says so', () => {
    const d = describeQuality({ setting: 'high', running: 'medium', live: false, booted: null });
    expect(d.reload).toBe(true);
    expect(d.lines.join(' ')).toMatch(/after you reload/);
    expect(d.lines[0]).toMatch(/High is your choice/);
    expect(d.lines[0]).toMatch(/Running at Medium/);
  });

  it('going back to the choice the game started with cancels the reload', () => {
    expect(describeQuality({ setting: 'low', running: 'low', live: false, booted: 'low' }).reload).toBe(false);
    expect(describeQuality({ setting: null, running: 'low', live: false, booted: null }).reload).toBe(false);
  });

  it('never asks for a reload when the renderer switches live', () => {
    const d = describeQuality({ setting: 'high', running: 'high', live: true, booted: null });
    expect(d.reload).toBe(false);
    expect(d.lines.join(' ')).toMatch(/straight away/);
  });

  it('has a one-line note for the start screen that matches the long text', () => {
    expect(describeQuality({ setting: null, running: 'low' }).note).toBe('Auto picked Low for this device and lowers it if the frame rate drops.');
    expect(describeQuality({ setting: 'high', running: 'high', live: true }).note).toMatch(/^High: .*step down/);
    expect(describeQuality({ setting: 'high', running: 'low', booted: null }).note).toBe('Applies after you reload the page.');
  });

  it('an unchanged saved choice with no renderer info is still honest', () => {
    const d = describeQuality({});
    expect(d.headline).toBe('Auto');
    expect(d.running).toBe('');
    expect(d.reload).toBe(false);
    expect(d.lines[1]).toMatch(/next time the game loads/);
  });
});
