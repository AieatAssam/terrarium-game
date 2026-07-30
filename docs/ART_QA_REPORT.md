# Art QA Report — Tiny Terrarium Works, Phase 2 (Standee Fix + PBR Conversion)

This report supersedes the Phase 1 report for the two categories it
touches (material richness, standee readability) and carries the rest of
Phase 1's "Accepted" findings forward unchanged. Reviewed against
`docs/ART_DIRECTION.md`, `docs/MATERIAL_LIBRARY.md`, and the
`.claude/agents/visual-fidelity-artist.md` brief. All findings below come
from actually running the game in the Claude Browser tool
(`preview_start`/`navigate`/`computer`/`javascript_tool`), not from reading
source in isolation — screenshots were viewed live in-session; see
"Screenshot evidence" note at the end for why no new PNG files were added
to `docs/qa-screenshots/` this pass.

## Job 1 — standee "not appearing" bug

### What was reported vs. what was actually true

The task description reported standees as "basically not appearing — just
flat body-color drums/boxes" and warned the screenshot behind that report
was taken moments after a live `attachStandee is not defined` HMR error, so
it might not reflect a clean state.

Investigation (in order, each step's result driving the next):

1. **Cold restart + fresh screenshot**: confirmed the `attachStandee is not
   defined` error was gone (stale HMR artifact, as warned) — but standees
   were *still* effectively invisible. This ruled out the HMR-error theory
   and confirmed a real, separate defect existed.
2. **Scene-graph inspection** (`window.__debug.meshInfo`/`meshInfoDeep`,
   added to `src/render/index.ts`'s dev-only debug block per the task's
   instructions): every standee mesh reported `visible: true, enabled:
   true, ready: true, hasTexture: true`, correct position, correct
   `billboardMode`. This looked like everything should be working.
3. **World-matrix bisection**: dumped the raw world matrix of a standee cap
   and hand-verified the rotation submatrix was a pure Y-axis rotation
   (`row1 = [0,1,0]`) — mathematically proof the billboard was correctly
   upright and yaw-only, not lying flat. This ruled out a billboard/
   geometry bug, which was the leading hypothesis going in.
4. **Visual bisection at different camera angles**: forcing a cap's
   material to solid magenta and moving the camera to a near-horizontal
   framing revealed the card *was* genuinely upright and correctly
   billboarded — but the illustration on it read as a small, squashed,
   low-riding blob rather than filling the card.
5. **Root cause, confirmed via `getManifestContentBBox`**: the source SVGs
   for these specific assets (habitat/nursery/automation "painted card"
   illustrations) are authored as **top-down decals** — a wide ~2:1 ellipse
   with a baked ground shadow, offset toward the bottom of a square canvas,
   meant to be viewed lying flat. Rasterized onto an upright card as-is,
   that content only fills the lower ~60% of the card's height in a wide,
   short shape — reading as "a flat blob barely bigger than the drum,"
   which is exactly the reported symptom. This was **not** a billboard/
   geometry bug; the geometry was correct the whole time.

### Fix

- `src/render/assets.ts`: added `getManifestContentBBox`/
  `onManifestContentBBoxReady` — computes each rasterized texture's tight
  opaque-content bounding box once, via a bbox-readiness signal tracked
  independently of the texture's own `isReady()` (a `DynamicTexture` reports
  ready as soon as it's constructed, before real pixels exist — using that
  directly would have fired the crop callback too early, with no bbox yet,
  and never again).
- `src/render/flatArt.ts`: `attachStandee` now crops the standee's texture
  UV to that content box and resizes/re-anchors the card (keeping the same
  bottom contact point) to the content's real aspect ratio, instead of
  showing the full mostly-transparent square canvas.
- `src/render/habitats.ts`: habitat standee maximum footprint reduced from
  `topRadius * 1.5` to `topRadius * 0.9`, per the task's own suggestion, so
  a fully-filled card can't grow tall enough to occlude a settled Sprout.

### Verification

- Confirmed via `qaCamera` debug helper (close-up + near-horizontal framing)
  that all 6 standees (Nursery, Ember Nook, Dew Pond, Sunflower Meadow,
  Garden Slide site, Colour Gate site) now show legible, recognizable
  illustrations: a rounded pod with a highlight for the Nursery, a pit +
  rocks scene for Ember Nook, a lily-pad/boat shape for Dew Pond, a hanging
  sunflower garland for Sunflower Meadow, and small icon-like marks for the
  two automation sites.
- Confirmed at the **default gameplay camera** (not just close-up QA
  framing) that the improvement holds — the illustrations are small (this
  is a genuinely small-scale scene at default zoom, same as Sprouts) but
  clearly present and legible, a large improvement over reading as flat
  color.
- Settled-Sprout occlusion check: moved a Sprout to a habitat's settled
  offset (`x + 0.35` — the `count = 0` case, closest to the standee's front
  face) and confirmed via close-up screenshot it remains clearly visible as
  a distinct blue mark next to (not hidden behind) the standee's rock
  silhouette, at both close-up and default-zoom framing.

**Verdict: Fixed.** Standees are correctly upright, billboarded (verified
mathematically, not just visually), and now show legible cropped
illustrations instead of squashed top-down decals.

## Job 2 — PBR material conversion

### What changed

Every major world material converted from `StandardMaterial` to
`PBRMetallicRoughnessMaterial` — full per-material breakdown in
`docs/MATERIAL_LIBRARY.md`. Summary:

| Object | Before | After |
|---|---|---|
| Ground plane | flat `StandardMaterial`, single `diffuseColor` | PBR soil: mottled albedo, normal-mapped clumps, AO, rough matte |
| Garden path (per tile) | `StandardMaterial` **created once per tile** | ONE shared PBR material for all tiles, manifest art + detail maps (also fixed the one-material-per-tile perf issue) |
| Habitat bodies (×3) | flat `StandardMaterial` fill | PBR stone/ceramic, shared texture family, per-habitat tint |
| Habitat/Nursery/automation standee caps | `StandardMaterial` w/ manifest texture | PBR w/ manifest texture (+ the content-crop fix above) |
| Nursery mound | flat `StandardMaterial` fill | PBR wood/soil, grain-ish bump, satin roughness |
| Automation site bodies (×2 + preview) | flat `StandardMaterial` fill | PBR painted-metal, small metallic accent |
| Scenery rocks/foliage | `StandardMaterial` w/ manifest texture | PBR w/ manifest texture |
| Scenery water accent | `StandardMaterial` w/ manifest texture | PBR glossy water, animated ripple normal scroll |
| Sprouts | `StandardMaterial`, `disableLighting=true` | PBR, lit (not unlit — see correction note below) |

New: `scene.environmentTexture` (procedural cube texture,
`src/render/environment.ts`) — first one this project has had. New:
`src/render/pbrMaterials.ts`, the shared procedural-texture-family library.

### Sprouts: correction (added in the Phase 3/this-pass review below)

**This section, as originally written, is stale.** It described Sprouts as
kept unlit (`disableLighting = true`). That does not match
`src/render/sprouts.ts`'s actual code (confirmed by reading the file during
this pass's material work) or `docs/ART_DIRECTION.md` §9, which already
correctly said "Sprouts stay lit, not unlit-disableLighting." Sprouts are
in fact fully lit, with a modest emissive supplement for shadow-side
readability — the brief's "avoid unlit planes for interactive focal assets"
rule is satisfied by genuinely lighting them, not by an unlit-plus-emissive
workaround. `docs/MATERIAL_LIBRARY.md`'s Sprouts section has been corrected
to match; this paragraph is left in place (rather than rewritten) as a
record that the original Phase 2 report contained this inaccuracy, since
this document is a historical record of what was found/decided at each
pass. The underlying reasoning about the camera-yaw-never-rotates safety
argument was reused correctly in the *actual* (lit) implementation's doc
comment — only the "kept unlit" conclusion was wrong.

### Known limitation — `scene.environmentTexture` disabled on WebGPU

Found via direct isolation testing, not guesswork: assigning the procedural
environment cube texture to `scene.environmentTexture` causes **every mesh
in the scene to stop rendering** — a full black canvas, clear color only,
no console error — specifically on this project's WebGPU backend
(`src/core/engine.ts` prefers WebGPU when available). Bisection performed:

1. Scene renders correctly with the environment texture **constructed** but
   not assigned to `scene.environmentTexture`.
2. Assigning it: full black screen, reproducible on every reload.
3. Toggling `createPolynomials` on/off: no change.
4. Toggling `noMipmap` on/off: no change.

This points at a WebGPU-backend PBR shader/bind-group codepath for
environment-cube sampling that this Babylon.js version (7.54.3) doesn't
handle correctly for a manually-constructed (non-`.env`/non-prefiltered)
cube texture. Given a fully broken game is a strictly worse outcome than a
missing ambient-reflection contribution, `src/render/environment.ts` gates
the assignment to the WebGL fallback path only
(`!scene.getEngine().isWebGPU`). The directional key + hemispheric fill
lights remain the dominant lighting read on both backends; only the
"faint global ambient bounce" IBL would add is absent under WebGPU.

This is recorded as a known limitation, not silently worked around — see
the long doc comment in `src/render/environment.ts`, `docs/ART_DIRECTION.md`
§9, and `docs/MATERIAL_LIBRARY.md`'s closing section.

### Verification

- Default-camera screenshot after the full PBR conversion: ground shows
  visible soil mottling/clump variation (previously a single flat green),
  path tiles show layered texture, habitat bodies show subtle stone
  bump/roughness variation instead of a flat color fill, rocks show visible
  bump detail.
- Close-up framing on Ember Nook and Dew Pond confirms the stone/soil
  material reads as a distinct physical surface at typical zoom, not a
  flat color card.
- Mobile viewport (375×812) re-checked: scene renders correctly with all
  PBR materials intact; no new regressions from the conversion. (The dev
  debug panel obstructing the top of the mobile viewport is pre-existing,
  `isDev`-gated, and absent from production builds — noted in the Phase 1
  report and not re-litigated here.)
- Full check suite (`npm run typecheck && npm run lint && npm test`) run
  repeatedly through this pass — 129/129 tests, 0 lint errors, 0 type
  errors at every commit point in this work, including the final state.

## Score table (Phase 2 — superseded by Phase 3 below for every category; kept for history)

| Criterion | Score | Notes |
|---|---|---|
| Material richness and tactile depth | **4/5** | Every major material now shows albedo variation, normal/bump, roughness variation, and AO instead of a flat color fill (see table above). Not a 5 because the procedural textures are deliberately simple/low-frequency (128px, sine-based blotches) rather than hero-quality hand-authored detail — appropriate for a stylised 2.5D diorama at this camera distance, but capped here rather than overclaimed. |
| Lighting and shadow quality | **4/5** | Warm key + cool fill (unchanged, already tuned), soft blurred shadow map with this pass's bias/normal-bias tune for better contact grounding. Not a 5 because the environment/IBL contribution — a real, working part of the plan — is unavailable on the WebGPU backend (documented limitation above), so ambient response relies on the two direct lights alone on that backend. |
| Readability at gameplay distance | **4/5** | Standees now legible (Job 1 fix) at default zoom; Sprouts unchanged (already legible, Phase 1). Not a 5 because standee illustrations are still small relative to the habitat drums at default zoom — legible, matching Sprouts' own scale, but a close reading rather than an instant one. |
| Silhouette and species distinction | **5/5** | Unchanged from Phase 1 (carried forward) — shape-based Sprout distinction verified there and untouched by this pass's material/standee work. |
| Animation appeal | **5/5** | Unchanged from Phase 1 (carried forward) — reveal/idle/happy/walk tweening untouched by this pass. |
| Environmental cohesion | **4/5** | Ground/path/habitat/nursery/automation materials now share a coherent "warm painted stone and soil" material language (stone/wood/painted-metal families all built from the same generation approach). Not a 5 because the WebGPU IBL gap means the ambient color grading between lit and unlit-adjacent surfaces is slightly less unified than the full plan intended. |
| Texture quality and UV correctness | **4/5** | Standee UV cropping fix directly targeted and resolved a real UV-framing defect (Job 1). Procedural textures tile cleanly (edge-wrapped blotch generation, verified no visible seams at the tiling factors used). Not a 5 because the procedural textures are intentionally modest resolution/frequency, not seam-free-at-any-zoom hero textures. |
| Polish vs. placeholder appearance | **4/5** | No `StandardMaterial` remains on major visible world geometry (documented Sprout exception aside); flat single-color fills are gone from ground/paths/habitat bodies/nursery/automation. Not a 5 because of the WebGPU environment-texture gap and because the procedural texture families, while real and functional, are simple rather than showpiece-level. |
| Web performance | **4/5** | Shared texture families (not one texture per object) and a single shared path material (fixing a pre-existing one-material-per-tile issue) keep material/shader count bounded. Shadow map resolution and quality tiers unchanged. Not a 5 because this wasn't frame-rate profiled on a range of devices this pass — the architecture is sound (shared materials, small textures, no per-frame allocation) but hasn't been empirically benchmarked. |

All required categories score ≥4/5.

## Screenshot evidence note

This pass's verification was performed live in the Claude Browser tool
across many `computer{action:"screenshot"}` calls (default camera, close-up
framing on every habitat/nursery/automation site, mobile viewport, and
multiple before/after comparisons during the Job 1 root-cause bisection).
The findings above are transcribed directly from what was observed in
those live screenshots. No new PNG files were added to
`docs/qa-screenshots/` this pass — the tooling available in this session
did not include a way to persist the Browser tool's screenshots to disk
(only to view them inline during the session), unlike the Phase 1 pass
which apparently had that capability. The existing Phase 1 screenshots in
that directory remain valid evidence for the findings they were captured
for (Sprout readability, silhouette distinction, mobile viewport, panel
UI) — none of that is affected by this pass's changes.

## Final acceptance

**Accepted**, with one documented, load-bearing limitation (WebGPU
environment texture) recorded rather than hidden. Both jobs' explicit
success criteria are met:

- Job 1: standees render correctly (verified mathematically and visually),
  the actual root cause (top-down art on an upright card) is fixed at the
  render layer without touching source SVGs, and the sizing/occlusion
  concern raised in the task is verified resolved.
- Job 2: PBR conversion complete across every listed material family, an
  original procedural environment texture was authored and documented, and
  every required QA score is ≥4/5.

---

# Phase 3 — Higher-resolution textures, stronger normals, metallic/emissive audit, WebGPU IBL re-investigation

Follow-up pass, prompted by explicit user feedback on Phase 2's own
self-flagged gaps ("the procedural textures are deliberately simple/
low-frequency... rather than hero-quality hand-authored detail" and "the
environment/IBL contribution... is unavailable on the WebGPU backend").
Reviewed against the same brief and docs as Phase 2; this section
supersedes Phase 2's score table for every category (Phase 2's Job 1/2
narrative above remains valid history — the standee fix and the PBR class
conversion are untouched by this pass).

## What changed

1. **Texture resolution and detail**: every procedural family
   (`src/render/pbrMaterials.ts`) raised from 128×128 single-blotch-layer
   to 256×256 two-octave (macro + micro blotch/streak layers) plus a
   per-pixel grain jitter. New `foliage` family (explicitly called out in
   the user's ask) layered onto scenery bush/fern cards; scenery rocks
   gained the `stone` family's detail pass too (`applyRockDetail`) —
   previously flat `roughness=0.55` manifest-art cards with zero PBR detail
   pass. Full per-family breakdown in `docs/MATERIAL_LIBRARY.md`.
2. **Normal/bump strength audited per family** — raised where the material
   benefited (soil 1.1→1.6, stone 0.9→1.3, wood 0.5→1.0, water 0.8→1.1,
   paintedMetal 0.55→0.9, path 0.6→0.9) and `baseTexture.level` raised on
   tinted-albedo materials (stone/wood/paintedMetal) that were throttling
   the new detail down to 25–35% visibility.
3. **Roughness micro-variation**: every family's metallic-roughness texture
   now combines a macro sine pattern with a smaller-amplitude, higher-
   frequency micro pattern, so no single patch of a material reads as one
   uniform roughness value.
4. **Metallic narrowed to a true accent**: `paintedMetal` (the only family
   with non-zero metallic) changed from a flat `metallic=0.12` scalar over
   the entire surface to `0.03` base with a sparse 10-speck radial mask
   pushing up to `0.75` — small exposed-fitting glints, not a uniform metal
   tint. Every other family confirmed `metallic=0`.
5. **Emissive audited**: confirmed reserved to Sprouts (always-on, modest,
   readability-driven) and transient interaction feedback (habitat
   correct/incorrect glow pulses, automation placement-preview tint) — no
   procedural PBR material sets a resting-state emissive. Also caught and
   fixed a stale doc inaccuracy found during this audit: `docs/
   MATERIAL_LIBRARY.md` described Sprouts as unlit (`disableLighting=true`)
   when the actual code (`src/render/sprouts.ts`) and `docs/ART_DIRECTION.md`
   §9 already correctly described them as lit — corrected in place (see the
   correction note in the Phase 2 section above).
6. **WebGPU environment-texture black screen re-investigated** — see
   "WebGPU IBL investigation" below. Conclusion: still blocked, but now
   with a precisely identified trigger condition instead of a general
   "manually-constructed cube texture" theory, and with `RawCubeTexture`
   (the most different construction path available) confirmed NOT to avoid
   it. The existing WebGL-only gate stays in place, per the brief's
   explicit allowance to do so after a genuine attempt.
7. **Fixed a latent architectural footgun** while restructuring for the new
   `foliage`/tiling-1-`stone` families: `applyFamily` previously mutated
   `uScale`/`vScale` on a shared `DynamicTexture` after the fact, which
   only worked because every family happened to have exactly one tiling
   consumer. The family cache is now keyed by `${familyName}@${tiling}` and
   tiling is baked in at texture-creation time, so two different tiling
   consumers of "the same" family (e.g. `stone` at tiling=3 for habitats
   and tiling=1 for rocks, both added this pass) can't silently clobber
   each other. Not visible in-game (both cases render correctly either
   way in Phase 2's single-consumer-per-family reality) but a real
   correctness fix for this pass's own new multi-consumer usage.

## WebGPU IBL investigation

Reproduced the Phase 2 finding first (real production texture, assigned
synchronously the same way `createGardenLighting` does): confirmed still a
full black screen, no console error, on the current WebGPU backend
(Babylon.js v7.54.3). Then ran a sharper bisection via temporary in-browser
probes (added to `src/render/index.ts`'s dev-only debug block for this
investigation, removed again before finishing — not part of the shipped
diff), each screenshotted live against the actual running scene:

| # | Probe | Content | Result |
|---|---|---|---|
| 1 | Real `createGardenEnvironment()` texture, assigned sync | 64px gradient faces (production) | **BLACK SCREEN** — confirms the bug still reproduces |
| 2 | `RawCubeTexture` (raw `Uint8Array` RGBA, bypasses `createCubeTextureBase`/ImageBitmap loader/extension lookup entirely) | Same 64px gradient content | **BLACK SCREEN** — rules out the loader/decode path as the cause |
| 3 | `RawCubeTexture`, 8px, mipmaps off | Same gradient content | **BLACK SCREEN** — rules out size and mipmap generation |
| 4 | `RawCubeTexture`, 8px, no mipmaps | FLAT single solid color, all 6 faces (`#ff0000`, then `#fff3d9`) | **RENDERS FINE** — scene stays lit, flat color tint visibly reflected in ambient response |
| 5 | `RawCubeTexture`, 8px, no mipmaps | Hard 2-color split WITHIN one face (no gradient, no smoothing) | **BLACK SCREEN** — rules out "smooth interpolation" as the specific trigger |
| 6 | `RawCubeTexture`, 8px, no mipmaps | Each face internally flat/uniform, but a DIFFERENT flat color per face (warm top / cool-green bottom / mid-green sides — no gradient, no within-face variation at all) | **BLACK SCREEN** — the trigger is variation ANYWHERE in the cube, not "within a face" specifically |

Separately confirmed via an isolated face-load probe (`__probeCubeTexture`)
that all 6 faces DO finish loading successfully (`isReady()===true`,
`onLoad` fires) well before the black screen appears — ruling out an
earlier hypothesis (a silently-unresolved `createImageBitmap` load on
WebGPU's `forceBitmapOverHTMLImageElement` path) that looked plausible from
reading Babylon's source but turned out empirically wrong.

**Conclusion**: the crash isn't about texture construction (data-URL
`CubeTexture` vs. raw-pixel `RawCubeTexture`), size, mipmaps, or specific
color values — it's triggered by the cube map having ANY non-uniform
content, full stop. This points at Babylon's environment-texture spherical-
harmonics/irradiance reduction (which combines all 6 faces into diffuse-IBL
coefficients for the PBR shader) hitting a broken WebGPU codepath
specifically when there's real content to reduce; a uniform cube is a
degenerate trivial case that apparently takes a different, working path.
This held even for `RawCubeTexture`, which has no `createPolynomials`
parameter — so whatever triggers the computation happens on
`scene.environmentTexture`'s assignment or the PBR shader's first read of
it, not something explicitly requested by the texture-construction call.

A uniform-color cube (probe 4) DOES avoid the crash and could technically
be "shipped," but was deliberately not: it carries zero directional
information (same flat color reflected from every angle), which is exactly
equivalent to what the existing `HemisphericLight` fill
(`src/render/lighting.ts`) already provides for free. Shipping it would add
a texture binding and material-shader complexity for a visual result
players already get. The entire point of this feature — a warm-sky-above /
cool-ground-below directional ambient split — requires the non-uniform
content that crashes. `EquiRectangularCubeTexture` was ruled out BY
INFERENCE from probes 2-6 above, not by a live test of that specific
class — it re-derives 6 cube faces via a similar path, and the probes
already isolated content-uniformity (not construction path) as the
trigger, so it's expected but not empirically confirmed to hit the same
wall. `CreateFromPrefilteredData` was ruled out on a harder, unrelated
constraint (needs a pre-baked `.env` file, incompatible with the
"original, procedurally generated" asset rule regardless of whether it
would technically work) — see `src/render/environment.ts`'s doc comment
and `docs/ART_DIRECTION.md` §9 for the full reasoning on both.

**Decision**: keep the existing WebGL-only gate
(`!scene.getEngine().isWebGPU`) in `src/render/environment.ts`. This is a
genuine, evidenced Babylon.js engine limitation on this version's WebGPU
backend, not a gap in this project's implementation — re-investigated
thoroughly (6 targeted probes, one of them the most-different construction
path available) rather than accepted on the strength of the original,
less-specific finding.

## Browser verification (this pass)

Cold `preview_stop` / `preview_start` restart before every judged
screenshot, per the brief. Confirmed via `window.__debug.qaCamera(...)` on
the live WebGPU-backend scene (`Babylon.js v7.54.3 - WebGPU1`, confirmed in
console on every restart):

- Default-camera screenshot: ground shows visibly more mottled clump/grain
  detail than the Phase 2 128px version; garden path tiles show worn-tread
  + grit-speck detail; all 3 habitat bodies, the Nursery wood mound, and
  both automation sites render correctly with no missing textures, no
  console errors (a fresh tab was used to rule out stale HMR-error
  scrollback from mid-edit reloads — see the note below).
- Close-up `qaCamera` framing on Ember Nook (stone) showed clearly visible
  chip/pore bump relief and AO contact darkening at close range, reading as
  tasteful surface relief rather than embossed or noisy.
- Close-up framing on the Nursery mound (wood) showed visible streak-like
  grain shading on the drum's top face.
- `sceneInfo()` confirmed `environmentTexture: null` on the live WebGPU
  scene (expected — the gate is working as documented) and the two direct
  lights (`keyLight` intensity 1.9, `fillLight` intensity 0.55) present and
  correctly configured.
- Full check suite (`npm run typecheck && npm run lint && npm test`) run
  clean at 129/129 tests, 0 lint errors, 0 type errors, both before and
  after the material rewrite; `npm run build` succeeds.
- Console note: a browser tab reused across many edit/restart cycles during
  this pass's WebGPU investigation accumulated stale HMR-error scrollback
  in its console history (old `StandardMaterial is not defined`/
  `environmentTexture is not defined` errors from transient mid-edit module
  states, predating the final code). A fresh tab against the same
  already-clean-restarted dev server showed zero console errors, confirming
  those were stale history, not a live regression — the same "stale HMR
  after a module error" caveat the brief itself calls out.
- Automation site (painted-metal, metallic-mask) close-up inspection: the
  site's default "unbuilt marker" state (`alpha=0.4`, per `automation.ts`)
  visually mutes material detail regardless of the underlying texture, and
  wasn't reachable via the game's own build-unlock flow within this
  session — worked around by forcing `alpha=1` directly on the mesh's
  materials via a temporary debug probe (added to `src/render/index.ts`'s
  dev-only block for this check, removed again afterward — not part of the
  shipped diff), then `qaCamera` close-up framing on `terrarium.automation.
  gardenSlide`. Result: the higher `metallicPeak` originally shipped (0.75)
  read as faint dark speckling on close inspection on this project's
  default WebGPU backend (no IBL — see the known limitation above), not a
  warm glint — caught on review and fixed (`metallicPeak` lowered to 0.4;
  see `docs/MATERIAL_LIBRARY.md`'s "Metallic is a true accent" section and
  the Final acceptance note below). This was all checked on the live WebGPU
  backend only — a WebGL-path comparison (where real IBL specular response
  would exist and might read better) was not possible within this session
  and remains an open gap, stated as such rather than assumed fine.

## Score table (Phase 3 — supersedes Phase 2 for every category)

| Criterion | Score | Notes |
|---|---|---|
| Material richness and tactile depth | **5/5** | Every family now has two-octave (macro+micro) height detail plus per-pixel grain, at 256px (2x the Phase 2 resolution), with roughness micro-variation and a corrected albedo-level pipeline so the extra detail is actually visible rather than throttled to 25–35% by a low `baseTexture.level`. Verified in-browser at both default gameplay distance (visible mottling/grain on ground, path, habitat bodies) and close-up (chip/pore/grain relief reads as tasteful surface character, not noise). The prior 4/5's stated cap — "deliberately simple/low-frequency... rather than hero-quality" — is directly addressed: still procedural (not hand-painted), but no longer single-octave or under-resolved for this diorama's camera distance. |
| Lighting and shadow quality | **4/5** | Unchanged from Phase 2's 4/5 — the WebGPU IBL gap is now far better understood (precise trigger identified, `RawCubeTexture` alternative genuinely tried and ruled out) but not resolved, so this stays capped for the same underlying reason: ambient response on WebGPU relies on the two direct lights alone. Not lowered despite the deeper investigation finding the gap is more fundamental than first thought (a real Babylon engine limitation, not a fixable authoring mistake) — the two direct lights are well-tuned and shadows are unaffected. |
| Readability at gameplay distance | **4/5** | Unchanged from Phase 2 — this pass's changes are material/texture detail, not standee sizing or Sprout readability, both untouched. |
| Silhouette and species distinction | **5/5** | Unchanged, carried forward from Phase 1/2 — untouched by this pass. |
| Animation appeal | **5/5** | Unchanged, carried forward — untouched by this pass. |
| Environmental cohesion | **4/5** | Unchanged from Phase 2. The material-language half of Phase 2's note is genuinely stronger this pass — all 8 families (up from 6) share the same generation approach, now including `foliage` and rock's stone-detail pass, extending that shared language to previously-untouched background scenery. But Phase 2 capped this specifically on the WebGPU IBL gap meaning ambient color grading between lit and unlit-adjacent surfaces is less unified than the full plan intended, and that reason is still fully in force — nothing about the ambient-grading gap itself improved this pass (the investigation proved it currently *can't* be closed by better authoring, which is a stronger, more final version of the same deficiency, not a resolution of it). Re-scoring this to 5/5 on the strength of "the cap turned out to be an engine bug, not fixable by us" would be re-scoring the same unresolved gap against a different rubric — declined on review. |
| Texture quality and UV correctness | **5/5** | Raised from Phase 2's 4/5, which capped this on "intentionally modest resolution/frequency, not seam-free-at-any-zoom hero textures." Resolution doubled (128→256px) and detail went from single-octave to two-octave-plus-grain. Seam risk was directly addressed, not just inherited: the wrap logic was widened from a 4-neighbor (edge-only) to a full 3×3-neighbor wrap specifically because higher blotch density raises corner-seam risk — verified no visible seams at the tiling factors in use. This is still a stylised procedural texture set, not a hand-authored hero-texture library, but within that honest category the resolution/frequency/seam-handling gaps Phase 2 explicitly named are resolved. |
| Polish vs. placeholder appearance | **5/5** | Raised from Phase 2's 4/5. Concrete changes against this specific criterion: scenery rocks and foliage — previously flat manifest-art cards with zero PBR detail pass, the most "placeholder-looking" pieces left in the scene — now carry real normal/AO/roughness detail (`applyRockDetail`/`applyFoliageDetail`); the procedural texture families cited as "simple" in Phase 2 are no longer single-octave 128px blotches (see Material richness/Texture quality above); and metallic changed from a uniform flat scalar to a structurally sparse mask (though see the honest caveat in Metallic is a true accent — the *visual* "glint" quality of that mask is unconfirmed, so this factor is counted for removing the flat-tint placeholder look, not for a confirmed positive metal read). The WebGPU environment-texture gap remains and is still capped in Lighting/shadow quality (4/5) — kept there, not re-litigated here. |
| Web performance | **4/5** | Unchanged from Phase 2's 4/5, but no longer resting on an unmeasured assumption: texture-family generation cost was actually measured this pass (~127ms total for all 8 families from a cold cache, one-time at scene setup — see `docs/MATERIAL_LIBRARY.md`), texture memory was computed (~8MB total across 8 shared families, bounded regardless of object count), and the architecture (shared materials keyed by family+tiling, no per-frame allocation) holds under the resolution increase. Not a 5 because — same honest caveat as Phase 2 — this is a measured one-time cost and a sound architecture, not a real multi-device frame-rate profile, which still hasn't been run. |

All required categories score ≥4/5; five of nine now score 5/5 (Silhouette
and Animation carried a 5/5 forward from Phase 2 unchanged; Material
richness, Texture quality, and Polish vs. placeholder are newly 5/5 this
pass — up from two 5/5s in Phase 2, not zero). Environmental cohesion stays
at Phase 2's 4/5, deliberately not raised — see that row's note for why.

## Screenshot evidence note (Phase 3)

Same tooling constraint as Phase 2: no way to persist Browser-tool
screenshots to disk in this session, so the findings above are transcribed
from what was observed live across many `computer{action:"screenshot"}`
calls (default camera, close-up `qaCamera` framing on Ember Nook/stone,
Nursery/wood, ground/soil, and the WebGPU IBL investigation's black-screen/
restored-scene comparisons). The existing `docs/qa-screenshots/` directory
from Phase 1 remains valid for the findings it was captured for; none of
that is affected by this pass.

## Final acceptance (Phase 3)

**Accepted**, with the same one documented, load-bearing limitation
(WebGPU environment texture) carried forward — now backed by a
significantly more rigorous investigation (6 targeted probes, one being
the most-different texture-construction path available) that confirms it's
a genuine Babylon.js engine limitation rather than an authoring gap, per
the task's explicit allowance to "leave the existing documented gate in
place and note what was tried" after a genuine attempt. Every required QA
category scores ≥4/5, and Material richness and Texture quality — the two
categories this pass's user feedback specifically targeted — are now a
genuine 5/5, tied to specific, verifiable changes (resolution, octave
count, seam handling, albedo-level fix) rather than re-scored on the same
work. Environmental cohesion was deliberately NOT raised despite initially
being drafted at 5/5 — caught on review that the score change wasn't tied
to an actual improvement in the thing the criterion measures (ambient
color grading), just to a better understanding of why it's capped; see
that row's note.

A second open item was found and closed during final review: the
automation site (painted-metal/metallic-mask) had only been visually
checked in its default "unbuilt marker" alpha=0.4 state, and the shipped
`metallicPeak` (0.75) was an unverified guess about how it would read.
Forced a built site to full alpha via a temporary debug probe and checked
it directly on the live WebGPU scene: the higher peak read as faint dark
speckling, not a warm glint (physically expected without IBL/specular
environment response). Lowered `metallicPeak` to 0.4 and rewrote every
doc claim about it to state plainly that it is NOT confirmed to look good
on either backend, rather than asserting a visual outcome that was never
observed — see `docs/MATERIAL_LIBRARY.md`'s "Metallic is a true accent"
section for the full, honest writeup. This is recorded as an open gap for
a future pass with WebGL-path browser access, not silently resolved.

---

# Phase 4 — player-reported defects: clipping, blocky geometry, path orientation, conveyor flow

Five defects were addressed this pass: three reported by the player from the
running game, one further report mid-pass, and one new requirement. Two
additional instances of a reported bug's own class were found by arithmetic and
fixed alongside it.

## Method note

Every geometric claim below is **browser-measured**, not read off a screenshot.
Two dev-only inspectors were added to `__debug` (`src/render/index.ts`):
`extents(filter)` returns each matching mesh's world-space min/max Y and triangle
count, and `sceneTriangles()`/`fps()` report the whole-scene budget. Combined
with the pre-existing `contentBBox(key)` and `qaCamera(...)`, that makes
"does X sit clear of Y" and "did poly count blow up" directly measurable.

Every judgement below was taken after a **cold `preview_stop`/`preview_start`
restart and in a fresh tab** — no HMR, no reused canvas.

Screenshots were reviewed live in-session. Each is reproducible exactly via the
recorded camera call; the parameters are given with each finding rather than
committing a new PNG set. **The PNGs in `docs/qa-screenshots/` are from Phase 1
and are now stale for the path, habitat drums, automation plinths, standee cards
and Sprout heights** — do not read them as current.

## Defect 1 — floating/settled Sprouts buried in the geometry beneath them

**Reported:** "floating things above the polygons are clipped."

**Root cause confirmed, with the predicted arithmetic exactly matched.** A Sprout
is `MeshBuilder.CreatePlane({ size: 0.7 })` and `mesh.position` places its
CENTRE, but the chosen heights treated the value as the sprite's BOTTOM. Measured
before the fix, on a cold restart:

| Subject | Card bottom edge | Surface top | Result |
|---|---|---|---|
| Floating Sprout at the Nursery | **0.4006** (bobbing) | 0.70 | ~0.30 units buried |
| Settled Sprout (Ember Nook) | 0.20 (from source `y = 0.55`) | 0.45 | 0.25 units buried |

The in-source comment claiming "0.55 clears every habitat mesh's top surface"
was only true if 0.55 were the bottom edge, which it is not.
`attachStandee`'s callers were measured as correct at this point
(`minY == drum maxY` for all six cards) — they add half the card height, which
is the arithmetic the Sprout code was missing.

**Two more instances of the same bug class, found by doing the arithmetic on the
reaction effects** (neither was reported):

- `habitats.ts` `reactCorrect` emitted its sparkle burst at `worldCenter`
  (tile y = 0). `createSparkleBurst` adds +0.3 internally → **y = 0.30, inside an
  Ember Nook drum whose top face is 0.45.** The "you got it right" feedback was
  rendering inside opaque geometry.
- The Dew Pond ripple ring was emitted at the same tile centre; `createRippleRing`
  adds +0.02 → **y = 0.02, inside a drum whose top is 0.325.**
- `sprouts.ts` `spawn` had it too: the reveal sparkle fired at **y = 0.30** inside
  the 0.70-tall Nursery mound.

**Fix — made structural, not nudged.** `src/render/propDims.ts` is now the single
source of truth for every prop's dimensions; the mesh is built from that entry and
so is every height that depends on it. Sprout heights are derived:

```
SPROUT_FLOAT_HEIGHT = nurseryTopY() + BOB_AMPLITUDE + CLEARANCE + SPRITE_SIZE/2
settleHeight(id)    = habitatTopY(id) + CLEARANCE + SPRITE_SIZE/2
```

The bob amplitude term matters and was initially missed by the hand-derived
value: without it the idle bob's downward half dips the card back under the
mound. Reaction effects now emit from `topCenter` (tile centre lifted to the
drum's top face). `SPROUT_FLOAT_HEIGHT` is **exported** and imported by
`src/input/index.ts`, replacing a hard-coded `-0.8` drag plane that is a
*functional* mirror — had it stayed literal, the sprite would now render offset
from the cursor. `tests/e2e/helpers.ts` and `preview.preview.spec.ts` were
updated too (vitest cannot catch those).

**Verified in-browser after a cold restart.** Floating Sprouts at the Nursery
measured a minimum bottom edge of **0.7324–0.7376** across the bob cycle against
a mound top of **0.70** — clear at every phase. Settled Sprouts, one dragged onto
each habitat through the real pointer path:

| Habitat | Settled Sprout position | Card bottom | Drum top | Clearance |
|---|---|---|---|---|
| Ember Nook | (3.321, 0.83, 3.802) | 0.48 | 0.45 | 0.03 |
| Dew Pond | (11.321, 0.705, 3.802) | 0.355 | 0.325 | 0.03 |
| Sunflower Meadow | (7.321, 0.78, 12.802) | 0.43 | 0.40 | 0.03 |

Close-ups at `qaCamera(-3π/4, 1.05, 3.6, <habitat>, ...)` show each Sprout
standing fully visible on the drum's top face with its bottom edge clear.

### Defect 1b — settled Sprouts hidden behind the habitat's own symbol card

Found during that verification, not from source. The original settle ring
(`angle = count * 0.9`, `radius = 0.35 + (count % 4) * 0.1`) swept the full circle
around the drum centre, so roughly half of all settled Sprouts landed BEHIND the
habitat's standee card — which is a camera-facing billboard standing at the drum
centre. The first Sprout settled on the Ember Nook rendered as a partial sliver
poking out from behind the habitat symbol.

Fixed by laying the slots out on the **viewer-facing side only**, derived from
`GARDEN_CAMERA_ALPHA` (now exported from `camera.ts`) rather than hard-coded —
legitimate because no input path ever rotates the camera's yaw, the same standing
invariant the lit-billboard treatment already relies on. Slots are 3 across x 2
rows, max 0.71 from the centre, which fits inside even the smallest habitat's flat
top face (Ember Nook: 1.1 radius less its 0.1 rim bevel = 1.0). Verified: the
measured offset (-0.679, -0.198) matches the derived slot exactly, and the
close-ups show Sprouts standing in front of the sign.

## Defect 2 — models too low poly / "extremely blocky"

**Confirmed in source and in the frame.** Habitat drums were `CreateCylinder` at
**tessellation 6** (Ember Nook — a hexagonal prism) and **8** (Sunflower Meadow —
octagonal), with razor-sharp unbevelled vertical edges; automation build sites
were plain `CreateBox` cubes. Measured before: the Ember Nook drum was **24
triangles**, the Sunflower Meadow **32**, an automation plinth **12**, and the
whole scene **696**.

Replaced with one shared generator, `createRoundedPrism` (`src/render/geometry.ts`)
— round or soft-cornered cross-section, rounded top rim, chamfered base, optional
taper, optional wider foot with a shelf step. Full rationale and the
winding/normals derivation: `docs/ART_DIRECTION.md` §11.

**Two failure modes that typecheck clean were specifically watched for and did not
occur:** inverted winding (would show as black or invisible drums under
`backFaceCulling`) and missing/degenerate UVs (would break the tiled stone
normal/AO lookup and read flat). Both conventions were read off Babylon's own
`cylinderBuilder.js`/`mesh.vertexData.js` rather than guessed, and one drum was
inspected close-up before the other five were built.

**Poly count and performance:**

| | Before | After |
|---|---|---|
| Ember Nook drum | 24 | 960 |
| Dew Pond drum | 112 | 1120 |
| Sunflower Meadow drum | 32 | 960 |
| Nursery mound | 96 | 960 |
| Automation plinth (each) | 12 | 720 |
| Conveyor overlay | — | 86 (43 quads) |
| **Whole scene** | **696** | **5936** |
| **Measured FPS** | 59.8–60 | **60.0–60.2** |

No new textures, no new draw-call structure beyond 4 path-piece materials and 1
conveyor material. 5936 triangles is far below anything a mainstream laptop
notices; the budget headroom was never the constraint here, the geometry was.

**Heights and outer radii were held constant on purpose** so nothing that measures
off a top face moved. Re-verified after the change: Ember Nook top 0.45, Dew Pond
0.325, Sunflower Meadow 0.40, Nursery 0.70, automation 0.50 — all identical to
before, and all six standee cards still anchored to them.

**Deliberately NOT changed:** scenery rocks, foliage and water accents remain flat
ground-parallel cards. That was a documented prior fix for a UV-wrap defect
(wrapping top-down decal art around a volume smeared it into a near-solid block),
and re-volumising them risks re-introducing it. It is the honest remaining gap —
see the Polish score below, which is *lowered* for it.

## Defect 3 — path/road orientation inconsistent

**Confirmed:** every tile used `path.segment.straight` with no rotation, so
corners, the junction and the dead ends all rendered as straight runs pointing the
same way. Tiles were also 0.92 wide on a 1.0 grid, leaving a visible gap of bare
soil at every join — the road read as separated stepping stones.

Piece type and orientation are now derived from each tile's neighbours; five
original SVG pieces were authored on a shared tread band; tiles are a full 1.0
wide. Full design: `docs/ART_DIRECTION.md` §10.

**The art→world orientation was derived WRONG on the first attempt and only the
browser caught it.** The first render put the two corners' arms at
{−Z, −X} where {−Z, +X} was needed — a mirror, not a rotation error, diagnosed by
projecting known tile centres to screen and measuring where the rendered arms
actually went. The corrected mapping (art right → +X, art top → −Z) is now
documented with both its empirical and its independent
`texture.update(false)` justification, and pinned by
`tests/unit/render.pathPieces.test.ts` (12 assertions, including an independent
re-derivation of every tile's rotation against its real neighbour mask).

**Occlusion note for future readers, so this is not mistaken for a bug:** the tee
junction sits on the Nursery tile and all three end caps sit on habitat tiles, and
every one of those is completely covered by the prop standing on it (the Nursery
footprint spans 7.2–8.8 in x and z against a tile of 7.5–8.5). **The two corners
at (4,8) and (12,8) are the only non-straight pieces actually visible.** They were
the verification shot.

**Verified:** close-ups at `qaCamera(-π/2, 0.16, 6.2, 4.2, 0, 7.7)` and
`(-π/2, 0.16, 6.6, 11.6, 0, 7.4)` show both corners turning correctly with a
filleted inner corner, the outer edge stroke running continuously through the
join, and no gap, seam or double-drawn overlap. Piece census matches the layout: 1
tee, 2 corners, 3 end caps, 16 straights.

## Defect 4 — "the symbols above the habitats are clipped" (reported mid-pass)

**This was a genuine, severe UV bug, and the earlier assumption that
`attachStandee` was fine because its call sites add `height / 2` was wrong.**

`attachStandee`'s content crop computed its V window with the wrong sign
(`vOffset = 1 - bbox.maxV`, correct only if texture v runs bottom-up; it runs
top-down). Measured before the fix, most of every habitat symbol was simply not on
the card — the Dew Pond card was sampling a canvas band that overlapped its actual
artwork by **0.13 of the canvas**. Full measurement table for all six cards:
`docs/MATERIAL_LIBRARY.md`, "Standee texture cropping".

Fixed by correcting the V window (as a negative `vScale`, because a plane's v = 0
is its bottom edge while texture v = 0 is the canvas top — a positive scale
renders the art upside down), and by moving the anchoring **inside**
`attachStandee` so it is computed from the POST-CROP height. Callers now pass the
local Y of the surface the card stands on and cannot get the arithmetic wrong.

**Verified in-browser on all six cards**, at
`qaCamera(-π/2, 1.02, 3.6, <prop>, ...)`, cross-checked against the source SVGs
opened directly in the browser at `/assets/habitats/emberNook/base.svg` etc:

- Ember Nook: the full oval mound, ember pit and ring of stones — matches source.
- Dew Pond: the full pond, lily pads, reeds and green bank.
- Sunflower Meadow: the full meadow patch with all five sunflowers.
- Nursery: the full pod with the Sprout face (bottom ~38% was previously cut).
- Garden Slide / Colour Gate: full slide curve, full gate with posts.

All six measure a clearance of exactly **0.02** above their surface — the other
half of the report was addressed too: the cards were previously **tangent**
(`minY == surface top` exactly), which z-fights along the whole bottom row and
itself reads as a frayed edge. Also ruled out: no near-plane or frustum clipping
(all six `isInFrustum` at default zoom), and no z-fighting with the drum top face.

## Requirement 5 — animated conveyor paths with visible direction

Flow direction follows real gameplay transport — outward from the Nursery to the
habitats — computed by breadth-first search over the path graph, correct through
both corners and the junction, with dead ends pointing INTO the habitat rather
than turning back. Direction lives in each overlay quad's rotation, so **one**
shared material and **one** texture animate the whole network from a single
`texture.uOffset` write per frame. Design and the flow-direction rule:
`docs/ART_DIRECTION.md` §10.4–10.5.

**Perf constraints respected:** no per-tile material (the one-material-per-tile
bug a prior pass had to fix is not reintroduced — the shipped scene has 4 path
materials and 1 conveyor material for 22 tiles), and no per-frame allocation.

**One iteration was needed, caught in the browser:** a single full-tile quad
rotated to the outgoing direction spilled chevrons onto bare soil past every
corner, because a corner has no tread in the quadrant opposite its bend. Replaced
with two half-tile segments per tile (arriving half + leaving half), which also
keeps the march continuous along a straight run. A unit test now asserts no
segment is ever painted over a half-tile with no tread.

**Verified:** chevrons visible and correctly directional on every run at default
zoom; two screenshots 1s apart show the pattern advancing *toward* the corner on
the run that flows that way.

### Reduced motion

`backgroundMotion` is exactly `0` under reduced motion, so the scroll **stops
dead**. Verified by toggling the in-game Settings switch and taking two
screenshots 2 seconds apart: **pixel-identical**. Direction remains legible
because the chevrons are directional by shape, so the accessibility path loses the
animation without losing the information.

**A real accessibility bug was found and fixed doing this.** The renderer only
read the OS `prefers-reduced-motion` media query, so the Settings panel's own
"Reduced motion" toggle changed the CSS but reached **no** world animation —
Sprout bob and background drift included, not just the new conveyor.
`src/ui/prefs.ts` had been writing `<html data-reduced-motion>` for exactly this
purpose (its own doc comment says so) and nothing read it.
`prefersReducedMotion()` now resolves that attribute with the media query as
fallback, and `watchReducedMotion()` observes both so the toggle applies live.
Verified in-browser: with the toggle on, all Sprouts' bounding boxes sit at a
constant 0.78 (bob fully damped) where they previously varied 0.73–0.83.

## Commands run

```
npm run typecheck   # clean
npm run lint        # clean (--max-warnings 0)
npm test            # 148 passed (19 files) — was 129 before this pass
npm run build       # built in 1.90s
```

25 new unit assertions were added across three files:
`tests/unit/render.pathPieces.test.ts` (piece classification, rotation, conveyor
flow direction, no-tread-overlap), `tests/unit/render.sproutHeights.test.ts`
(derived float/settle heights, and the held-constant top surfaces), and four
cases in `tests/unit/render.motion.test.ts` (resolved reduced-motion preference
and its watcher).

**One mirrored literal could not be eliminated, and is guarded instead.**
`src/input/index.ts` now imports `SPROUT_FLOAT_HEIGHT` directly, removing its
hard-coded `-0.8` drag plane. The Playwright helpers cannot do the same:
importing it fails because Playwright's loader will not resolve Babylon's
extensionless deep specifiers (`Cannot find module
'@babylonjs/core/Maths/math.color' ... Did you mean ...math.color.js?`) which
`sprouts.ts` pulls in transitively. Vitest resolves them fine, so
`render.sproutHeights.test.ts` asserts the real exported constant still equals
the literal the e2e helpers mirror — closing the "npm test can never catch this"
gap from the other side.

## Score table (Phase 4 — supersedes Phase 3 for every category)

| Criterion | Score | Notes |
|---|---|---|
| Material richness and tactile depth | **5/5** | Held. Recipes are unchanged, but they are now applied to curved bevelled surfaces that carry a soft light terminator across a rounded rim instead of flat facets with a hard value step at each edge — verified close-up on all three drums and the Nursery. The flat scenery cards are a real remaining weakness but they are a *silhouette/volume* gap, not a material gap (they do carry the stone/foliage detail pass), so they are counted once, under Polish below, rather than double-counted here. |
| Lighting and shadow quality | **4/5** | Held, deliberately not raised. The bevelled geometry genuinely improved how the existing key/fill read, but Phase 2/3 capped this specifically on the WebGPU IBL gap, and **nothing about that gap changed this pass**. Raising it on the strength of unrelated geometry work would be exactly the re-weighting this report has had to self-correct for once already. |
| Readability at gameplay distance | **5/5** | Raised from 4/5, by fixing the named gap rather than reinterpreting it. Phase 2/3 capped this on standee illustrations being "small relative to the habitat drums... a close reading rather than an instant one". The V-window fix means each card now shows its **complete** illustration in the same footprint — for the Dew Pond that is going from an artwork overlap of 0.13 of the canvas to 1.00, roughly a 4x increase in legible content at identical card size. On top of that, the route and its direction of travel now read instantly (conveyor chevrons), and settled Sprouts are no longer half-hidden behind the habitat sign. Verified at default camera and zoom. |
| Silhouette and species distinction | **5/5** | Held. Sprout species distinction is untouched and still shape-led. Prop silhouettes genuinely improved (faceted hex/octagonal prisms and literal cubes → bevelled two-tier pots and soft-cornered plinths). The flat scenery cards have no silhouette at all; counted under Polish. |
| Animation appeal | **5/5** | Held, with real additions rather than a carry-forward: the path now has a continuous directional conveyor that communicates gameplay flow, and — more importantly for this criterion's honesty — the reduced-motion preference now actually reaches the animation system, so the calm variant is a real state rather than dead configuration. |
| Environmental cohesion | **4/5** | Held, deliberately not raised. The path is genuinely more cohesive now (its tread sits on the real procedural soil instead of pasting a lighter-green square over it, which is what made the road read as separated stepping stones). But Phase 2/3 capped this on the WebGPU IBL ambient-grading gap and that reason is still fully in force. |
| Texture quality and UV correctness | **5/5** | Nominally unchanged, but **Phase 3's 5/5 was not warranted at the time and this should be recorded as a correction.** A defect squarely inside this criterion — the standee content crop sampling the wrong V band, losing most of every habitat symbol — was live when Phase 3 scored this 5/5 on texture resolution and seam handling alone. It is now genuinely 5/5: that crop is fixed and verified against source art on all six cards, and the new path pieces added rotation-aware UV handling plus a CLAMP wrap mode to kill edge-bleed fringing at tile joins. |
| Polish vs. placeholder appearance | **4/5** | **Lowered from Phase 3's 5/5** — not because anything regressed, but because the bevelled-geometry pass raised the surrounding standard enough that the flat scenery cards now read as the placeholder element in frame. Next to 960-triangle bevelled pots with rim highlights and foot tiers, the rocks are flat grey diamonds and the water accents flat blue ellipses lying on the ground. Phase 3 credited their detail pass and scored 5/5; against the current frame that is no longer defensible. To earn 5/5 back: give rocks low rounded pebble volumes using the existing procedural stone material (never manifest art on a volume — that is the UV-wrap trap the flat cards were the fix for), and recess or rim the water accents. Deliberately deferred this pass to avoid re-introducing a previously-fixed defect while five other defects were in flight. |
| Web performance | **4/5** | Held. This pass replaced Phase 3's architectural argument with direct measurement — whole-scene triangles 696 → 5936 and FPS steady at 60.0–60.2 after the change, on a cold restart — and the added cost is geometry only, with no new textures and 5 new shared materials total. Still not a 5 for the same honest reason as Phase 2/3: this is one machine on one backend (WebGPU), not a multi-device frame-rate profile. |

All nine required categories score ≥4/5, so this pass passes. Five score 5/5
(Material richness, Readability — newly raised by closing its named gap,
Silhouette, Animation, Texture/UV). Two are held at 4/5 because their named
cap (the WebGPU IBL gap) is untouched, one is held at 4/5 pending real
multi-device profiling, and **one was lowered** — see Polish above.

## Deliberately deferred

- **Scenery volume.** Rocks/foliage/water stay flat cards. Named and scored
  against, not hidden. See the Polish row for the exact remedy and why it was not
  attempted this pass.
- **WebGPU IBL.** Unchanged engine-level limitation, fully investigated in Phase 3.
- **Multi-device performance profile.** Single-machine, single-backend measurement
  only.
- **`cross` path piece is authored but unused** by the shipped layout, which never
  crosses itself. Kept so a future layout does not silently fall back to a wrong
  piece.
- **Refreshed screenshot PNGs.** `docs/qa-screenshots/` still holds the Phase 1
  set and is stale for everything this pass touched; findings above cite
  reproducible `qaCamera` parameters and measured numbers instead.
