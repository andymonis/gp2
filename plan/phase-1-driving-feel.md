# Phase 1 — PoC: Driving Feel

**Status:** In progress
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
- [ ] Playtest and tune grip-circle parameters until the car feels right (twitchy, powerful, easy to spin) — needs a human behind the keyboard; functional correctness is scripted/verified but "feel" isn't

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

Verified results: 0-60mph ≈2.2-2.5s (target 2.0-2.5s ✓), gear 1-4 top speeds within ~5% of their 50/80/112/149mph targets, roll/pitch stay at 0.00° even under an abrupt full-steering-lock corner at 130mph+ (the original "pitches/rolls over" complaint is resolved), and outer-wheel grip load measurably exceeds inner-wheel during cornering (weight transfer confirmed live, not just by construction). 0-150mph lands around 6.2s against a 4.0-4.5s target — a large improvement from an initial state that didn't reliably complete the run at all, but still short; closing that gap further would mean reshaping `TORQUE_CURVE` (flagged in the plan as the last-resort lever, not yet touched) or another aero/gearing pass. Verification needed the flat test plane (`GROUND_SIZE`) temporarily enlarged (6000, reverted after) since a sustained 0-150 run outruns the normal 400-unit Phase 1 plane before finishing — a test-environment limit, not a gameplay one.
