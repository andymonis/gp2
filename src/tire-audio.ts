import type { GameAudio } from './audio-context';
import { buildNoiseBuffer, clamp01 } from './audio-utils';

// Low-level tire scrub/grind: a filtered noise layer whose gain tracks how
// fast the tire contact patch is actually sliding sideways (lateralSlipSpeed
// from vehicle.ts's tire model - the real physical quantity, not a synthetic
// proxy). Deliberately subtle ("a low level grind", per the request).
//
// First pass centered the bandpass at 2200Hz, which on raw (spectrally flat)
// white noise reads as thin, bright hiss - "static electric distortion"
// rather than scrub. Real tire scrub is a low-mid rumble, not a treble hiss:
// dropped the bandpass center a lot (2200Hz -> 380Hz) and added a lowpass
// stage after it specifically to strip the noise's own high-frequency content
// that a bandpass alone still lets leak through.
const SLIP_SPEED_FOR_MAX_GRIND = 4; // m/s of lateral slip - see the phase 3 retrospective for how this was calibrated
const GRIND_GAIN_MAX = 0.18;

export class TireAudio {
  private ctx: AudioContext;
  private noise: AudioBufferSourceNode;
  private bandpass: BiquadFilterNode;
  private lowpass: BiquadFilterNode;
  private gain: GainNode;

  constructor(game: GameAudio) {
    this.ctx = game.ctx;

    this.noise = this.ctx.createBufferSource();
    this.noise.buffer = buildNoiseBuffer(this.ctx);
    this.noise.loop = true;

    this.bandpass = this.ctx.createBiquadFilter();
    this.bandpass.type = 'bandpass';
    this.bandpass.frequency.value = 380; // low-mid rumble register, not treble hiss
    this.bandpass.Q.value = 0.9;

    this.lowpass = this.ctx.createBiquadFilter();
    this.lowpass.type = 'lowpass';
    this.lowpass.frequency.value = 700; // strips the bandpass's remaining high-frequency leak-through
    this.lowpass.Q.value = 0.6;

    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0;

    this.noise.connect(this.bandpass).connect(this.lowpass).connect(this.gain).connect(game.destination);
    this.noise.start();
  }

  /** Called once per rendered frame with the average absolute lateral slip speed (m/s) across all 4 wheels. */
  update(avgLateralSlipSpeed: number) {
    const now = this.ctx.currentTime;
    const intensity = clamp01(avgLateralSlipSpeed / SLIP_SPEED_FOR_MAX_GRIND);
    this.gain.gain.setTargetAtTime(intensity * GRIND_GAIN_MAX, now, 0.05);
  }

  /** For scripted/headless verification only (see main.ts's debugHandle). */
  getDebugState() {
    return { gain: this.gain.gain.value };
  }
}
