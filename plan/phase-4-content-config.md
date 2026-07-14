# Phase 4 — Content Config

**Status:** Not started
**Requirements reference:** [docs/requirements.md §8](../docs/requirements.md)

## Goal

Externalize team names, driver names, and liveries into a config file so content is easily customizable without code changes, and lay the groundwork for adding more cars/tracks through that system.

## Scope

- Config file format decision (JSON/YAML/TS module — open question, low risk).
- Team/driver/livery data model.
- Loading and applying config-driven content to car geometry/materials at runtime.
- Likely also where additional cars and tracks get added, using this system rather than hardcoding.

## Out of scope

In-game UI for editing config (config is hand-edited, not a game feature).

## Open questions to resolve at phase start

- Config file format.
- Data model shape (per-team colors, per-driver name/number, etc.).

## Tasks

- [ ] Decide config file format
- [ ] Define team/driver/livery data schema
- [ ] Refactor existing (Phase 1/2) car content to load from config instead of being hardcoded
- [ ] Add at least one additional car/livery via config only, to prove the system works without code changes

## Definition of done

Changing a team name, driver name, or livery color is a config-file edit only — no code changes required.

## Retrospective

_(fill in once this phase is complete)_
