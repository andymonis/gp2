# Phase 2 — PoC: First Track

**Status:** Not started
**Requirements reference:** [docs/requirements.md §8, §9](../docs/requirements.md)

## Goal

Replace the flat plane with a real, hand-built low-poly track — the first proof that the driving feel from Phase 1 holds up on an actual circuit layout, and the first step toward a time-trial game loop.

## Scope

- One hand-built low-poly track, inspired by a real 1990-era circuit's layout/character (corner sequence, elevation), given a fictional name. Built from scratch — no laser scanning or licensed track data.
- Solo time trial: drive laps of the track alone.
- Track-building workflow decided at the start of this phase (open question — see below).

## Out of scope

Lap timing/HUD, sound, opponents, ghost replay, multiple tracks.

## Open questions to resolve at phase start

- Track-building workflow: hand-authored in an external 3D tool and imported, vs. procedurally described in code/data.
- Which real 1990 circuit's character to draw inspiration from for this first track.

## Tasks

- [ ] Decide track-building workflow
- [ ] Choose reference circuit and fictional name
- [ ] Build low-poly track geometry (road surface, barriers/edges, elevation)
- [ ] Integrate track collision into Rapier
- [ ] Place car at a start position on the track
- [ ] Playtest a full lap, confirm driving feel holds up on corners/elevation changes

## Definition of done

A full lap of the new track can be driven, start to finish, with the Phase 1 control/physics model unchanged (or deliberately re-tuned if the track reveals issues).

## Retrospective

_(fill in once this phase is complete)_
