# Phase Tracker

Source of truth for where the project is. Update the status column whenever a phase starts or completes. Full context for each phase lives in its own file; full requirements context lives in [`docs/requirements.md`](../docs/requirements.md).

| Phase | File | Status | Started | Completed |
|---|---|---|---|---|
| 0 — Setup | [phase-0-setup.md](phase-0-setup.md) | Done | 2026-07-14 | 2026-07-14 |
| 1 — Driving Feel PoC | [phase-1-driving-feel.md](phase-1-driving-feel.md) | In progress | 2026-07-14 | |
| 2 — First Track | [phase-2-first-track.md](phase-2-first-track.md) | Not started | | |
| 3 — Audio | [phase-3-audio.md](phase-3-audio.md) | Not started | | |
| 4 — Content Config | [phase-4-content-config.md](phase-4-content-config.md) | Not started | | |
| 5 — Racing | [phase-5-racing.md](phase-5-racing.md) | Not started | | |
| Deferred / Unscheduled | [deferred.md](deferred.md) | Backlog | — | — |

**Status values:** `Not started` → `In progress` → `Blocked` (note why in the phase file) → `Done`.

## Resume-work checklist

When picking this back up:
1. Read this table for the current phase.
2. Open that phase's file for its goal, scope, and task checklist.
3. Check the **Retrospective** section of the most recently completed phase for anything that should change the next phase's plan.

## Log

- 2026-07-13 — Requirements workshop completed ([docs/requirements.md](../docs/requirements.md)). Phase plan files created. Nothing implemented yet.
- 2026-07-14 — Phase 0 done. Vite + TypeScript, Three.js scene rendering, Rapier compat WASM initializing, GitHub Actions deploy workflow, README updated. Repo pushed to github.com/andymonis/gp2, Pages enabled, live URL verified (https://andymonis.github.io/gp2/).
- 2026-07-14 — Phase 1 engineering complete: low-poly car, ground+markers, custom grip-circle vehicle physics (raycast suspension, friction-circle tire model, sequential gearbox, standing-start clutch), cockpit camera, 3D dashboard. Verified via scripted headless playtest (standing start, launch, up/downshift, spin-out), zero console errors. Caught and fixed a serious bug (Rapier's addForce/addForceAtPoint persist across steps unless reset — was launching the car into orbit). Remaining: human playtesting to tune feel (see phase file retrospective).
