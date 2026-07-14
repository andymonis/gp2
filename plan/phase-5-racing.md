# Phase 5 — Racing

**Status:** Not started
**Requirements reference:** [docs/requirements.md §9](../docs/requirements.md)

## Goal

Give the player something to race against, starting with the cheapest option (their own ghost) before tackling the much harder problem of AI opponents.

## Scope

### Part A — Ghost replay
- Record the player's best lap (position/rotation over time).
- Play back the ghost car alongside a live attempt.

### Part B — AI opponents (separate, later sub-phase)
- Opponent driving logic under the grip-circle physics model: raceline following, braking points, reaction to the player.
- Collision handling between multiple cars.
- Flagged in requirements as a genuinely open, potentially hard problem — investigate early in this sub-phase before committing to a full approach.

## Out of scope

Multiplayer (not currently planned at all).

## Tasks

### Part A
- [ ] Record player position/rotation/input state over a lap
- [ ] Play back recorded lap as a non-interactive ghost car
- [ ] Trigger recording/playback around lap start/finish

### Part B
- [ ] Investigate approach for AI raceline/driving logic compatible with the grip-circle model
- [ ] Implement basic single-opponent AI
- [ ] Handle car-car collision
- [ ] Playtest and iterate on opponent behavior

## Definition of done

**Part A:** Player can race against a ghost of their own best lap.
**Part B:** Player can race against at least one AI-controlled opponent car.

## Retrospective

_(fill in once this phase is complete)_
