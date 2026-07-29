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
