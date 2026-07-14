# Phase 3 — PoC: Audio

**Status:** Not started
**Requirements reference:** [docs/requirements.md §11](../docs/requirements.md)

## Goal

Add engine sound tied to RPM, giving an audible cue for shift points to complement the visual dashboard.

## Scope

- Procedural engine sound synthesis via the Web Audio API (oscillator/sample pitch-shifted by RPM) — not recorded/licensed real engine samples.

## Out of scope

Tire/collision/environmental sound (unless trivially cheap once the engine sound pipeline exists — otherwise defer), music.

## Tasks

- [ ] Prototype a basic oscillator-based engine tone in isolation
- [ ] Tie pitch/timbre to vehicle RPM
- [ ] Integrate into the running game (Phase 1/2 build)
- [ ] Playtest: does the sound help judge shift points without the dashboard?

## Definition of done

Engine note audibly rises/falls with RPM during normal driving and gear changes.

## Retrospective

_(fill in once this phase is complete)_
