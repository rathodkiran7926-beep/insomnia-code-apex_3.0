import { afterEach, describe, expect, it, vi } from 'vitest';
import { mentorSpeech } from './mentorSpeech';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('mentor provider speech', () => {
  function audioFixture() {
    const calls: string[] = [];
    class Player extends EventTarget {
      play = vi.fn(async () => {
        calls.push('play');
      });
      pause = vi.fn();
      load = vi.fn();
      removeAttribute = vi.fn();
    }
    vi.stubGlobal('Audio', Player);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:voice');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    return { calls, revoke };
  }

  it('uses provider audio on browsers without streaming and releases it on abort', async () => {
    const { revoke } = audioFixture();
    vi.stubGlobal('MediaSource', undefined);
    const fetch = vi.fn(
      async (_input: RequestInfo | URL, _options?: RequestInit) =>
        new Response(new Uint8Array([1, 2, 3])),
    );
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    let player: HTMLAudioElement | undefined;
    await mentorSpeech('/speech', { voiceId: 'voice' }, controller.signal, (p) => {
      player = p;
    });
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).stream).toBe(false);
    expect(player?.play).toHaveBeenCalledOnce();
    controller.abort();
    expect(player?.pause).toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith('blob:voice');
  });

  it('starts playback before the full provider stream completes', async () => {
    const { calls } = audioFixture();
    class Source extends EventTarget {
      static isTypeSupported() {
        return true;
      }
      readyState = 'open';
      addSourceBuffer() {
        const buffer = new EventTarget() as EventTarget & { appendBuffer: () => void };
        buffer.appendBuffer = () => {
          calls.push('append');
          queueMicrotask(() => buffer.dispatchEvent(new Event('updateend')));
        };
        return buffer;
      }
      endOfStream() {
        calls.push('end');
      }
    }
    vi.stubGlobal('MediaSource', Source);
    vi.mocked(URL.createObjectURL).mockImplementation((media) => {
      setTimeout(() => (media as unknown as Source).dispatchEvent(new Event('sourceopen')), 0);
      return 'blob:stream';
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new Uint8Array([1]));
                controller.enqueue(new Uint8Array([2]));
                controller.close();
              },
            }),
            { headers: { 'X-Voice-Stream': '1' } },
          ),
      ),
    );
    const controller = new AbortController();
    await mentorSpeech('/speech', {}, controller.signal, () => {});
    expect(calls).toEqual(['append', 'play', 'append', 'end']);
    controller.abort();
  });

  it('never attaches audio from a cancelled response or hides provider errors', async () => {
    audioFixture();
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('audio')),
    );
    const attach = vi.fn();
    await expect(mentorSpeech('/speech', {}, controller.signal, attach)).rejects.toThrow(
      'Cancelled',
    );
    expect(attach).not.toHaveBeenCalled();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'Voice quota reached' }, { status: 429 })),
    );
    await expect(mentorSpeech('/speech', {}, new AbortController().signal, attach)).rejects.toThrow(
      'Voice quota reached',
    );
  });
});
