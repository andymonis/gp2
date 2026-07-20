import type { GameAudio } from './audio-context';
import { buildNoiseBuffer, clamp01 } from './audio-utils';
import { IDLE_RPM, REDLINE_RPM } from './vehicle';

// Procedural engine tone: no recorded/licensed samples, per
// docs/requirements.md §11 - but tuned by ear against a real 1990-era McLaren
// V10 reference clip (analyzed only, never embedded here - see the phase 3
// retrospective for how). That analysis confirmed the *firing*-frequency
// pitch mapping (crankFreq * 5, see below) lands in the right register for
// the "scream" identity of the engine - a real V10 sweeps roughly
// 350Hz-900Hz+, matching this model's 333-1083Hz.
//
// Two playtest rounds since: the first pass sounded shrill/annoying (fixed by
// detuned-unison instead of a hard octave doubling, a noise/rasp layer, and a
// steeper/lower filter ceiling - see the previous retrospective entry). The
// second round said it was still too high-pitched overall and wanted more
// "raw"/exhaust character. Root cause of "still high-pitched": every tonal
// layer up to that point was built off the *firing* frequency (crankFreq*5)
// or a simple half of it - nothing was actually down at the engine's real
// rotational (crank) frequency, which is a full 5x lower and is where an
// engine's actual bass/body content lives. This version adds that as its own
// layer (see BASS below) and rebalances the mix toward it, plus adds a
// firing-synced amplitude-modulated noise pulse for a rawer, more
// "chuffing"/exhaust-pulse character instead of a smooth hiss.
//
// The car is a V10 (see vehicle.ts's Honda RA109E torque curve), and a
// 4-stroke engine fires each cylinder once every 2 revolutions, so it fires
// CYLINDERS/2 = 5 times per revolution - crankFreq = rpm/60, firingFreq =
// crankFreq * FIRING_STROKES_PER_REV.
const CYLINDERS = 10;
const FIRING_STROKES_PER_REV = CYLINDERS / 2;

function crankFrequencyHz(rpm: number): number {
  return rpm / 60;
}

// Seconds; every frequency/gain change below is smoothed over this window
// instead of snapping instantly, avoiding the audible clicks/zipper noise a
// raw value assignment would cause on every RPM-reading frame.
const SMOOTHING_TIME_CONSTANT = 0.05;

// Detuned-unison pair (cents) instead of a hard octave-up copy: adds width/
// richness the way a real engine's cylinder-to-cylinder firing variation
// does, without reinforcing one specific harmonic (an exact octave doubling
// just makes the 2nd/4th/6th harmonics louder than the 3rd/5th, which reads
// as hollow/electronic rather than thick).
const UNISON_DETUNE_CENTS = 7;

// Slow, non-integer-ratio LFOs summed for subtle pitch wobble - breaks up the
// perfectly-locked, robotic quality a raw oscillator has that a real engine
// (with its cylinder-to-cylinder and combustion irregularity) never does.
const WOBBLE_HZ_A = 2.7;
const WOBBLE_HZ_B = 4.3;
const WOBBLE_DEPTH = 0.006; // fraction of frequency, e.g. 0.006 = +/-0.6%

function pitchWobble(t: number): number {
  return (Math.sin(2 * Math.PI * WOBBLE_HZ_A * t) + Math.sin(2 * Math.PI * WOBBLE_HZ_B * t)) * 0.5 * WOBBLE_DEPTH;
}

// Asymmetric soft clip (harder on the positive half than the negative) rather
// than a symmetric tanh: symmetric clipping only adds odd harmonics, which
// stays comparatively "clean"; the asymmetry adds even harmonics too, which
// reads as grittier/rawer - closer to an overdriven exhaust signal than a
// polite limiter.
function buildRawExhaustCurve(): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = x >= 0 ? Math.tanh(x * 2.6) : Math.tanh(x * 1.6);
  }
  return curve;
}

export class EngineAudio {
  private ctx: AudioContext;
  private masterGain: GainNode;
  private filterStage1: BiquadFilterNode;
  private filterStage2: BiquadFilterNode;
  private oscA: OscillatorNode; // sawtooth, detuned slightly flat - firing/"scream" tone
  private oscB: OscillatorNode; // sawtooth, detuned slightly sharp - firing/"scream" tone
  private toneGain: GainNode; // shared gain for oscA+oscB
  private bass: OscillatorNode; // true crank frequency - real low-end body/weight
  private bassGain: GainNode;
  private body: OscillatorNode; // one octave above bass - fills in the low-mid
  private bodyGain: GainNode;
  private noise: AudioBufferSourceNode;
  private noiseFilter: BiquadFilterNode;
  private noiseGain: GainNode;
  private exhaustPulse: OscillatorNode; // gates the noise layer at firing rate for a raw "chuffing" pulse
  private exhaustPulseDepth: GainNode;

  constructor(game: GameAudio) {
    this.ctx = game.ctx;

    const shaper = this.ctx.createWaveShaper();
    shaper.curve = buildRawExhaustCurve();

    // Two cascaded lowpass stages (~24dB/oct combined, vs. a single stage's
    // 12dB/oct) with a ceiling pulled down further than the previous pass
    // (was up to ~4700/5700Hz; now ~3400/4050Hz) - less top-end brightness,
    // consistent with the "more bassy" request.
    this.filterStage1 = this.ctx.createBiquadFilter();
    this.filterStage1.type = 'lowpass';
    this.filterStage1.Q.value = 0.6;
    this.filterStage2 = this.ctx.createBiquadFilter();
    this.filterStage2.type = 'lowpass';
    this.filterStage2.Q.value = 0.6;
    this.filterStage1.connect(this.filterStage2);
    this.filterStage2.connect(shaper);

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0;
    shaper.connect(this.masterGain);
    this.masterGain.connect(game.destination);

    const startCrank = crankFrequencyHz(IDLE_RPM);
    const startFiring = startCrank * FIRING_STROKES_PER_REV;

    this.oscA = this.ctx.createOscillator();
    this.oscA.type = 'sawtooth';
    this.oscA.frequency.value = startFiring;
    this.oscA.detune.value = -UNISON_DETUNE_CENTS;
    this.oscB = this.ctx.createOscillator();
    this.oscB.type = 'sawtooth';
    this.oscB.frequency.value = startFiring;
    this.oscB.detune.value = UNISON_DETUNE_CENTS;
    this.toneGain = this.ctx.createGain();
    this.toneGain.gain.value = 0.3;
    this.oscA.connect(this.toneGain);
    this.oscB.connect(this.toneGain);
    this.toneGain.connect(this.filterStage1);

    // True engine rotational frequency (5x lower than the firing tone above)
    // - this is where a real engine's actual bass/weight lives. Triangle
    // rather than sine: a little harmonic content without being harsh, so it
    // reads as a low growl rather than a pure sub-bass tone.
    this.bass = this.ctx.createOscillator();
    this.bass.type = 'triangle';
    this.bass.frequency.value = startCrank;
    this.bassGain = this.ctx.createGain();
    this.bassGain.gain.value = 0.6;
    this.bass.connect(this.bassGain).connect(this.filterStage1);

    this.body = this.ctx.createOscillator();
    this.body.type = 'sawtooth';
    this.body.frequency.value = startCrank * 2;
    this.bodyGain = this.ctx.createGain();
    this.bodyGain.gain.value = 0.4;
    this.body.connect(this.bodyGain).connect(this.filterStage1);

    // Broadband exhaust rasp/turbulence texture - the real reference clip's
    // spectrum was never just clean tonal partials the way pure oscillators
    // are. Centered lower than the first pass (was firingFreq*2, quite
    // bright/hissy; now firingFreq*0.8, more of a low-mid rasp).
    this.noise = this.ctx.createBufferSource();
    this.noise.buffer = buildNoiseBuffer(this.ctx);
    this.noise.loop = true;
    this.noiseFilter = this.ctx.createBiquadFilter();
    this.noiseFilter.type = 'bandpass';
    this.noiseFilter.frequency.value = startFiring * 0.8;
    this.noiseFilter.Q.value = 0.6;
    this.noiseGain = this.ctx.createGain();
    this.noiseGain.gain.value = 0;
    this.noise.connect(this.noiseFilter).connect(this.noiseGain).connect(this.filterStage1);

    // Gates the noise layer's gain at the firing rate (audio-rate modulation
    // of an AudioParam, summed with noiseGain's own base value) - turns a
    // smooth hiss into a pulsing "chuffing" texture synced to cylinder
    // firing, the actual raw/exhaust character asked for rather than just
    // more distortion.
    this.exhaustPulse = this.ctx.createOscillator();
    this.exhaustPulse.type = 'square';
    this.exhaustPulse.frequency.value = startFiring;
    this.exhaustPulseDepth = this.ctx.createGain();
    this.exhaustPulseDepth.gain.value = 0;
    this.exhaustPulse.connect(this.exhaustPulseDepth).connect(this.noiseGain.gain);

    this.oscA.start();
    this.oscB.start();
    this.bass.start();
    this.body.start();
    this.noise.start();
    this.exhaustPulse.start();
  }

  /** For scripted/headless verification only (see main.ts's debugHandle). */
  getDebugState() {
    return {
      contextState: this.ctx.state,
      masterGain: this.masterGain.gain.value,
      fundamentalHz: this.oscA.frequency.value,
      bassHz: this.bass.frequency.value,
    };
  }

  /** Called once per rendered frame with the latest vehicle telemetry. */
  update(rpm: number, throttle: number) {
    const now = this.ctx.currentTime;
    const wobble = 1 + pitchWobble(now);
    const crankFreq = crankFrequencyHz(rpm) * wobble;
    const firingFreq = crankFreq * FIRING_STROKES_PER_REV;
    const rpmFraction = clamp01((rpm - IDLE_RPM) / (REDLINE_RPM - IDLE_RPM));

    this.oscA.frequency.setTargetAtTime(firingFreq, now, SMOOTHING_TIME_CONSTANT);
    this.oscB.frequency.setTargetAtTime(firingFreq, now, SMOOTHING_TIME_CONSTANT);
    this.bass.frequency.setTargetAtTime(crankFreq, now, SMOOTHING_TIME_CONSTANT);
    this.body.frequency.setTargetAtTime(crankFreq * 2, now, SMOOTHING_TIME_CONSTANT);
    this.exhaustPulse.frequency.setTargetAtTime(firingFreq, now, SMOOTHING_TIME_CONSTANT);

    // Bass stays present throughout (only a mild taper at high rpm) rather
    // than fading out the way the old "sub" layer did - that persistence is
    // what actually reads as "bassy" rather than just a low note at idle.
    this.bassGain.gain.setTargetAtTime(0.6 - 0.15 * rpmFraction, now, SMOOTHING_TIME_CONSTANT);
    this.bodyGain.gain.setTargetAtTime(0.45 - 0.2 * rpmFraction, now, SMOOTHING_TIME_CONSTANT);

    const noiseBase = 0.07 + 0.2 * throttle;
    this.noiseGain.gain.setTargetAtTime(noiseBase, now, SMOOTHING_TIME_CONSTANT);
    this.exhaustPulseDepth.gain.setTargetAtTime(noiseBase * 0.7, now, SMOOTHING_TIME_CONSTANT);
    this.noiseFilter.frequency.setTargetAtTime(firingFreq * 0.8, now, SMOOTHING_TIME_CONSTANT);

    // Ceiling pulled down further than the previous pass (see the class
    // comment) - less brightness, more weight in the low end.
    this.filterStage1.frequency.setTargetAtTime(
      450 + rpmFraction * 2000 + throttle * 900,
      now,
      SMOOTHING_TIME_CONSTANT,
    );
    this.filterStage2.frequency.setTargetAtTime(
      650 + rpmFraction * 2400 + throttle * 1000,
      now,
      SMOOTHING_TIME_CONSTANT,
    );

    // Audible at idle (a real idling engine isn't silent) but noticeably
    // louder under throttle - gives the ear feedback for lift-off/braking
    // too, not just for pitch.
    const targetVolume = 0.1 + 0.22 * throttle + 0.06 * rpmFraction;
    this.masterGain.gain.setTargetAtTime(targetVolume, now, SMOOTHING_TIME_CONSTANT);
  }
}
