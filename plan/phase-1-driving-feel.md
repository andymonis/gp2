# Phase 1 — PoC: Driving Feel

**Status:** Not started
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

- [ ] Build/import a simple low-poly car model (~100–300 polys)
- [ ] Flat plane ground with scale-reference markers
- [ ] Rapier rigid body + wheel/vehicle setup for the car
- [ ] Implement grip-circle grip model
- [ ] Implement ramped input handling for steer/throttle/brake
- [ ] Implement sequential gearbox state machine (space = context-sensitive up/down)
- [ ] Implement clutch state (shift key) for standing starts
- [ ] Cockpit camera rig attached to car
- [ ] Model low-poly dashboard geometry (rev needle + gear indicator) driven by vehicle state
- [ ] Playtest and tune grip-circle parameters until the car feels right (twitchy, powerful, easy to spin)

## Definition of done

The car can be driven around the flat plane, launched from a standing start using the clutch, shifted up/down sequentially, and spun out under excessive input — and it *feels* right when driven.

## Retrospective

_(fill in once this phase is complete: what worked, what needed manual correction, time taken, how many tuning passes the grip-circle model needed)_
