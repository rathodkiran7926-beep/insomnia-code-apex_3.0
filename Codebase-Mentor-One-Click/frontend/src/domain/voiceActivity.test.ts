import { describe, expect, it } from 'vitest';
import { voiceActivity } from './voiceActivity';

describe('voice activity', () => {
  it('never submits silence or a brief click', () => {
    const detect = voiceActivity();
    expect(detect(0.1, 80).finished).toBe(false);
    for (let now = 160; now <= 60000; now += 80) expect(detect(0, now).finished).toBe(false);
  });
  it('waits through short pauses and finishes after sustained speech and silence', () => {
    const detect = voiceActivity();
    for (let now = 80; now <= 800; now += 80) detect(0.05, now);
    expect(detect(0, 1500).finished).toBe(false);
    expect(detect(0.05, 1600).finished).toBe(false);
    expect(detect(0, 2900).finished).toBe(false);
    expect(detect(0, 3100)).toEqual({ heardSpeech: true, finished: true });
  });
});
