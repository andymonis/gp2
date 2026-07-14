# Phase 0 — Setup

**Status:** In progress
**Requirements reference:** [docs/requirements.md §4, §12](../docs/requirements.md)

## Goal

A deployable, empty Three.js scene, built automatically on every push to `main`, so later phases have working infrastructure and delivery metrics (deployment frequency, lead time) are trackable from the start.

## Scope

- Repo scaffolding: TypeScript + Vite project.
- Dependencies: Three.js, Rapier (single-threaded WASM build).
- Minimal scene: empty canvas rendering (camera, empty ground plane or nothing at all — just prove the pipeline).
- GitHub Actions workflow: build on push to `main`, deploy to GitHub Pages.

## Out of scope

Anything to do with the car, physics, controls, or content — this phase is pure plumbing.

## Tasks

- [x] `npm create vite@latest` with TypeScript template
- [x] Add Three.js dependency, render a basic scene (confirms rendering pipeline works)
- [x] Add Rapier dependency (single-threaded WASM build), confirm it initializes without COOP/COEP headers
- [x] Add GitHub Actions workflow: build + deploy to GitHub Pages on push to `main`
- [ ] Confirm live GitHub Pages URL loads the empty scene — blocked on a GitHub remote existing and Pages being enabled; nothing to push to yet
- [x] Repo README updated with basic project description and dev commands (`npm install`, `npm run dev`, `npm run build`)

## Definition of done

Pushing to `main` results in an updated, live GitHub Pages build within a few minutes, with no manual deploy steps.

## Retrospective

_(fill in once this phase is complete: what worked, what needed manual correction, time taken)_
