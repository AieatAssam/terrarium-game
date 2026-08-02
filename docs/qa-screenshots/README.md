# Visual QA evidence — screenshots

Durable browser-capture evidence referenced by `work_progress.yaml` and
`docs/visual-qa/improvement-log.md`. Committed so that the citations in those
docs resolve to real, versioned files.

## Layout

| Path | Contents | Referenced by |
|---|---|---|
| `01-initial-garden*.png`, `02-star-sprout-reveal.png`, `03-upgrades-panel.png`, `04-settings-panel.png`, `05-credits-panel.png`, `06-journal-panel.png`, `07-mobile-viewport.png` | Phase 1 UI/settings/credits/journal captures | `docs/QA_REPORT.md` |
| `conveyor/before/` | Matched A/B of the conveyor jerk + flatness pass, pre-fix | `work_progress.yaml` (conveyor entry) |
| `conveyor/after/` | Same scene post-fix; `04-all-three-automations.png` + `05-*closeup.png` catch the Colour Gate lamp/belt collision regression and the Mood Bell standee blank-tan-rectangle defect | `work_progress.yaml` (conveyor entry) |
| `drag-tint/` | The "square block" investigation — held Sprout before/after the badge glyph fix | `docs/visual-qa/improvement-log.md` (square-block entry) |
| `path/after/` | Garden-path chevron march + kerbed bed | `docs/visual-qa/improvement-log.md` (path entry), `tests/e2e/pathFlow.dev.spec.ts` |
| `settle-loop/before/`, `settle-loop/after/` | First-session settle-loop before/after (creature presence, settle payoff, opening) | `docs/visual-qa/improvement-log.md` (settle-loop entry) |

## Capture provenance

Captured via headed Playwright harnesses / e2e specs, not hand screenshots:

- Conveyor A/B: standalone headed harness (kept out of `tests/`), the two
  edited files `git checkout`'d to HEAD for the "before" pass and restored
  afterwards — see the work_progress.yaml conveyor in_flight entry.
- Settle-loop: `tests/e2e/settleFeel.dev.spec.ts` with
  `SETTLE_PHASE=before|after`.
- Path march: `tests/e2e/pathFlow.dev.spec.ts`.
- Drag-tint: `tests/e2e/dragTint.dev.spec.ts`.

## Policy

- **Commit** screenshots that docs cite as evidence (this is why they are
  here). They are reasonably sized and the repo convention already tracks
  screenshots.
- **Never commit** the Playwright `trace.json` files that sometimes land next
  to captures — they are transient diagnostic output (gitignored:
  `docs/qa-screenshots/**/trace.json`).
- Prefer re-capturing evidence on the current HEAD to keeping stale captures.
  When a capture is superseded, annotate it rather than silently deleting the
  record (the improvement-log convention).
