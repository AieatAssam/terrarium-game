# Tiny Terrarium Works

> [!CAUTION]
> **ABANDONED:** This project is no longer maintained, updated, or supported.
> Do not rely on it for production use. The goal of the project was to test limits of AI use for game engine development and these limits have been reached. Subsequent changes are stalled and core capabilities are not reached. Major redesign and rework is needed and as such I am archiving this project as lessons learned


A cosy 2.5D automation-and-collection browser game: sort adorable Sprouts into their matching habitats, earn Dewdrops, and unlock gentle garden automation. Built with TypeScript, Vite, and Babylon.js.

## Quick start

```bash
npm install
npm run dev
```

Open the printed local URL (default `http://localhost:5173`). The game loads directly into the garden — drag the first Sprout that appears to its glowing habitat within a few seconds, no tutorial required.

## Development commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with hot reload. Dev-only debug panel and console hook are active (see below). |
| `npm run typecheck` | `tsc --noEmit` across the whole project. |
| `npm run lint` | ESLint, zero warnings tolerated. |
| `npm run format` | Prettier, writes in place. |
| `npm test` | Vitest unit suite (sim, data/progression, persistence, UI state, audio). |
| `npm run build` | Typecheck + production Vite build to `dist/`. |
| `npm run preview` | Serves the production build locally (`http://localhost:4173`). |
| `npm run test:e2e` | Playwright suite — see below. |

## Dev-only debug tools

Running `npm run dev` (never a production build) exposes:
- A **debug panel** (top-right, pink dashed border): spawn any Sprout type including the rare Star Sprout, grant +50 Dewdrops, speed up the simulation (1x/5x/20x), and reset all saved progress.
- A console hook, `window.__terrariumUIF = { bus, audio, store }`, for inspecting live game state and events from devtools.
- `window.__debug.project(x, y, z)`, a world-to-screen projection helper used for automated testing.

All three are gated behind `import.meta.env.DEV` and are confirmed absent from the production build by the Playwright `preview` project (see below).

## Testing

**Unit tests** (`npm test`, Vitest): the deterministic simulation layer, progression/data modules, persistence (save/load/migration via `fake-indexeddb`), the UI state store, and the audio graph. Includes an architecture test that fails the build if `src/sim/` ever imports from `src/render`, `src/ui`, `src/audio`, or `src/input`.

**Browser tests** (`npm run test:e2e`, Playwright): two projects.
- `dev` — against the Vite dev server, using the debug panel/console hook to exercise real gameplay flows (placement, automation unlocks, persistence, accessibility) against the live simulation, not mocks.
- `preview` — against a production build, confirming the debug panel and dev-only globals are genuinely absent and the game still renders and plays.

Run everything Playwright needs once with `npx playwright install --with-deps chromium` before the first `npm run test:e2e`.

## Production build

```bash
npm run build
npm run preview
```

`dist/` is a fully static bundle — deploy it to any static host. It contains no debug affordances (verified by the `preview` Playwright project) and no server-side code.

## Architecture overview

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full module map, event model, save format, and simulation loop. In short: a deterministic, fixed-step simulation (`src/sim/`) owns all gameplay state and emits typed events over a small bus (`src/events/`); rendering (`src/render/`, Babylon.js), input (`src/input/`), UI (`src/ui/`, plain DOM/CSS), and audio (`src/audio/`, Web Audio synthesis) all subscribe to that bus and never simulate gameplay themselves.

## Game design

See [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) for the player experience, first-session flow, progression numbers, accessibility decisions, and explicit Phase-1 out-of-scope list.

## Art direction and asset/licence policy

See [docs/ART_DIRECTION.md](docs/ART_DIRECTION.md) for the palette, silhouette rules, and art pipeline, and [docs/ASSET_CREDITS.md](docs/ASSET_CREDITS.md) for exact per-asset provenance. Summary: every visual asset is original SVG source authored for this project (no third-party or stock art); every music/SFX asset is original, synthesized in-repo via the Web Audio API (no samples, no external audio files, nothing to licence). The in-game Credits panel mirrors ASSET_CREDITS.md exactly.

## QA

See [docs/QA_REPORT.md](docs/QA_REPORT.md) for test coverage, bugs found and fixed during integration, and known Phase-1 scope limitations, and [docs/ART_QA_REPORT.md](docs/ART_QA_REPORT.md) for the visual quality pass. Screenshots are in `docs/qa-screenshots/`.
