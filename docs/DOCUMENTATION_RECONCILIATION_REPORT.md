# Documentation Reconciliation Report

**Date:** 2026-08-02
**HEAD at time of writing:** `ad86e3765f1dfc419ac32a1e2ada959b3d7ec229` (branch `main`)
**Scope:** reconcile the 16 findings of the documentation/repository audit
(lettered A1–E16 below) against the actual repo state, correct the drift with
minimal permitted changes, and reconcile `work_progress.yaml`, agent config,
and QA-evidence policy with reality.

## Method

Every finding was checked against the repository at HEAD, not trusted on
sight. The canonical authority chain was applied per `CLAUDE.md`:
`docs/_scratch/GameRules.md` (canonical spec, §17 wins) → `docs/CONTRACTS.md`
(event union, ids, grid, save format) → `docs/ARCHITECTURE.md` (as-built) →
`work_progress.yaml` (status tracker). Where a doc conflicted with committed
code, the code and CONTRACTS were treated as truth unless the doc cited a
deliberate supersession.

## Verified current state (evidence)

- `SIM_SHAPE_VERSION` = `CURRENT_SAVE_VERSION` = 5 (`src/sim/state.ts:107`,
  `src/persistence/save.ts:10`); `migrateEnvelope()` runs the full chain
  v1 → v2 → v3 → v4 → v5.
- `src/core/ids.ts:13`: `AutomationId = 'gardenSlide' | 'colourGate' | 'moodBell'`.
- Mood badge is a billboard quad with procedural glyphs (`sunny` = four-point
  sparkle, `sleepy` = crescent) — `src/render/pbrMaterials.ts:985-1074`. The
  three drag-tint materials were **deleted** in the 2026-08-01 square-block fix.
- Test run executed this session: `npx vitest run` → **30 files, 321 tests,
  all passing**. `npm run typecheck` and `npm run lint` both clean.
- E2E: 32 `test(` occurrences across 15 spec files + `tests/e2e/helpers.ts`
  (suite not run this session).
- Git: commits `fc277ba` (Phase 1.1-1.3), `75f4b9d` (Phase 1.4-1.6),
  `46e0502` (settle-loop + conveyor), `99ff8ea` (square-Sprout fix + path
  kerb), `3146a96` (Mood Bell), `3ada912`, `0febd9c` all on `main`.

## Findings and resolutions

### A — Stale/false documentation

| ID | Finding | Verified | Resolution |
|---|---|---|---|
| A1 | `docs/ARCHITECTURE.md:23` "currently v1→v2" and `:53` "v1 -> v2 -> v3 -> v4" | **VALID** — code is v5 | Reword to point at the source of truth; state current chain to v5 |
| A2 | `docs/GAME_DESIGN.md:416-417` "a sphere for Sunny, a box for Sleepy" | **VALID** — badge is a billboard quad with glyphs | Reword to the implemented glyph description |
| A3 | `docs/GAME_DESIGN.md:683-684` AutomationId union omits `moodBell` | **VALID** — `:683` says "still exactly `'gardenSlide' | 'colourGate'`" | Correct the union prose; link `src/core/ids.ts` as source of truth |
| A4 | `docs/GAME_DESIGN.md:675` "complexity curve has 9 stages" | **VALID** — GameRules §9.6 has 12 stages (10–12 added 2026-08-01) | Correct to 12 stages, cite GameRules §9.6 |
| A5 | `docs/HATCHERY_PICKING_PROPOSAL.md:370` "SIM_SHAPE_VERSION (currently 3 → 4)" | **VALID** — current is 5 | Mark the passage as the v3-era state; point at `src/sim/state.ts` for current |

### B — Structural contradictions

| ID | Finding | Verified | Resolution |
|---|---|---|---|
| B6 | `docs/CONTRACTS.md:18` top-level `/assets/` vs `:314` `public/assets/` | **VALID** — no top-level `assets/` dir exists; CONTRACTS:314 is correct | Fix the project-layout block to `public/assets/` |
| B7 | `docs/visual-qa/improvement-log.md` older settle-loop entries claim sleepy badge is still a grey-blue box and pre-warming fixed the drag tint | **VALID** — the newer top entry (2026-08-01) documents the real fix: drag-tint deleted, badge → crescent | Annotate the stale entries as superseded, pointing at the top entry |
| B8 | `docs/GAME_DESIGN.md:10-17` "game isn't fully playable yet" | **VALID** — Phase 1 shipped 2026-08-01 (`GAME_DESIGN.md:669-673` itself says so) | Rewrite the status note to the actual state |

### C — Stale references (two were false positives)

| ID | Finding | Verified | Resolution |
|---|---|---|---|
| C9 | "Non-existent implementation-plan path" (`IMPLEMENTATION_PLAN.yaml`) | **INVALID** — `docs/IMPLEMENTATION_PLAN.yaml` exists and is tracked (9119 bytes, plan_version 1); referenced by `src/data/spawning.ts:4`, `docs/GAME_DESIGN.md:15`, `playwright.config.ts` | No change. Keep the file; references are valid |
| C10 | "`docs/ART_QA_REPORT.md` does not exist" | **INVALID** — exists, tracked (72032 bytes), the Phase 2 standee-fix + PBR-conversion report; it supersedes the Phase 1 art report and deliberately omits screenshots | No change. Keep references (`README.md:69`, MATERIAL_LIBRARY, ART_DIRECTION, render sources) |
| C11 | `docs/.claude/agents/visual-director.md:11` bare `GameRules.md` | **VALID** — canonical path is `docs/_scratch/GameRules.md` | Fix the path; **new find:** `CLAUDE.md:86` has the same bare-path defect while `CLAUDE.md:38` is correct — fix both |

### D — work_progress.yaml status

| ID | Finding | Verified | Resolution |
|---|---|---|---|
| D12 | `meta.head` says `fc277ba` + "UNCOMMITTED — commit imminent" | **VALID** — HEAD is `ad86e37`, work committed | Update meta to real HEAD; drop the "UNCOMMITTED" note |
| D13 | `meta.tests_passing: 319` vs "321 unit tests" elsewhere | **VALID** — actual run = 321/30 | Set `tests_passing` to 321/30 with the command and date |
| D14 | in_flight entries (conveyor `:450`, settle-loop `:547`) still marked IN PROGRESS / "MINE, do not commit" | **VALID** — both committed (`46e0502`, `99ff8ea`) | Move committed entries to `completed` with commit provenance |

### E — Agent config and QA evidence

| ID | Finding | Verified | Resolution |
|---|---|---|---|
| E15 | Duplicate visual agent: `.claude/agents/visual-fidelity-artist.md` (tracked) vs `docs/.claude/agents/visual-director.md` (untracked) | **VALID** — fidelity-artist implements + critiques; director is review-only with a distinct 9-category rubric | Move director into `.claude/agents/`, keep the two roles distinct, delete `docs/.claude/` |
| E16 | QA evidence: tracked screenshots are historical (Phase 1) while the conveyor/settle-loop/path/drag-tint evidence referenced by docs is untracked | **VALID** — 21 referenced screenshots untracked; 2 `trace.json` dumps referenced nowhere | Commit the referenced screenshots with an evidence manifest; ignore the unreferenced `trace.json` files |

## Decisions (recorded here and in `work_progress.yaml`)

1. **Commit referenced QA evidence.** Screenshots cited as durable acceptance
   evidence by `work_progress.yaml` and `improvement-log.md` (conveyor A/B,
   settle-loop, path march, drag-tint closeup) are committed together with a
   manifest README explaining provenance and workflow. Reason: they are the
   only record the docs point at, they are reasonably sized, and the repo
   convention already tracks screenshots. Two `trace.json` files (Playwright
   traces, ~59 KB each, referenced nowhere) are ignored via `.gitignore` —
   transient diagnostic output.
2. **`docs/visual-qa/planning-baseline/` left untracked, no gitignore.** These
   13 screenshots (~13 MB) are the diagnostic evidence for the **in-flight
   Phase 6 world-quality plan** in an uncommitted `plan.yaml` change owned by a
   concurrent agent (not this session). Adding a gitignore entry would hide
   that evidence from git before its owner commits it. Left as-is; the owner's
   Phase 6 commit should track it. `plan.yaml` itself is also not this
   session's file — it is left untouched and uncommitted.
3. **Agent-role boundary kept.** `visual-director.md` (review-only, score
   categories 1–5, reject <4/5 claims) stays distinct from
   `visual-fidelity-artist.md` (implements AND critiques). Both are now under
   `.claude/agents/`. No merge.
4. **Historical reports are not rewritten.** `docs/QA_REPORT.md` and
   `docs/ART_QA_REPORT.md` remain point-in-time snapshots; corrections to
   superseded claims are *annotations* in `improvement-log.md`, not edits to
   the historical numbers.
5. **Broken YAML fixed.** `work_progress.yaml` at HEAD did not parse (two
   `status:` plain scalars containing `: ` — the e2e-verification and
   nursery-clip entries). Converted both to block scalars while reconciling;
   the file now parses clean (`js-yaml` load). This was pre-existing, not
   caused by this pass, and would have broken any YAML-consuming tooling.

## Files changed by this pass

- `docs/DOCUMENTATION_RECONCILIATION_REPORT.md` (this file, new)
- `docs/ARCHITECTURE.md`, `docs/GAME_DESIGN.md`, `docs/CONTRACTS.md`,
  `docs/HATCHERY_PICKING_PROPOSAL.md`, `docs/visual-qa/improvement-log.md`,
  `CLAUDE.md`
- `work_progress.yaml`
- `.claude/agents/visual-director.md` (moved from `docs/.claude/agents/`),
  `docs/.claude/` deleted
- `docs/qa-screenshots/` (referenced evidence added), `docs/qa-screenshots/README.md` (new manifest)
- `.gitignore`
