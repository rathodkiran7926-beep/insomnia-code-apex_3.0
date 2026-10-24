// Play provider audio as it arrives. Unsupported browsers use the same provider
// recording; never substitute speechSynthesis voices.
export async function mentorSpeech(
  path: string,
  body: unknown,
  signal: AbortSignal,
  attach: (player: HTMLAudioElement) => void,
): Promise<void> {
  const streaming = typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported('audio/mpeg');
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...(body as object), stream: streaming }),
    signal,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Voice is unavailable. Your text answer is still available.');
  }
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  // Content type also permits provider fixtures and non-MP3 formats to play normally.
  const useStream = streaming && response.body && response.headers.get('X-Voice-Stream') === '1';
  const media = useStream ? new MediaSource() : null;
  const url = URL.createObjectURL(media || (await response.blob()));
  const player = new Audio(url);
  const release = () => {
    player.pause();
    player.removeAttribute('src');
    player.load();
    URL.revokeObjectURL(url);
    signal.removeEventListener('abort', release);
  };
  signal.addEventListener('abort', release, { once: true });
  player.addEventListener('ended', release, { once: true });
  player.addEventListener('error', release, { once: true });
  try {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    attach(player);
    if (!media) {
      await player.play();
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const abort = () => reject(new DOMException('Cancelled', 'AbortError'));
      signal.addEventListener('abort', abort, { once: true });
      media.addEventListener(
        'sourceopen',
        () => {
          signal.removeEventListener('abort', abort);
          resolve();
        },
        { once: true },
      );
    });
    const buffer = media.addSourceBuffer('audio/mpeg');
    const reader = response.body!.getReader();
    let started = false;
    let playback: Promise<void> | undefined;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            buffer.removeEventListener('updateend', complete);
            buffer.removeEventListener('error', fail);
            signal.removeEventListener('abort', abort);
          };
          const complete = () => {
            cleanup();
            resolve();
          };
          const fail = () => {
            cleanup();
            reject(new Error('Voice playback failed. Retry or read the answer.'));
          };
          const abort = () => {
            cleanup();
            reject(new DOMException('Cancelled', 'AbortError'));
          };
          buffer.addEventListener('updateend', complete, { once: true });
          buffer.addEventListener('error', fail, { once: true });
          signal.addEventListener('abort', abort, { once: true });
          try {
            buffer.appendBuffer(value);
          } catch (e) {
            cleanup();
            reject(e);
          }
        });
        if (!started) {
          started = true;
          // Keep feeding chunks while the media element buffers enough to play.
          playback = player.play();
          void playback.catch(() => reader.cancel().catch(() => {}));
        }
      }
      if (!started) throw new Error('The voice service returned no audio.');
      if (media.readyState === 'open') media.endOfStream();
      await playback;
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  } catch (error) {
    release();
    throw error;
  }
}
