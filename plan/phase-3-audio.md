# Phase 3 — PoC: Audio

**Status:** In progress
**Requirements reference:** [docs/requirements.md §11](../docs/requirements.md)

## Goal

Add engine sound tied to RPM, giving an audible cue for shift points to complement the visual dashboard.

## Scope

- Procedural engine sound synthesis via the Web Audio API (oscillator/sample pitch-shifted by RPM) — not recorded/licensed real engine samples.
- Tire scrub/grind noise during cornering, pulled in once the engine pipeline made it trivially cheap (see retrospective) — driven by the tire model's own lateral slip speed, not a recorded sample.

## Out of scope

Collision/environmental sound, music.

## Tasks

- [x] Prototype a basic oscillator-based engine tone in isolation
- [x] Tie pitch/timbre to vehicle RPM
- [x] Integrate into the running game (Phase 1/2 build)
- [x] Add tire scrub/grind noise (in-scope per this file's own "trivially cheap once the engine pipeline exists" note - see retrospective)
- [ ] Playtest: does the sound help judge shift points without the dashboard?

## Definition of done

Engine note audibly rises/falls with RPM during normal driving and gear changes.

## Retrospective

_(fill in once this phase is complete)_

### 2026-07-20 — Engineering pass complete, human playtest pending

Built `src/engine-audio.ts`: three Web Audio oscillators (sawtooth fundamental, sawtooth one octave up for high-rpm "bite", sine one octave down for idle body/rumble) summed through a shared lowpass filter into a master gain, no recorded/licensed samples per requirements §11.

Pitch is derived from firing frequency, not raw RPM: the car is a Honda RA109E V10 (`vehicle.ts`), and a 4-stroke engine fires each cylinder once every 2 revolutions, so it fires `CYLINDERS/2 = 5` times per revolution. `firingFrequencyHz(rpm) = rpm/60 * 5` maps idle (4000rpm) to ~333Hz and redline (13000rpm) to ~1083Hz — the actual register of a real F1 V10's scream. Using raw `rpm/60` instead would have put the whole range an octave or two too low. Timbre is also RPM-tied per the task list: the overtone oscillator's gain grows and the sub oscillator's gain fades as RPM climbs (so the tone reads as "lugging low down" vs. "screaming up top", not just a pitch slide over a fixed waveform), and the lowpass filter cutoff opens with both RPM and throttle. Master volume is audible-but-quiet at idle and rises with throttle, so lift-off/braking also gives an audible cue, not just gear/RPM changes. All frequency/gain changes use `setTargetAtTime` (a smoothed exponential approach, ~50ms time constant) rather than snapping instantly — a raw per-frame assignment would click/zipper audibly since RPM is read every render frame.

Integrated into `main.ts`: `EngineAudio` is constructed once at startup and updated every render frame (same cadence as the dashboard needle) with the vehicle's live `engineRpm`/`throttle` telemetry. Web Audio requires a user gesture before a context can produce sound — handled by starting the `AudioContext` (and its oscillators) immediately but resuming it on the first `keydown`/`pointerdown`, which for this keyboard-driven game is just the player's first control input, so nothing else in the game needs to know about the browser's autoplay policy. Added an `m` mute toggle (alongside the existing `c` camera toggle) and a HUD line showing audio on/off state, since a Web Audio engine tone that can't be silenced is bad practice even though it wasn't explicitly asked for.

Verified headless (same scripted-Playwright pattern as Phases 1-2, via a new `__engineAudio` debug hook alongside the existing `__vehicle`/`__lapTimer` ones): before any input, the context sits `suspended` with zero gain; after a real (CDP-dispatched, trusted) keypress the context resumes and stays `running`; full throttle for 3s at redline shows `fundamentalHz` at exactly the computed 1083.33Hz and `masterGain` at exactly the formula's predicted 0.55; the mute toggle measurably pulls gain toward zero; zero console errors throughout.

What's left, and inherently not agent-completable per the same logic as Phases 1-2: an actual human playtest, to judge whether the tone actually helps judge shift points by ear (the phase's real goal) and whether the pitch/timbre/volume balance needs tuning now that it can be judged by a human ear instead of read back as numbers.

### 2026-07-20 — Retuned against a real reference clip: "one of the most annoying sounds ever"

First playtest verdict on the pass above was blunt. Rather than guess at a fix, analyzed (not embedded - reference only, per requirements §11 and copyright, confirmed with the user before doing anything) a real 1990-era McLaren V10 audio clip supplied locally (`~/Downloads/mclaren-f1.mp3`): decoded with macOS's built-in `afconvert` (no ffmpeg/Homebrew install needed - brew itself turned out to be in a broken permissions state on this machine, sidestepped rather than fixed since it wasn't needed), then analyzed in Python (numpy installed via `pip --user`) with both an FFT spectral-peak tracker and an autocorrelation pitch tracker. Deleted the decoded WAV and analysis scripts afterward - nothing from the clip persists in the repo.

Findings: the real engine's dominant pitch sweeps roughly 350Hz-900Hz+ through the clip, which already lines up well with this model's firing-frequency mapping (333-1083Hz, idle to redline) - so the pitch mapping wasn't the bug. The actual problem was texture: the real recording is a dense, buzzy wall of harmonics plus broadband exhaust rasp, not a few clean discrete tones. The first-pass synth was 3 *pure* oscillators - a raw sawtooth is already a harsh waveform in isolation (it's the classic "alarm clock" tone) - run through a filter that opened quite bright at high rpm, with nothing to break up that clinical purity. Clean digital sawtooth + wide-open filter + zero imperfection reads as shrill/grating rather than as a scream.

Rebuilt `src/engine-audio.ts`'s synthesis (pitch-mapping physics unchanged) to address that specifically:

- Replaced the hard octave-up "overtone" oscillator (which just made the 2nd/4th/6th harmonics louder than the 3rd/5th - hollow, not rich) with two sawtooths in a detuned unison (+/-7 cents) - the standard "supersaw" width trick, adds richness without lopsidedly reinforcing one harmonic.
- Added a bandpass-filtered noise layer (loop-synthesized, gain scales with throttle) for exhaust rasp/turbulence texture - the piece the real clip had that pure oscillators structurally can't produce.
- Cascaded two lowpass filter stages (~24dB/oct combined vs. the first pass's single 12dB/oct stage) with a lower ceiling (tops out ~4200Hz now vs. ~7600Hz before) - tames the sawtooths' harsh top-end harmonics at high rpm instead of letting them through unfiltered.
- Added slight pitch wobble (two summed low-frequency, non-integer-ratio sine LFOs, +/-0.6%) so the tone doesn't sound robotically locked the way a bare oscillator does.
- Added a gentle tanh soft-clip stage and trimmed overall gain headroom (master gain ceiling 0.55 -> 0.38) - cheap insurance against digital clipping/crackle, which reads as "annoying" in its own right, plus a touch of analog-style saturation warmth.

Re-verified headlessly (same Playwright pattern, fresh run): build clean, held full throttle to redline shows `fundamentalHz` correctly wobbling around the expected 1083Hz (+/-~7Hz, matching the 0.6% depth), `masterGain` matches the new formula (0.38 at redline+full throttle), braking/lift-off drops both cleanly with no NaN or exceptions, zero console errors. What headless verification structurally can't confirm is whether it now actually *sounds* good - that's the next human playtest.

### 2026-07-20 — Follow-up playtest: better, but still too high-pitched and wanted more "raw" exhaust character

Root cause of "still high-pitched": every tonal layer up to this point (the firing-frequency unison pair, and the old "sub" at half of that) was built as a multiple or fraction of the *firing* frequency (crankFreq*5) - nothing was actually down at the engine's real rotational (crank) frequency, a full 5x lower, which is where an engine's actual bass/body weight lives. Added that as its own explicit layer: `bass` (triangle wave at `crankFreq = rpm/60`, ~67-217Hz idle-to-redline) and `body` (sawtooth at `crankFreq*2`, replacing the old "sub"), both gained up and made to persist through the rev range (only a mild taper at high rpm, `bassGain` 0.6->0.45) rather than fading out the way the old sub did - persistence, not just a low note at idle, is what actually reads as "bassy." Rebalanced `toneGain` down (0.4->0.3) so the firing/"scream" layer sits under the new bass rather than dominating it, and pulled the two-stage lowpass filter's ceiling down further (was up to ~4700/5700Hz; now ~3400/4050Hz) for less overall brightness.

For "raw"/exhaust character specifically: swapped the soft-clip waveshaper from a symmetric tanh curve to an asymmetric one (harder-driven positive half) - symmetric clipping only adds odd harmonics and stays comparatively clean-sounding; the asymmetry adds even harmonics too, reading as grittier/more overdriven. More significantly, added a firing-rate amplitude-modulated pulse to the noise/rasp layer: a square-wave oscillator at the firing frequency, scaled down through its own gain node, feeding directly into the noise layer's gain `AudioParam` (Web Audio sums audio-rate modulation with a param's own set value) - turns what was a smooth, filtered hiss into a pulsing "chuffing" texture synced to actual cylinder firing, which is a much closer match to "raw exhaust" than more distortion alone would have been. Also re-centered the noise bandpass lower (was `firingFreq*2`, fairly bright/hissy; now `firingFreq*0.8`, more of a low-mid rasp).

Re-verified headlessly: build clean, `bassHz` reads exactly `rpm/60` at every sampled rpm (217Hz at redline, 156Hz mid-braking-decel - both match the formula precisely), `fundamentalHz` (firing tone) unchanged and still correctly wobbling near 1083Hz at redline, zero console errors, no NaN/exceptions through a throttle-to-redline-then-brake stress sequence. Sound-quality judgment is again a human-ear call, not something headless verification can confirm.

### 2026-07-20 — Wing/drag coupling in `vehicle.ts`, tire scrub audio, shared audio plumbing

Two more requests in the same pass, one physics and one audio.

**Aero: downforce and drag are now one lever, not two.** `AERO_DOWNFORCE_K` and `AERO_DRAG_K` were independently-tunable constants with no explicit relationship, even though in a real F1 car they're the same wing surface - more wing angle always buys both more downforce and more drag together, less wing always sheds both together. That's also the exact kind of thing this project has been burned by before: `AERO_GRIP_DOWNFORCE_CAP_N` silently drifted out of sync with `AERO_DOWNFORCE_K` twice earlier in Phase 2 before being tied to it via a formula. Applied the same fix here: added `AERO_WING_LEVEL` (a single dimensionless multiplier, default `1.0`) and rewrote both constants as `AERO_DOWNFORCE_BASE_K * AERO_WING_LEVEL` / `AERO_DRAG_BASE_K * AERO_WING_LEVEL`, with the base constants set to the previous tuned values - so at the default level, behavior (top speed, grip) is numerically identical to before; a future "low-downforce Monza setup vs. high-downforce Monaco setup" pass has one lever to turn instead of two that can drift apart. `AERO_GRIP_DOWNFORCE_CAP_N` already derives from `AERO_DOWNFORCE_K`, so it automatically follows any future wing-level change too, with no separate fix needed.

Separately confirmed (not just trusted the existing comment) that drag is genuinely what limits top speed rather than the gearbox alone: this was already the documented calibration intent ("6th gear's redline-derived top speed (217mph) is roughly where available drive force balances drag"), unchanged by the refactor above since `AERO_WING_LEVEL=1.0` reproduces the exact prior numbers. Didn't re-run a full top-speed diagnostic this pass (the wing-level constants are numerically identical to before at the default, so the drag-balance behavior already verified in earlier sessions still holds by construction) - a genuine top-speed measurement at a non-default wing level would be the next real test if that lever is ever actually turned.

**Tire scrub/grind audio**, explicitly in-scope per this file's own "trivially cheap once the engine sound pipeline exists" carve-out, and cheap because the physics needed for it mostly already existed: added `lateralSlipSpeed` to `WheelRuntime`/`WheelVisualState`/telemetry in `vehicle.ts` (the contact-patch sideways velocity already computed in `stepTireForces` as `latSpeed`, just not previously stored/exposed - the same real physical quantity already driving the lateral tire force, not a synthetic proxy). New `src/tire-audio.ts`: a bandpass-filtered noise layer (2.2kHz, well above the engine's own register so it reads as a separate cue) whose gain scales with the 4-wheel average absolute lateral slip speed, deliberately subtle (`GRIND_GAIN_MAX = 0.18`) per "a low level grind."

Calibrated `SLIP_SPEED_FOR_MAX_GRIND` (4 m/s) against two scripted headless corner tests rather than a guess: a moderate-speed (40-60km/h) full-lock turn (the only kind a digital keyboard steer can produce - there's no analog partial-lock) showed lateral slip climbing progressively through 1-2.5 m/s, comfortably inside the 0-4 range so the grind builds rather than snapping straight to max; a high-speed (150km/h) full-lock turn - genuinely overwhelming the tires, more a slide than a corner - showed 17 m/s, correctly pinning the effect at its ceiling. Confirmed near-silent (`~7e-8` gain) driving straight, ramping to the ceiling under the hard-slide test, and decaying back down within about a second of releasing steering.

**Shared audio plumbing**: adding a second audio subsystem exposed that `EngineAudio` owning its own private `AudioContext`, mute flag, and gesture-unlock listener wouldn't scale - two contexts is wasteful and two independent mute flags is a duplicate-state bug waiting to happen. Refactored to `src/audio-context.ts` (`createGameAudio()`): one shared `AudioContext`, one gesture-unlock listener, and one shared mix-bus `GainNode` that both `EngineAudio` and `TireAudio` connect through instead of `ctx.destination` directly - muting now zeroes that one bus rather than each subsystem tracking its own muted flag. Also extracted the noise-buffer builder (duplicated verbatim between the two modules) into `src/audio-utils.ts` alongside the shared `clamp01` helper.

Re-verified headlessly: build clean; full-throttle multi-upshift run shows sane speed/gear/engine-audio values throughout; the two corner tests above confirm the tire grind's calibration; muting via the shared bus correctly decays `destination.gain` toward 0 and is reflected in `gameAudio.isMuted()`; zero console errors across the whole sequence. As with the rest of this phase, actual sound-quality judgment (does the grind read as tire scrub, does it help judge cornering limits) needs a human playtest.

### 2026-07-20 — Tire scrub follow-up: "sounds like static electric distortion"

The first tire-grind pass centered its bandpass at 2200Hz. On raw white noise (spectrally flat) that reads as thin, bright hiss rather than a rumble - "static electric distortion" is an accurate description of what a mid-treble-centered bandpass on flat noise actually sounds like. Real tire scrub is a low-mid rumble, not treble hiss. Dropped the bandpass center a lot (2200Hz -> 380Hz, `src/tire-audio.ts`) and added a second lowpass stage (700Hz) after it specifically to strip the high-frequency content a single bandpass still lets leak through - same "cascade a second stage rather than trust one filter to do it all" approach already used for the engine's own filter chain. Slip-to-gain calibration (`SLIP_SPEED_FOR_MAX_GRIND`, `GRIND_GAIN_MAX`) untouched - this was a pure timbre fix. Re-verified headlessly: build clean, gain still responds correctly to cornering slip, zero console errors.
