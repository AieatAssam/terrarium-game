# Visual QA — improvement log

---

## 2026-08-01 — The "square block" on a Sprout: it was the mood badge

Player report: *"look at what happens to sprout when it is hovering over a
habitat. it turns into a square block."*

Reproduced and identified in-browser rather than reasoned about, via a new
`tests/e2e/dragTint.dev.spec.ts` that drives a real drag and crops tight on the
held Sprout. The culprit is **not** the drag tint: it is the mood badge, which
was a literal `MeshBuilder.CreateBox` (sleepy) / `CreateSphere` (sunny) with an
untextured painted-metal material. At the camera distance the game is actually
played at, the box rendered as a pale lavender **cube** floating beside the
creature, comparable in screen size to its head, reading as a missing-texture
artifact. `docs/REFERENCE_BOARD.md`'s non-negotiable list fails a build for
exactly this — "no default primitives or flat placeholder appearance".

It was most obvious mid-drag simply because that is when the player is looking
straight at the Sprout, not because of anything the drag path does.

**There were two separate square artifacts, and the badge was only the
smaller one.** The player's follow-up screenshot showed the *sprite plane
itself* rendering as a solid cyan rectangle while held over a habitat, with
the (correctly drawn) mood sparkle sitting in its corner. Root cause:
`setDragValidity` pointed the mesh at one of three per-type "drag tint"
materials built by `createManifestMaterial`, which starts at a flat fallback
colour with **no** `baseTexture`. A material with no base texture has nothing
for `_useAlphaFromAlbedoTexture` to read, so its alpha is a solid 1 — an
opaque, fully saturated, fallback-coloured rectangle covering the creature's
own artwork.

This is the same defect reported earlier as a "momentary square block when
selecting sprouts". The first attempt at it — pre-warming the drag materials
at spawn — was the wrong shape of fix: it only moved *when* the async window
opened, and in practice converted a brief flash into a persistent square.

**Real fix:** the drag no longer swaps in a material at all. It reuses the
Sprout's normal, already-resolved state material and expresses validity
through scale and opacity instead of colour, neither of which can depend on an
unloaded texture. No information is lost — validity was never carried by this
tint alone; `habitats.ts`'s `setHover` already lights and scales the target
habitat, which is the larger signal and where the player is looking. The three
drag-tint materials are deleted.

**Fix for the badge:** a small alpha-cut icon on a billboard quad instead of a solid, with
procedurally drawn glyphs (`createMoodBadgeMaterial`). Because the quad is
mostly transparent there is no block to see at all — only the glyph. Shape
still carries the distinction rather than colour, per GameRules §11: **sunny is
a four-point sparkle, sleepy a crescent**, each with a soft tinted halo so it
reads as part of the world rather than a UI sticker pasted over it.

Drawn procedurally on purpose: `MoodDefinition.silhouetteKey` points at
manifest art (`mood.sunny.badge`) that **does not exist** in
`public/assets/manifest.json`, so a manifest-backed material would fall back to
a flat colour and reintroduce the very problem being fixed.

Evidence: `docs/qa-screenshots/drag-tint/`. Before — a pale cube beside the
creature; after — a clean crescent, with both glyphs confirmed side by side on
neighbouring Sprouts in the settle-loop captures.

### Correction to an earlier finding in this log

The pointer-drag e2e path is **not** broken in the app. The same drag that
fails through Playwright's `page.mouse` succeeds when dispatched as synthetic
`PointerEvent`s on the canvas (with `setPointerCapture` stubbed) — `dragTint`
picks a Sprout reliably that way. So the 18 pre-existing dev-project failures
are a **helper** problem in `tests/e2e/helpers.ts`'s `dragBetween`, not a
gameplay one, and the fix is to port those helpers to the dispatch approach
`dragTint.dev.spec.ts` now demonstrates. That is a smaller and much better
defined job than "the pointer path is broken".

---

## 2026-08-01 — Garden path: chevron loop jerk + verticality

Player report, verbatim: *"shevrons moving along the belt do not loop the
animation around smoothly - they are not evenly distributed, so when animation
loops around, there is a visible jerk"* and *"conveyor belts remain flat on the
ground, the do not have any verticality to them, they look painted on rather
than placed on the terrain"*.

Note this is the **garden path** network (`src/render/world.ts` +
`createPathFlowMaterial`), not the automation structures — the credits call
these "path-conveyor chevrons", and the two systems are separate.

### The jerk — one arithmetic bug, and the chevrons were never uneven

`advance()` wrapped `uOffset` on `1 / CHEVRONS_PER_TILE` (0.5). Babylon
composes texture UVs as `u = u0 · uScale + uOffset`, so **`uOffset` is measured
in whole texture periods regardless of `uScale`** — one chevron is 1.0 of
`uOffset`. Wrapping at 0.5 snapped the entire march back by *half a chevron*
on every cycle.

The spacing itself was correct all along: each half-tile flow quad shows
exactly `CHEVRONS_PER_TILE` whole periods, so chevrons are uniform across tiles
and around corners. What the eye read as "not evenly distributed" was the
half-step jump landing twice a second. Wrapping on 1.0 puts the wrap on a point
where the pattern is identical to where it started, so the modulo is invisible.

Chevrons were also lifted from emissive 0.50/0.44/0.30 at alpha 0.62 to
0.68/0.60/0.42 at alpha 0.82 — they were legible in a close crop and nearly
invisible at the distance the game is actually played at, which defeats the one
job they have.

### Verticality — the path really was painted on

The entire network was `CreateGround` quads at y = 0.01: zero thickness, no
side faces to catch the key light, no contact shadow. Added a raised stone bed
(`PATH_BED_HEIGHT` 0.075) built from the **same half-tile segments the flow
overlay already uses**, so the bed follows the actual tread band and bends
correctly around a corner instead of stamping a square plinth per tile. Stone
rather than the tread's own material, so the edging reads as a different
material from the surface walked on.

#### Follow-up: the outer corner of every bend missed its kerb

Reported immediately after the first bed landed, and correct. Each half-tile
bed spans from the tile **centre outward along its own arm**, so on a
90° bend the quadrant lying behind *both* arms — the outer corner of the turn —
was covered by neither. The tread art does run through that quadrant (the
band's two outer edges meet there), so the kerb stopped short and the bend sat
on bare soil with an exposed tread edge.

Fixed with one `across × across` hub box at each tile centre, which closes it
for corners, junctions and straights at once and cannot protrude, since
`across` is exactly the width the arms already occupy. Skipped for a
single-arm terminus, where half of it would stick out past the tread's end.
Bed meshes 44 → **65**.

### Evidence

`tests/e2e/pathFlow.dev.spec.ts`, shots in `docs/qa-screenshots/path/`.
Measured: **65 bed meshes, min height 0.075, top face at y 0.073**, where
before there were zero and the path had no vertical extent at all. Both bends
verified by zoomed crop to wrap continuously. Four gates
pass (typecheck, lint, 321 unit tests, build); the settle spec still passes.

**Not independently verified:** that the wrap jerk is gone *in motion*. A
discontinuity is a motion artifact and Playwright screenshots are not precisely
enough timed to catch one frame-to-frame; the fix rests on the `uOffset`
semantics above plus a captured march sequence, and wants a human eye on it in
play.

### Remaining

- The kerb is a single flat grey tone along its whole length — no variation,
  no moss or wear at the soil line. Fine at distance, thin up close.
- Reduced motion still freezes the march entirely (by design — the chevrons
  are directional by shape, so the information survives).

Required by CLAUDE.md's Game Quality Contract: every player-facing change
records what changed, its evidence, its scores against
`docs/REFERENCE_BOARD.md`'s rubric, remaining defects, and the next
high-impact improvement.

---

## 2026-08-01 — First-session Sprout settlement loop

**Goal:** make the opening Notice → Guide → Settle beat feel good rather than
flat.

### Process note: a gap in the reference pipeline

The request and `docs/REFERENCE_BOARD.md`'s "Reference use protocol" both
assume a curated `docs/references/<game>/<category>/` tree with adjacent `.md`
notes. At the start of this work that directory **did not exist** — only
`docs/reference-candidates/` (which CLAUDE.md explicitly forbids using as
approved guidance) and `docs/reference-reviews/classification.json`. Since the
accept/reject decisions and every per-image `visibleEvidence`,
`tinyTerrariumLesson` and `doNotCopy` note already lived in
`classification.json`, the promotion step was the only missing stage, and the
subset this task needed was promoted rather than treated as a blocker. A
concurrent session has since committed the full 32-entry board of `.md` notes;
the images promoted here fill in alongside them.

References actually consulted for this pass:

- `slime-rancher-2/creature-readability/slime-rancher-2-01`
- `ooblets/creature-personality/ooblets-04`, `ooblets-02`
- `tiny-glade/reward-feedback/tiny-glade-01`
- `ooblets/reward-feedback/ooblets-11`
- `slime-rancher-2/reward-feedback/slime-rancher-2-05`

The transferable lesson taken from the three reward frames, in one line: **the
reward appears in the world, at the thing that earned it, large enough to read
and long enough to see.** All implementation here is original; nothing was
copied from any reference.

### Diagnosis

`GameRules.md` §5.3 names six channels a correct settle must fire. Audited
against the code, before any change:

| §5.3 channel | State before |
|---|---|
| Sprout happy animation | **Inert.** `setState` only swapped a material texture — no motion at all. And `'happy'` was superseded by `'settled'` in the same event batch, which maps back to the same texture. One still image replacing another. |
| Habitat reaction | **Dead code.** `reactCorrect`/`reactIncorrect` (glow pulse, scale bump, 28-particle burst at the drum top, Dew Pond ripple) were written, previously bug-fixed, exported — and called by *nothing* in `src/`. |
| Particle effect | Partial: a 20-count sparkle at the Sprout. The richer habitat-side burst was inside the dead code above. |
| Pleasant SFX | Present and working. |
| Dewdrop reward | **Invisible.** `habitat:dewdropTick` had no subscriber anywhere in `src/render` or `src/ui`. Dewdrops moved a HUD number and nothing else — precisely REFERENCE_BOARD's "correct placement only changes a number" failure condition. |
| Journal acknowledgement | Fires, silently updates a panel. (§5.3 marks this optional.) |

Live capture then found two problems larger than any of the six:

- **A Sprout was ~20×22 CSS pixels at the default camera** — a fuzzy speck
  with no contact shadow and no readable face
  (`qa-screenshots/settle-loop/before/02-sprout-waiting.png`). No amount of
  settle polish fixes a loop whose protagonist is a smudge.
- **The first five seconds were an empty garden.** `spawnAccumulatorMs`
  started at 0 against a 12s pod interval, under an onboarding banner reading
  "Drag a Sprout to its glowing home", with no Sprout to drag — against
  GameRules §6.1's explicit five-second requirement.

### Changes (three, as scoped)

1. **Creature presence.** `SPROUT_SPRITE_SIZE` 0.70 → 0.95 and camera
   `DEFAULT_RADIUS` 19 → 15 (moving both moderately rather than either past
   its own constraint — the settled-crowd slot table caps sprite width, and
   §4.2 caps how far the camera may come in). Added a per-Sprout ground
   contact shadow that tightens and darkens as the creature descends.
   `SPROUT_PICK_RADIUS` now derives from the sprite's half-width so the hitbox
   can never again be smaller than the visible art.
2. **Settle payoff.** Wired `reactCorrect`/`reactIncorrect` (the dead code) in
   `src/render/index.ts`, the only scope holding both the habitats handle and
   the resolved `MotionConfig`. Added a squash-then-overshoot cheer on the
   Sprout itself. Added a world-space Dewdrop mote that rises off a habitat on
   `habitat:dewdropTick`.
3. **The opening.** A fresh save now seeds its ordinary spawn accumulator with
   a head start (`INITIAL_SPAWN_ACCUMULATOR_MS`) so the first pod opens ~2s
   in. Not a special-cased first spawn: the ordinary system fires early, later
   pods keep the normal cadence, and restored saves are untouched.

Additionally, from a user report mid-pass: the **momentary solid square** when
picking up a Sprout was root-caused and fixed. `createManifestMaterial` starts
a material at a flat fallback colour with no texture and fills it in from an
async callback, so a material created at the moment it is first *shown* draws
as an opaque coloured rectangle for a frame or two. The three drag-tint
variants were created lazily on first pick-up — mid-gesture, under the cursor.
They now adopt an already-resolved sibling texture synchronously, and every
material a species will need is pre-warmed during the reveal.

### Evidence

Captured with `tests/e2e/settleFeel.dev.spec.ts` (`SETTLE_PHASE=before|after`),
screenshots under `docs/qa-screenshots/settle-loop/`.

| Measure | Before | After |
|---|---|---|
| Sprouts on screen within 5s of a clean save | 0 | 1 |
| Sprout billboard height at default camera | ~46 px plane (~28 px visible art) | **79.3 px** plane (**~48 px visible art**) |
| Contact shadow | none | present, enabled, visibility 0.33 |
| Peak habitat scale during a correct settle | 1.000 (reaction never invoked) | **1.087–1.104** across three consecutive runs (true amplitude 1.12) |
| World-space Dewdrop on `habitat:dewdropTick` | none | present |

**Tooling finding worth more than the numbers:** the in-app Browser pane
cannot run this game. Its tab reports `document.hidden` and throttles rAF to
~0.3 fps; because the sim derives ticks from rAF deltas, the simulation is
frozen and every screenshot is of a stopped game. Overriding `document.hidden`
does not help, and no scene handle is exposed for manual pumping. Claude in
Chrome was also unreachable this session. **Use Playwright for anything
timing- or animation-dependent.**

### Scores against the REFERENCE_BOARD rubric

| Category | Before | After | Note |
|---|---|---|---|
| Creature appeal and readability | 1 | **3** | **Below the required 4 — blocker documented below.** Real improvement (grounded with a contact shadow, ~1.7× larger, animated on settle), but scored against the measurement rather than the intent: the *visible creature* is ~48 px in a 720 px frame, ~7% of frame height, where the reference frames put creatures at 15–30%. A 3 is "coherent baseline, still lacks polish", and that is the honest reading. |
| Immediate interaction/reward satisfaction | 2 | **4** | Directly measured: peak habitat scale during a correct settle 1.000 → 1.119, plus a world-space Dewdrop mote where there was previously no world response at all. Four of six §5.3 channels now fire visibly. |
| Interaction clarity | 2 | **4** | Directly measured: Sprouts on screen within 5 s of a clean save 0 → 1, so the onboarding banner no longer asks for something that does not exist. Hitbox now derives from the sprite so it can never be smaller than the art. |

**Why creature appeal is reported as 3 and not 4.** The acceptance criterion
first written for this pass measured the *billboard plane* (79 px), which is
not the creature — `contentBBox` shows the opaque art occupies only V
0.16–0.77 of the sheet, so the visible creature is ~48 px. Scoring 4 against
the plane number would have meant grading against a criterion that does not
measure the thing it is named after. The criterion in
`tests/e2e/settleFeel.dev.spec.ts` has been corrected to assert on visible-art
height, and this is reported as a documented blocker with a concrete next fix
rather than as a pass.

### Remaining defects (honest)

- **The pointer-drag path fails under Playwright**, falling through to a
  camera pan. This is **pre-existing** — verified by stashing every local
  change and re-running the dev project, which reproduces the same 18 failures
  including `placement.dev.spec.ts`. Real players can pick Sprouts up (the
  user's own square-flash report proves it), so this is harness-side. It is
  the reason this spec drives its drop through the bus. **Not fixed here, and
  it needs fixing** — it blocks pointer-level regression coverage for the
  game's single most important interaction.
- **BLOCKER for creature appeal ≥ 4:** the Sprout texture wastes most of its
  plane on transparency (`contentBBox` ≈ 0.28–0.72 U, 0.16–0.77 V), so the
  visible creature is ~48 px where the references put creatures at 15–30% of
  frame height. The two world-space levers are both spent: the sprite cannot
  grow much further without breaking the settled-crowd slot invariant (six
  creatures on a 1.0-unit habitat top face, pinned by
  `tests/unit/render.settleSlots.test.ts`), and the camera cannot come much
  closer without losing the framing GameRules §4.2 requires. **Concrete next
  fix:** re-author the Sprout sprite sheets so the creature fills its plane —
  roughly a 1.6× gain in apparent size at zero world-space cost and zero
  crowd-layout risk — then re-measure `visibleArtPx` in
  `tests/e2e/settleFeel.dev.spec.ts`.
- **The very first correct placement stutters.** Found while trying to sample
  the habitat pulse: per-frame in-page sampling of the same code path returned
  peaks of 1.002 / 1.016 / 1.119 on three runs, which is only possible if
  whole frames are being dropped mid-pulse. The cause is that the first
  settle also compiles the sparkle burst's particle shader — a
  multi-hundred-millisecond hitch that eats most of a ~300 ms reaction. It
  lands on the single most important moment in the first session. Fix is to
  warm the particle system during load rather than on first use. (Once the
  first placement is past, sampling is stable at 1.087–1.104.)
- The "sleepy" mood badge is still an untextured grey-blue box floating beside
  the creature; at close camera it reads as a missing-texture artifact rather
  than a mood cue.
- Journal discovery still has no acknowledgement moment (§5.3 marks it
  optional, so this was left alone).

### Next high-impact improvement

Re-author the Sprout sprite sheets so the creature fills its plane, then
re-measure visible-art height; and fix the pointer-drag harness path so the
core interaction has real pointer-level regression coverage again.
