# Tiny Terrarium Works — Material Library

Owner: E (render). Companion to `docs/ART_DIRECTION.md` (palette/lighting
plan) and the persona brief in `.claude/agents/visual-fidelity-artist.md`
(quality bar, per-material recipe requirements). This is the concrete
implementation record: every major material, what it's built from, and why.

All PBR material construction lives in `src/render/pbrMaterials.ts`
(procedural stone/soil/wood/painted-metal/water families) and
`src/render/assets.ts` (`createManifestMaterial`/`swapManifestMaterialTexture`,
the manifest-texture-backed PBR factory used for Sprouts and every standee
cap). The environment/IBL texture lives in `src/render/environment.ts`.

## Class and workflow

Every material below is `PBRMetallicRoughnessMaterial` (the glTF metal/
roughness convention: `baseColor`/`baseTexture`, `normalTexture`,
`occlusionTexture`, `metallicRoughnessTexture` with roughness in the green
channel and metallic in the blue channel, `metallic`/`roughness` scalars as
multipliers over those channels).

This was a deliberate choice over the plain `PBRMaterial` class: `PBRMaterial`
silently switches between its specular/glossiness and metallic/roughness
code paths based on whether `.metallic`/`.roughness` are non-null
(`isMetallicWorkflow()`) — an early attempt at this library set both a
`microSurfaceTexture` (specular/glossiness convention) *and* scalar
`.roughness` (which flips the class into metallic/roughness mode), and the
per-pixel texture was silently ignored. `PBRMetallicRoughnessMaterial` has
exactly one, unambiguous texture convention, so there's no equivalent
footgun.

No `StandardMaterial` is used for any object in this list. The one
documented exception is Sprouts' `disableLighting` (see below) — which is
still `PBRMetallicRoughnessMaterial`, just with Babylon's built-in unlit
flag set, not a different material class.

## Procedural texture families (`src/render/pbrMaterials.ts`)

Performance rule: **one texture family per material *type*, shared across
every object of that type** — not one bespoke texture per mesh instance.
Each family is a small (128×128) canvas-generated quartet, built once and
cached by name:

| Family | Albedo variation | Normal source | Roughness range | Metallic | Used by |
|---|---|---|---|---|---|
| `soil` | mottled green-brown, low-frequency sine blend | 90 random blotches → finite-difference normal | 0.7–1.0 (rough matte) | 0 | Ground plane |
| `path` | (albedo comes from manifest art, not this family) | 40 blotches, gentler | 0.4–0.7 (satin worn tread) | 0 | Garden path tiles (shared, 1 instance) |
| `stone` | white base, tinted per-habitat via `baseColor` | 70 small blotches (chips/pores) | 0.38–0.82 | 0 | Habitat drum bodies |
| `wood` | white base, tinted via `baseColor` | 26 larger blotches (grain-ish streaks) | 0.3–0.6 (satin) | 0 | Nursery mound body |
| `paintedMetal` | white base, tinted via `baseColor` | 34 blotches | 0.2–0.6 | 0.12 (small brass-fitting glints) | Automation site bodies |
| `water` | white base, tinted blue via `baseColor` | 18 large soft blotches, animated UV scroll | 0.08–0.2 (glossy) | 0 | Dew/water-accent scenery |

Generation approach (see `pbrMaterials.ts` doc comments for full rationale):
1. A grayscale "height field" is drawn as overlapping radial-gradient
   blotches (deterministic PRNG, wraps at tile edges so it repeats cleanly).
2. That height field is converted to a **tangent-space normal map** via a
   simple Sobel-style finite difference (`heightFieldToNormalTexture`).
3. The same height field's luminance is reused as a cheap **ambient
   occlusion** map, compressed into a gentle [0.55, 1] range — full-black AO
   reads as an ugly baked outline, which the brief explicitly warns against.
4. A **combined metallic-roughness texture** (glTF convention: G=roughness,
   B=metallic) is generated with the same low-frequency sine pattern as the
   albedo variation, so rough/smooth patches visually correlate with the
   bump instead of reading as an unrelated overlay.
5. A subtle **albedo variation** texture (low-frequency sine blend, not
   per-pixel noise) breaks up any pure flat RGB fill.

## Per-material recipes

### Ground / soil (`createSoilMaterial`, `src/render/world.ts`)
- Physical character: loose garden soil, matte, gently mottled.
- Maps: `soil` family albedo/normal/AO/metallic-roughness, tiled 10× across
  the ground plane.
- Roughness: 0.7–1.0 (rough matte, per brief's soil recipe).
- Metallic: 0.
- Perf: single material instance for the one ground mesh.

### Garden path (`createPathMaterial`, `src/render/world.ts`)
- Physical character: satin-worn stone/soil tread.
- Maps: Subagent C's manifest illustration (`path.segment.straight`) as
  `baseTexture` (the actual path artwork/linework), with the `path` family's
  normal/AO/metallic-roughness layered on top for surface detail.
- **One shared material instance reused across every path tile** — the
  brief explicitly calls out avoiding "one material per repeated object";
  converting each tile to its own PBR material would have multiplied
  shader/uniform cost for what is visually the same repeated surface (this
  was flagged and fixed during this pass — the prior StandardMaterial
  implementation *did* create one material per tile).

### Habitat drum bodies (`createStoneBodyMaterial`, `src/render/habitats.ts`)
- Physical character: rounded stone/ceramic, no razor-sharp edges (bevels
  come from the existing rounded-cylinder geometry, unchanged this pass).
- Maps: shared `stone` family, tinted per-habitat via `baseColor`
  (Ember Nook warm red-brown, Dew Pond cool blue, Sunflower Meadow olive).
- Roughness: 0.38–0.82 — dry stone with slightly glossier warm edges.
- Emissive: driven at runtime by the existing correct/incorrect-placement
  glow pulse logic (`habitats.ts` `setGlow`) — unchanged behavior, now
  applied to a PBR material instead of Standard.

### Habitat / Nursery / automation standee caps (`createManifestMaterial`,
`src/render/assets.ts`, consumed via `attachStandee` in `flatArt.ts`)
- Physical character: painted illustrated card — Subagent C's manifest art
  as `baseTexture`, cropped to its real content bounding box (see
  `docs/ART_DIRECTION.md` §8 for why).
- Roughness: 0.55 flat (no per-pixel map — these are billboarded cards, not
  a surface where bump/roughness variation would be visible at any angle
  worth the extra texture).
- Metallic: 0.
- Alpha: blended from the source art's alpha channel
  (`_useAlphaFromAlbedoTexture` — see the doc comment in `assets.ts` for why
  this is set via the internal field rather than a public property;
  `PBRMetallicRoughnessMaterial` doesn't expose the public setter that the
  sibling `PBRMaterial` class does, even though they share the same
  underlying base-class field).

### Nursery mound body (`createWoodBodyMaterial`, `src/render/world.ts`)
- Physical character: warm painted wood/soil mound the Pod stands on.
- Maps: shared `wood` family.
- Roughness: 0.3–0.6 (satin, warmer/smoother than the stone habitats).

### Automation site bodies (`createPaintedMetalMaterial`,
`src/render/automation.ts`)
- Physical character: painted garden equipment — satin roughness with a
  touch of metallic on scuffed/fitting areas, not a full metal look.
- Maps: shared `paintedMetal` family.
- Metallic: 0.12 (small brass-fitting-like glints only).
- Alpha: driven at runtime by build-state (0.4 unbuilt site marker → 1.0
  built; 0.55 + tint for the placement preview ghost) — unchanged behavior
  from the prior StandardMaterial version, same alpha/emissive fields exist
  on PBRMetallicRoughnessMaterial.

### Scenery: rocks / foliage (`createManifestMaterial`, `src/render/world.ts`)
- Physical character: painted card decals with their own baked ground
  shadow (unchanged from the prior "flat card" fix — see the existing doc
  comments in `world.ts`).
- Maps: manifest art as `baseTexture` only — no additional PBR detail pass;
  these are small, numerous, background-decoration pieces, and the brief
  explicitly asks to keep polygon/material budgets sensible for repeated
  props. Roughness 0.55 (createManifestMaterial's default).

### Water accent (`createWaterMaterial`, `src/render/world.ts`)
- Physical character: glossy local response, gentle animated ripple.
- Maps: `water` family (low roughness 0.08–0.2) + Subagent C's manifest
  water-lily/reflection linework as `baseTexture` once it finishes
  rasterizing.
- Animation: the family's normal texture's `uOffset`/`vOffset` scroll slowly
  (`WaterMaterial.update(nowMs)`, called from `world.ts`'s per-frame
  `update`) — a cheap "ripple" rather than a real fluid simulation, in
  keeping with the brief's performance guidance.
- Alpha: 0.88 (slight translucency/depth cue).

### Sprouts (`createManifestMaterial` + `disableLighting = true`,
`src/render/sprouts.ts`)
- **Documented stylisation exception**: `disableLighting = true` (Babylon's
  unlit flag), even though `PBRMetallicRoughnessMaterial` is used (not
  `StandardMaterial`). The brief flags "unlit planes for interactive focal
  assets" as something to avoid, and Sprouts are exactly that category — so
  this is a deliberate, reasoned exception, not an oversight:
  - The alternative (fully lit, `disableLighting = false`) was implemented
    and evaluated. Sprouts are Y-billboarded sprites (`BILLBOARDMODE_Y`,
    matching the diorama-with-standees look), and a lit billboard's
    world-space normal follows the camera's yaw. That would normally be a
    real risk (lighting shifting as the camera "orbits" a character), *but*
    `src/render/camera.ts`'s `ArcRotateCamera.alpha` (yaw) is never rotated
    by any input path in this project (`panBy`/`zoomBy`/`setRadius` only —
    verified by grep across `src/input/` and `src/render/camera.ts`), so the
    lit response would in fact be constant for the whole session, not
    per-frame-varying.
  - Kept unlit anyway: Sprouts must stay uniformly bright/readable across
    every lighting condition (bright vs. shaded parts of the garden,
    reduced-motion/high-contrast modes) since they are the single most
    important "needs attention" read in the game (visual hierarchy #1 in the
    brief). An emissive-driven unlit sprite guarantees that regardless of
    future lighting tuning; a lit one would be at the mercy of exact light
    placement matching every future camera-framing change.
  - Emissive color intensity was reduced this pass (from `0.9×` to `0.35×`
    the type's primary color) since it's now the *only* light contribution
    (no diffuse term), tuned to match the surrounding lit PBR materials'
    brightness rather than reading as an oversaturated sticker.
- Roughness/metallic: set (0.55 / 0) for consistency/future-proofing even
  though they have no visible effect while unlit.

## Performance notes

- Every procedural texture family is 128×128 (64×64 for the environment cube
  faces) — small, generated once at material-family creation, never
  regenerated per-frame or per-instance.
- No per-object bespoke textures: 6 shared families cover every piece of
  world geometry; only the manifest-art `baseTexture` (Subagent C's SVGs,
  rasterized once and cached by key in `assets.ts`) varies per asset *type*
  (not per instance — e.g. every Ember Sprout shares one texture per state).
  Path tiles share ONE material instance total (fixed a pre-existing "one
  material per tile" issue this pass).
  environmentIntensity kept modest (0.7) so it reads as ambient fill, not a
  competing light source.
- Shadow map stays at the existing 1024/512 (quality-tiered) resolution;
  this pass only tuned `bias`/`normalBias` for contact-shadow grounding, no
  new shadow casters or additional shadow-map passes were added.

## Known limitation

`scene.environmentTexture` (the procedural IBL cube, `src/render/
environment.ts`) is only assigned on the WebGL fallback path — assigning it
under WebGPU (this project's default backend) causes a full black-screen
render failure. See `docs/ART_DIRECTION.md` §9 and `docs/ART_QA_REPORT.md`
for the investigation and `environment.ts`'s doc comment for the exact
bisection that confirmed this. All materials above still function fully
correctly without it (directional key + hemispheric fill carry the scene);
only the ambient/ "faint global bounce" contribution IBL would add is
absent on WebGPU until this is resolved.
