// Require sustained sound, then a natural pause; silence alone never submits a turn.
export function voiceActivity() {
  let speechMs = 0;
  let lastSound = 0;
  let previous = 0;
  return (level: number, now: number) => {
    const elapsed = previous ? Math.min(200, now - previous) : 0;
    previous = now;
    if (level >= 0.018) {
      speechMs += elapsed;
      lastSound = now;
    }
    return { heardSpeech: speechMs >= 250, finished: speechMs >= 250 && now - lastSound >= 1000 };
  };
}
