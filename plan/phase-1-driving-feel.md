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
