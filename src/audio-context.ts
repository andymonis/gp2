// Shared Web Audio plumbing for every audio subsystem (engine, tires, ...) so
// there's exactly one AudioContext, one autoplay-gesture unlock, and one mute
// switch for the whole game instead of each subsystem duplicating them.
export interface GameAudio {
  ctx: AudioContext;
  /** Shared mix bus - subsystems connect their output here instead of ctx.destination directly. */
  destination: GainNode;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
}

export function createGameAudio(): GameAudio {
  const ctx = new AudioContext();
  const destination = ctx.createGain();
  destination.gain.value = 1;
  destination.connect(ctx.destination);

  let muted = false;

  // Web Audio contexts start (or become) suspended until a user gesture -
  // this game is keyboard/mouse-only, so the first keydown/pointerdown IS
  // that gesture. Resuming on it here means no subsystem needs to know or
  // care about the browser's autoplay policy.
  const resumeOnce = () => {
    if (ctx.state === 'suspended') void ctx.resume();
  };
  window.addEventListener('keydown', resumeOnce, { once: true });
  window.addEventListener('pointerdown', resumeOnce, { once: true });

  return {
    ctx,
    destination,
    setMuted(m: boolean) {
      muted = m;
      destination.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.05);
    },
    isMuted() {
      return muted;
    },
  };
}
