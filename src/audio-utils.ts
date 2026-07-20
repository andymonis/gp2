export function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/** Looping white-noise buffer - the raw material for any texture/rasp layer. */
export function buildNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const length = ctx.sampleRate * 2;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}
