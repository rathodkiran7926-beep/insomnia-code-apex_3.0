import { afterEach, describe, expect, it, vi } from 'vitest';
import { readGuestProgress, saveGuestProgress } from './journeyProgress';
import type { JourneyCheckpoint } from '../domain/codeJourney';

afterEach(() => vi.unstubAllGlobals());

describe('guest journey progress recovery', () => {
  it('discards malformed entries without losing valid saved cursors or completed paths', () => {
    const saved: JourneyCheckpoint = {
      journeyId: 'signup',
      scenarioId: 'success',
      traceId: 'trace',
      snapshotId: 'source',
      eventId: 'last',
      level: 'beginner',
      visited: ['first', 'last'],
      predictions: {},
      completed: true,
      updatedAt: '2026-10-24T00:00:00.000Z',
    };
    let value = JSON.stringify({ signup: saved, broken: { visited: null }, wrongId: saved });
    vi.stubGlobal('localStorage', {
      getItem: () => value,
      setItem: (_key: string, next: string) => {
        value = next;
      },
    });
    expect(readGuestProgress()).toEqual({ signup: saved });
    saveGuestProgress({ ...saved, scenarioId: 'invalid', eventId: 'first', completed: false });
    expect(readGuestProgress().signup.completedScenarios).toEqual(['success']);
    value = 'null';
    expect(readGuestProgress()).toEqual({});
    value = '{invalid';
    expect(readGuestProgress()).toEqual({});
  });
});
