import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const key = 'wipe-cause:replay-prefs';
let storage: Map<string, string>;

beforeEach(() => {
  vi.resetModules();
  storage = new Map();
  vi.stubGlobal('localStorage', { getItem: (name: string) => storage.get(name) ?? null, setItem: (name: string, value: string) => storage.set(name, value) });
});
afterEach(() => vi.unstubAllGlobals());

describe('replay ground defaults', () => {
  it('hides Noxious Ground in a fresh installation', async () => {
    const prefs = await import('./replayPrefs');
    expect([...prefs.hiddenGround()]).toEqual(['noxious_ground']);
  });
  it('applies the new default to existing preferences without resetting other choices', async () => {
    storage.set(key, JSON.stringify({ hiddenGround: ['pool'], hiddenAreas: ['orb:1'], showMarkers: false }));
    const prefs = await import('./replayPrefs');
    expect([...prefs.hiddenGround()]).toEqual(['pool', 'noxious_ground']);
    expect([...prefs.hiddenAreas()]).toEqual(['orb:1']);
    expect(prefs.showMarkers()).toBe(false);
  });
  it('remembers an explicit choice to enable Noxious Ground', async () => {
    const prefs = await import('./replayPrefs');
    prefs.setHiddenGround(new Set());
    vi.resetModules();
    const reloaded = await import('./replayPrefs');
    expect(reloaded.hiddenGround().has('noxious_ground')).toBe(false);
  });
});
