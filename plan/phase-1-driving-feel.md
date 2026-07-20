# Phase 1 — PoC: Driving Feel

**Status:** Done
**Requirements reference:** [docs/requirements.md §5, §6, §7](../docs/requirements.md)

## Goal

Validate that the physics + controls + camera combination actually *feels* like a dangerous, powerful, manual-gearbox 1990 F1 car — before investing in track content, opponents, or polish. This is expected to be the highest-iteration phase; "feel" is subjective and will likely take several tuning passes.

## Scope

- One low-poly car (~100–300 polys) on a flat open plane (grid or a few markers for scale reference — not a real track).
- Rapier-driven vehicle model: mass, weight transfer, momentum/inertia, collision response.
- Grip-circle model governing combined lateral/longitudinal grip per tire.
- Sequential manual gearbox, no clutch modeling for normal shifts.
- Clutch modeled only for standing starts (rev without stalling, release to launch).
- Full control scheme, all inputs ramped (not instant):

  | Key | Action |
  |---|---|
  | `z` | Turn left |
  | `x` | Turn right |
  | `'` | Accelerate |
  | `/` | Brake |
  | `space` | Gear up if accelerating, gear down otherwise |
  | `shift` | Engage clutch |

- Cockpit camera (first-person driver view).
- Low-poly 3D dashboard modeled into the cockpit: rev counter needle + gear-number indicator.

## Out of scope

Real track/circuit, lap timing, sound, AI opponents, ghost replay, 2D HUD, driving aids.

## Tasks

- [x] Build/import a simple low-poly car model (~100–300 polys)
- [x] Flat plane ground with scale-reference markers
- [x] Rapier rigid body + wheel/vehicle setup for the car
- [x] Implement grip-circle grip model
- [x] Implement ramped input handling for steer/throttle/brake
- [x] Implement sequential gearbox state machine (space = context-sensitive up/down)
- [x] Implement clutch state (shift key) for standing starts
- [x] Cockpit camera rig attached to car
- [x] Model low-poly dashboard geometry (rev needle + gear indicator) driven by vehicle state
- [x] Playtest and tune grip-circle parameters until the car feels right (twitchy, powerful, easy to spin) — needs a human behind the keyboard; functional correctness is scripted/verified but "feel" isn't

## Definition of done

The car can be driven around the flat plane, launched from a standing start using the clutch, shifted up/down sequentially, and spun out under excessive input — and it *feels* right when driven.

## Retrospective

All engineering tasks are implemented and verified by scripted headless playtest (Playwright driving a real keyboard sequence against the built app, not unit tests): standing start holds still while revving to redline, launch on clutch release, sequential up/down shifts, and a hard-steer-plus-throttle spin producing real yaw rate and wheel lift — all with zero console errors, checked at every step of implementation rather than only at the end.

One serious bug surfaced during that verification and needed a real debugging pass, not just a fix-on-sight: Rapier's `addForce`/`addForceAtPoint` accumulate into a **persistent** per-body force that keeps being applied every subsequent step until explicitly cleared with `resetForces()`/`resetTorques()`. Without that reset, every frame's suspension and tire forces stacked on top of all previous frames, and the car silently launched itself into orbit a fraction of a second after spawning. Caught via scripted telemetry (speed reading 88+ km/h before any input existed) rather than by eyeballing the render, then root-caused with temporary frame-by-frame debug logging rather than guessing at fixes. A secondary, related bug (a suspension-damping spike on the very first ground-contact frame, from diffing compression against stale state) was fixed alongside it, though the persistent-force issue turned out to be the dominant cause.

What's left is inherently not agent-completable: the actual "feel" tuning pass (grip coefficients, suspension stiffness, gear ratios, torque curve) requires a human playing it, per the plan agreed at the start of this phase (plan → code → playtest → iterate, not spec-heavy, since feel is subjective). All tunable constants are grouped at the top of `src/vehicle.ts` for that pass. Camera eye height and dashboard scale/position also needed one visual-inspection correction pass (initial eye height was almost touching the car's own bodywork mesh) — caught via screenshot, not assumption.

### 2026-07-16 — Driving dynamics pass: aero, weight transfer, real wheel sizes, gearing

Promoted aerodynamics/downforce and weight transfer out of the deferred backlog per an explicit request to make the car corner "on rails" and accelerate like a real ground-effect-less-but-winged 1990 car. Added: front/rear wheel radius+width split (real 635mm/660mm diameters), an algebraic per-wheel grip-load model (static share + longitudinal/lateral weight transfer + aero downforce share) decoupled from the suspension's spring force, real aerodynamic drag, an axis-isolated anti-roll/anti-pitch corrective torque, gear ratios recomputed from the target per-gear top speeds, and higher mechanical tire grip. Full derivation and rationale in the session's plan file (`~/.claude/plans/dapper-doodling-catmull.md` at the time).

Scripted verification (same Playwright-against-dev-server approach as above, extended with `rollDeg`/`pitchDeg`/`gripLoad`/`normalLoad`/aero telemetry) surfaced three real, pre-existing-but-newly-exposed bugs, not just constant-tuning misses:

- The engine/clutch integration ran once per outer 60Hz tick while suspension already sub-stepped 4x for stability — but the clutch coupling's effective stiffness (`CLUTCH_MAX_TORQUE_NM` over the deliberately tiny `ENGINE_INERTIA_RPM`) turned out to need sub-step resolution too. Left at outer-tick resolution, engine/wheel rpm repeatedly overshot the "locked" point and chattered between full-drive and full-engine-braking every tick, cutting average launch force roughly in half. Fixed by moving the engine/clutch integration inside the existing substep loop.
- Even sub-stepped, the original `CLUTCH_SLIP_GAIN=10` blew past the discrete-time stability bound (`gain * subDt / ENGINE_INERTIA_RPM < ~2`) and still chattered. Derived the bound directly rather than guessing, and picked a gain just under the smooth-decay threshold (`<~1`) — fast convergence to a genuinely locked state without oscillation.
- `ENGINE_FRICTION_GAIN`, applied unconditionally (not just off-throttle as its name/comment implied), was eating ~60% of peak torque at high rpm once the clutch fix above let it actually reach that regime — silently strangling sustained mid-to-high-speed acceleration. Reduced by ~4x.

All three were latent in the original Phase 1 clutch model; they just hadn't been exercised by a sustained full-throttle multi-gear run before. Found via targeted per-substep debug traces (temporary `console.error` instrumentation, removed after diagnosis), not by guessing at constants.

Verified results: 0-60mph ≈2.2-2.5s (target 2.0-2.5s ✓), gear 1-4 top speeds within ~5% of their 50/80/112/149mph targets, and outer-wheel grip load measurably exceeds inner-wheel during cornering (weight transfer confirmed live, not just by construction). 0-150mph lands around 6.2s against a 4.0-4.5s target — a large improvement from an initial state that didn't reliably complete the run at all, but still short; closing that gap further would mean reshaping `TORQUE_CURVE` (flagged in the plan as the last-resort lever, not yet touched) or another aero/gearing pass. Verification needed the flat test plane (`GROUND_SIZE`) temporarily enlarged (6000, reverted after) since a sustained 0-150 run outruns the normal 400-unit Phase 1 plane before finishing — a test-environment limit, not a gameplay one.

**Correction (see 2026-07-16 entry #2 below):** the "roll/pitch stay at 0.00°" claim above was wrong. `rollDeg`/`pitchDeg` had a math bug (see below) that made them read ~0 by construction, regardless of the chassis's actual orientation — the corrective-torque mechanism in this entry was never actually validated and, per the follow-up entry, its stiffness term turned out to be inert the whole time (only its damping term was doing anything).

### 2026-07-16 — Driving dynamics follow-up: braking floor, engine stall, and a real roll/float bug

Playtesting this pass surfaced three more issues: acceleration still felt sluggish, braking felt weak, and the car would pitch/float on two wheels when cornering with throttle around 80mph — with a direct challenge to check whether downforce was really feeding grip correctly, since real F1 cars stay flat and slide rather than roll.

- **Braking floor bug (real, not a feel issue):** `IDLE_GOVERNOR_GAIN` was uncapped, so when hard braking (in gear, clutch up) dragged engine rpm far below idle through the still-locked clutch, the governor could generate 600+Nm trying to hold idle rpm - more than the engine's own peak torque - which fought the brakes to a dead stop at a fixed "floor" speed instead of letting the car keep decelerating. Fixed by capping the governor's torque (`IDLE_ASSIST_MAX_NM`) and, per the request below, letting the engine genuinely **stall** instead of being propped up indefinitely.
- **Engine stall + restart:** the engine now dies if dragged below `STALL_RPM` while still coupled to the drivetrain (clutch mostly released, in gear) - same as lugging a real manual car to a stall under hard braking without clutching in. Restart requires holding the clutch and pressing the new starter key (`t`); `InputState` gained `takeStartTrigger()`, `VehicleModel` gained `tryStartEngine()`, and the debug HUD shows a stalled state.
- **Brake force was arbitrarily capped:** `MAX_BRAKE_FORCE_PER_WHEEL` was a flat 5200N regardless of how much grip the tires actually had (which by this point, with aero, is far more at speed) - raised to 40000N so braking is grip-limited like a real (well-braked, downforce-assisted) car, not force-capped.
- **The float/roll bug, root-caused, not just patched:** direct measurement (temporarily instrumented per-substep force logging, removed after diagnosis) found a **52kN vertical force spike in a single ~4ms sub-step** - about 9x the car's weight - at the exact frame after a wheel that had briefly lost ground contact regained it. The existing "suppress damping on the very first contact frame" guard only covered *that* frame; a wheel landing with real vertical speed could still swing across the whole clamped compression range one frame later, implying a multi-m/s "compression rate" that the (undamped-in-effect) spring-damper formula turned into a huge force. Fixed by clamping the compression velocity itself (`MAX_COMPRESSION_VEL`), not just gating on first contact. A second, unrelated bug in the anti-roll bars (added this same session, see below) independently could have caused a similar runaway - each was verified fixed in isolation with the other disabled before re-enabling both.
- **Anti-roll bars, replacing the previous corrective torque:** real forces coupling each axle's left/right (and, for pitch, front/rear-axle-average) suspension compression, instead of a whole-body torque that could hold the chassis level even while genuinely airborne on one side (the literal cause of the "floating" complaint - confirmed by directly observing both right-side wheels reading zero suspension contact for seconds at a time while the old telemetry insisted roll was 0°). Getting this right took two more fixes: (1) each wheel's contribution was originally clamped at `>=0` independently, which silently discarded the "negative" half of what should be a zero-sum transfer and injected real net extra force into the chassis every corner - replaced with a `transferForce()` helper that caps the transfer at what the donor side actually has, so the pair's total is always exactly conserved; (2) an airborne wheel's compression is a fixed sentinel value, not a continuously-extrapolated one, so an axle's ARB now only engages when both its wheels are grounded.
- **The `rollDeg`/`pitchDeg` math bug:** `up.dot(right)` and `up.dot(forward)` - the original formula - are dot products between two vectors of the *same* rotated orthonormal basis, which is mathematically always exactly 0 under *any* rotation (rotation preserves orthogonality). This metric could never have reported anything but ~0 no matter how far the chassis actually banked, and had been silently wrong since it was introduced (making the "roll/pitch stay at 0.00°" claim in the previous entry meaningless, and making the old corrective torque's angle/stiffness term permanently inert - only its rate/damping term was ever doing anything). Fixed by extracting yaw first and measuring "up" against a yaw-only horizontal reference frame instead. A cockpit-view screenshot during hard cornering, taken *before* this fix, visibly showed a ~30-40° tilted horizon while the (buggy) HUD reported 0.0° roll - the bug was caught by trusting the render over the telemetry, not the other way around.
- **A pure rate-damping torque was added back** for roll/pitch (angular-velocity-proportional only, no angle/stiffness term) to prevent runaway spin/flip in the moments before the ARBs' load-transfer response engages - critically, this generates zero torque when the chassis holds a steady lean, so it can't reproduce the original floating-while-airborne bug. Once `rollDeg`/`pitchDeg` were actually correct, a *weak* angle-restoring term (~6x weaker than the original torque, and initially added with the wrong sign - caught because it made the measured roll angle grow instead of shrink, flipped and reverified) was layered back on top, tuned until hard cornering at ~80mph settled to a stable ~4-5° body roll (small, physically plausible for a stiff F1-like chassis) with the inside wheels genuinely unloading from real weight transfer, instead of growing unbounded or holding an artificial 0°.

Verified via the same scripted-Playwright approach: braking from 100mph now decelerates smoothly to a near-stop instead of hanging at a floor speed; 0-60mph and per-gear top speeds unchanged from the prior pass (no regression); hard cornering at 80mph now shows a stable, bounded ~4-5° roll angle instead of an unbounded climb that previously reached 40-90° before the chassis literally launched into the air and went into freefall with zero linear/angular velocity (the "floating" bug, now fixed at the root cause rather than patched over).

**Follow-up same day:** the engine-stall mechanic (dies under hard braking without clutching in, restart via clutch + `t`) was cut after playtesting - it read as "way too dramatic" and didn't add anything at this stage. Reverted `tryStartEngine()`, the `stalled` state/telemetry, and the `t` key; kept the capped idle governor (`IDLE_ASSIST_MAX_NM`), which is what actually fixes the braking-floor bug on its own - without stalling, the engine now just gets dragged down toward a low-rpm safety floor under hard braking (mild, non-dramatic engine braking) instead of either fighting the brakes (the original bug) or requiring a restart ritual (the cut feature). Everything else from this entry (ARBs, rate/angle roll damping, corrected roll telemetry, raised brake force cap) is unaffected and still in place.

### 2026-07-17 — Phase closed

Flat-plane driving feel judged good enough as a base to build on. Further "feel" tuning (grip-circle coefficients, suspension, gearing) is deliberately deferred rather than pursued further in isolation — it's hard to judge a car's feel meaningfully on an open plane with no real corners, camber, or braking references, so the plan is to keep iterating on feel once there's an actual track to drive (Phase 2). All Phase 1 tunable constants remain grouped at the top of `src/vehicle.ts` for whenever that resumes.
