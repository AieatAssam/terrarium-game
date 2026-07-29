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
| Sprouts | `StandardMaterial`, `disableLighting=true` | PBR, `disableLighting=true` (documented exception — see below) |

New: `scene.environmentTexture` (procedural cube texture,
`src/render/environment.ts`) — first one this project has had. New:
`src/render/pbrMaterials.ts`, the shared procedural-texture-family library.

### Sprouts: documented unlit exception

The brief flags "unlit planes for interactive focal assets (Sprouts,
habitats, ...)" as something to avoid. Sprouts were kept unlit
(`disableLighting = true`) after actually implementing and evaluating the
lit alternative — full reasoning in `docs/MATERIAL_LIBRARY.md`'s Sprouts
section and the doc comment in `src/render/sprouts.ts`. Short version: the
usual risk with a lit billboard (inconsistent lighting as the camera
orbits) doesn't apply here because the garden camera's yaw never rotates at
runtime (verified by grep — only pan/zoom exist), but Sprouts are the #1
item in the game's visual hierarchy and must stay uniformly readable
regardless of *future* lighting/camera tuning, not just current settings —
an emissive-driven unlit sprite guarantees that; a lit one would not.

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

## Score table

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
