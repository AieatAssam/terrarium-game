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

No `StandardMaterial` is used for any object in this list. Sprouts (see
below) are fully lit `PBRMetallicRoughnessMaterial` like everything else —
not an unlit exception (an earlier version of this doc incorrectly said
Sprouts used `disableLighting = true`; corrected this pass, see the Sprouts
section below).

## Procedural texture families (`src/render/pbrMaterials.ts`)

Performance rule: **one texture family per material *type* and *tiling
factor*, shared across every object requesting that exact combination** —
not one bespoke texture per mesh instance. Each family is a 256×256
(raised from an original 128×128 pass — see "Resolution and detail
increase" below) canvas-generated quartet, built once and cached by
`${familyName}@${tiling}` — the tiling factor is now part of the cache key,
not mutated on a shared texture after the fact (see that section's "cache
key includes tiling" note for why).

| Family | Height layers (macro + micro) | Roughness range | Metallic | Used by |
|---|---|---|---|---|
| `soil` | 90 clumps (r=20) + 260 fine pebbles (r=4) + grain | 0.70–1.0 (rough matte) | 0 | Ground plane (tiling 10) |
| `path` | 40 tread patches (r=20) + 140 grit specks (r=3) + grain | 0.39–0.71 | 0 | Garden path tiles, shared 1 instance (tiling 1) |
| `stone` | 70 chips (r=16) + 220 fine pores (r=3) + grain | 0.28–0.92 | 0 | Habitat drum bodies (tiling 3); scenery rocks (tiling 1, `applyRockDetail`) |
| `wood` | 16 long grain streaks (r=9, streak) + 55 fine grain lines (streak) + grain | 0.30–0.60 (satin) | 0 | Nursery mound body (tiling 2) |
| `paintedMetal` | 22 worn patches (r=14) + 70 scuff streaks (random angle) + grain | 0.20–0.72 | 0.03 base, up to 0.4 in a **sparse 10-speck mask** (r=3) — see caveat below | Automation site bodies (tiling 2) |
| `water` | 14 broad swells (r=26) + 44 ripple-crest streaks + grain | 0.03–0.25 (glossy) | 0 | Dew/water-accent scenery (tiling 2) |
| `foliage` | 26 leaf-cluster shadow pockets (r=14) + 90 vein-like streaks (random angle) + grain | 0.25–0.65 (waxy-satin) | 0 | Scenery bush/fern cards, tiling 1 (`applyFoliageDetail`) — new this pass |

Generation approach (see `pbrMaterials.ts` doc comments for full rationale):
1. A grayscale "height field" is drawn as TWO layered blotch/streak passes
   per family — a sparse **macro** layer (large-scale clumps/chips/grain
   lines/ripple swells, the main silhouette-scale detail visible at normal
   gameplay distance) and a denser **micro** layer (small pores/scuffs/
   vein-like flecks that add close-up character) — plus a subtle per-pixel
   **grain** jitter (deterministic PRNG, full 3×3-tile wraparound so it
   repeats cleanly with no corner seams — see "Seam handling" below).
   `wood`/`paintedMetal`/`foliage` use elongated "streak" blotches (radial
   gradient stretched + rotated) instead of round ones, for grain lines,
   scuff marks, and vein-like flecks respectively.
2. That height field is converted to a **tangent-space normal map** via a
   simple Sobel-style finite difference (`heightFieldToNormalTexture`).
3. The same height field's luminance is reused as a cheap **ambient
   occlusion** map, compressed into a gentle [0.55, 1] range — full-black AO
   reads as an ugly baked outline, which the brief explicitly warns against.
4. A **combined metallic-roughness texture** (glTF convention: G=roughness,
   B=metallic) combines a macro + micro sine pattern for roughness (so no
   single patch of a material is one uniform roughness value — the brief's
   "controlled micro-variation" rule) and, for `paintedMetal` only, a sparse
   radial mask pushing metallic up to a peak value only in a handful of
   small spots (see "Metallic is a true accent" below).
5. An **albedo variation** texture is now driven by the SAME height field as
   the normal/AO maps (previously an independent low-frequency sine pattern)
   plus a touch of per-pixel jitter — so darker recesses/raised
   grain/chips/pores read consistently across albedo, normal, AND AO instead
   of as three unrelated overlays.

### Resolution and detail increase (this pass)

Raised from 128×128 to **256×256** and switched from a single blotch layer
to a **two-octave** (macro + micro) system plus per-pixel grain, per family
above. This directly targets the prior pass's self-flagged gap ("the
procedural textures are deliberately simple/low-frequency... rather than
hero-quality hand-authored detail") — every family now has visibly more
surface character (grain, chips, pores, scuffs, vein-like flecks) at the
**default gameplay camera distance**, not just pressed up against the mesh.
Verified via browser QA (`docs/ART_QA_REPORT.md`): close-up `qaCamera`
framing on the Ember Nook stone body, the Nursery wood mound, and the
ground plane all show materially more visible relief and albedo mottling
than the 128px single-blotch version.

Generation is a one-time cost at material-family creation (never per-frame
or per-instance): measured live in-browser this pass at **~127ms total**
for all 8 families (soil, stone@tiling-3, wood, paintedMetal, water, path,
stone@tiling-1 for rocks, foliage) generated from a cold cache — soil (the
densest family: 350 blotches + grain over 256²) was the slowest single
family at ~29ms, water the cheapest at ~10ms. This happens once during
scene setup, spread across `buildGardenWorld`/`createHabitatManager`/
`createAutomationManager`, not as a single blocking frame — not visible as
user-facing jank in manual QA, but recorded here as a measured number
rather than an assumed-negligible one, per the brief's performance
requirement.

### Seam handling

Every blotch/streak/grain layer wraps across the full 3×3 tile neighborhood
(9 offset draws per feature: `WRAP_OFFSET_UNITS`), not just the 4
edge-adjacent offsets the original 128px pass used. At higher blotch
density (this pass's micro layers), a 4-neighbor wrap left corner-seam risk
uncovered; full 3×3 wrap closes that at negligible extra one-time draw
cost. Verified no visible seams at the tiling factors in use (browser QA,
`docs/ART_QA_REPORT.md`).

### Metallic is a true accent, not a flat tint (this pass)

`paintedMetal` previously used a single flat `metallic = 0.12` scalar
applied uniformly across the entire painted body — technically small, but
still a uniform metal contribution over 100% of the surface, not really an
"accent." It's now `metallic = 0.03` (near-zero paint) almost everywhere,
rising only inside a sparse 10-speck radial mask (`computeSparseMask`,
~3px radius specks on a 256px texture) — small exposed-brass-fitting
specks, matching the brief's "small brass-fitting-like glints... not a
uniform metal tint" recipe structurally (sparse, not a flat tint) rather
than fully matching it visually — see the honest caveat below. Every other
family stays at `metallic = 0` (soil/stone/wood/water/path/foliage — none
of these are metal surfaces). Audited: no other material in this file sets
a non-zero metallic value.

**Peak value kept conservative (0.4, not a more dramatic ~0.75) — and NOT
verified as reading like a "warm glint" on this project's default WebGPU
backend.** Browser QA on a full-alpha built automation site (forced via a
temporary debug probe, since the game's own build-unlock flow wasn't
reachable within the session) showed a higher peak reading as faint DARK
speckling on close inspection, not a bright accent — the physically
expected outcome, not a bug: a metallic surface's light response is
almost entirely specular/environment reflection (near-zero diffuse
albedo), and this project's default backend has no environment/IBL
contribution (see the WebGPU known-limitation section below), so without
that reflection term and without a specular highlight landing exactly on a
given speck at a given camera angle, "more metallic" mostly reads as
"darker" — the opposite of an accent. 0.4 is a compromise that stays
visibly distinct from the 0.03 paint base without pushing hard into that
dark-speckle failure mode; it has genuinely NOT been confirmed as a
positive "glint" on the WebGL path either (where real IBL specular
response would exist) — recorded here as an open gap for a future pass
with WebGL-path browser access, not silently assumed fine.

### Emissive audit (this pass)

Confirmed emissive stays reserved for magical/feedback elements, never a
baked-in "always on" glow on any of the procedural PBR bodies above:
- `soil`/`stone`/`wood`/`paintedMetal`/`water`/`path`/`foliage` families:
  none set `emissiveColor` at all (default black) inside `pbrMaterials.ts`.
- Habitat drum bodies (`habitats.ts`): `emissiveColor` starts `Color3.
  Black()` and is only driven non-black for the duration of the correct/
  incorrect-placement glow pulse (`setGlow`, `reactCorrect`/`reactIncorrect`)
  — a transient gameplay-feedback signal, not a resting-state glow.
- Automation site preview ghost (`automation.ts`): `emissiveColor` is set
  to a valid/invalid placement tint only on the transient placement-preview
  mesh, disposed as soon as the preview clears — same "interaction
  feedback, not decoration" category.
- Sprouts (`sprouts.ts`): the one documented always-on emissive user, and
  the one documented unlit exception (see below) — a deliberate exception
  for the game's #1 visual-hierarchy item, not scope creep.
No new emissive usage was introduced by this pass's material work.

## Per-material recipes

### Ground / soil (`createSoilMaterial`, `src/render/world.ts`)
- Physical character: loose garden soil, matte, gently mottled, with visible
  clump/pebble/grain relief instead of a flat plane.
- Maps: `soil` family albedo/normal/AO/metallic-roughness, tiled 10× across
  the ground plane. 256px, two-octave height field (90 macro clumps + 260
  fine pebble/grain flecks) + per-pixel grain jitter.
- Bump strength: 1.6 (raised from 1.1 — this pass's audit found soil was the
  material that most benefited from stronger relief; verified in browser QA
  it still reads as soft loose soil, not embossed/noisy, at both close-up
  and default gameplay distance).
- Roughness: 0.70–1.0 (rough matte, per brief's soil recipe), now with a
  0.08 micro-spread on top of the macro range for per-area variation.
- Metallic: 0.
- Perf: single material instance for the one ground mesh.

### Garden path (`createPathMaterial`, `src/render/world.ts`)
- Physical character: satin-worn stone/soil tread.
- Maps: Subagent C's manifest illustration (`path.segment.straight`) as
  `baseTexture` (the actual path artwork/linework), with the `path` family's
  normal/AO/metallic-roughness layered on top for surface detail — 256px,
  40 worn-tread patches + 140 fine grit/pebble specks + grain.
- **One shared material instance reused across every path tile** — the
  brief explicitly calls out avoiding "one material per repeated object";
  converting each tile to its own PBR material would have multiplied
  shader/uniform cost for what is visually the same repeated surface (this
  was flagged and fixed in an earlier pass — the original StandardMaterial
  implementation *did* create one material per tile).
- Tiling fixed at 1 as part of the family's own generation this pass (no
  longer mutated onto a shared texture after construction — see "Procedural
  texture families" above).

### Habitat drum bodies (`createStoneBodyMaterial`, `src/render/habitats.ts`)
- Physical character: rounded stone/ceramic, no razor-sharp edges (bevels
  come from the existing rounded-cylinder geometry, unchanged this pass).
- Maps: shared `stone` family (tiling 3), tinted per-habitat via `baseColor`
  (Ember Nook warm red-brown, Dew Pond cool blue, Sunflower Meadow olive).
  256px, 70 macro chip blotches + 220 fine pore flecks + grain.
- `baseTexture.level` raised from 0.35 to 0.5 — the earlier value was
  throttling the tinted-albedo variation contribution to ~35%, which visibly
  capped how much of this pass's richer underlying texture actually showed
  through the flat tint; 0.5 lets the extra chip/pore detail read without
  overpowering the per-habitat color identity (verified in browser QA).
- Bump strength: 1.3 (raised from 0.9).
- Roughness: 0.28–0.92 (raised spread from 0.38–0.82) — dry stone with
  slightly glossier warm edges, more per-area micro-variation.
- Emissive: driven at runtime by the existing correct/incorrect-placement
  glow pulse logic (`habitats.ts` `setGlow`) — unchanged behavior, still a
  transient feedback signal, not a resting-state glow (see "Emissive audit"
  above).

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
- Maps: shared `wood` family (tiling 2). Previously round radial blotches
  standing in for "grain-ish streaks"; now genuinely **elongated streak**
  blotches (16 long grain lines + 55 fine grain lines, both with a small
  random angle jitter so they don't look like a printed ruler-straight
  pattern) — a real wood-grain shape, not an approximation.
- `baseTexture.level` raised from 0.3 to 0.45, bump strength from 0.5 to 1.0,
  matching the same "the old level was hiding the new detail" fix as stone.
- Roughness: 0.30–0.60 (satin, warmer/smoother than the stone habitats), now
  with a 0.08 micro-spread.

### Automation site bodies (`createPaintedMetalMaterial`,
`src/render/automation.ts`)
- Physical character: painted garden equipment — satin roughness with
  sparse true-metal accents, not a full metal look and not a flat metal
  tint (see "Metallic is a true accent" above).
- Maps: shared `paintedMetal` family (tiling 2). 22 macro worn-patch
  blotches + 70 fine scuff/scratch streaks at randomized angles + grain —
  the scuffs are new this pass (previously blotches only, no directional
  scratch marks).
- Metallic: 0.03 base (near-zero paint), rising to 0.4 only inside a sparse
  10-speck mask — was a flat 0.12 everywhere; see "Metallic is a true
  accent" above for the reasoning AND the honest caveat: this was NOT
  confirmed to read as a positive "warm glint" in browser QA (metal
  specks need real specular/environment response to read as an accent
  rather than dark noise, and this project's default WebGPU backend has no
  IBL — see the known-limitation section below). The peak was kept
  conservative specifically because of that observed risk, not verified as
  ideal.
- `baseTexture.level` raised from 0.25 to 0.42, bump strength from 0.55 to
  0.9.
- Alpha: driven at runtime by build-state (0.4 unbuilt site marker → 1.0
  built; 0.55 + tint for the placement preview ghost) — unchanged behavior
  from the prior StandardMaterial version, same alpha/emissive fields exist
  on PBRMetallicRoughnessMaterial.

### Scenery: rocks (`createManifestMaterial` + `applyRockDetail`,
`src/render/world.ts` / `src/render/pbrMaterials.ts`)
- Physical character: painted card decals with their own baked ground
  shadow (unchanged from the prior "flat card" fix — see the existing doc
  comments in `world.ts`), now WITH a real PBR detail pass layered on top
  instead of a flat `roughness=0.55` card — new this pass.
- Maps: manifest art as `baseTexture` (unchanged) + the shared `stone`
  family's normal/AO/metallic-roughness at tiling=1 (`applyRockDetail`,
  `pbrMaterials.ts`) — same chip/pore detail as the habitat stone bodies,
  applied via the same "layer detail maps onto a manifest-art material"
  pattern `createPathMaterial` already used.
- Roughness: 0.28–0.92 (from the `stone` family, replacing the flat 0.55
  default).

### Scenery: foliage (`createManifestMaterial` + `applyFoliageDetail`,
`src/render/world.ts` / `src/render/pbrMaterials.ts`)
- Physical character: painted bush/fern card decals, now with leaf-cluster
  shadow pockets and vein-like fine streaks instead of a flat card — new
  `foliage` family this pass, explicitly called out in the brief as needing
  its own richer pass rather than the generic manifest-art default.
- Maps: manifest art as `baseTexture` (unchanged) + the new `foliage`
  family's normal/AO/metallic-roughness at tiling=1 (`applyFoliageDetail`).
  256px, 26 leaf-cluster shadow-pocket blotches + 90 vein-like streaks at
  randomized angles (so they read as scattered leaf veins, not a single
  repeated pattern) + grain.
- Roughness: 0.25–0.65 (waxy-satin — moderately smooth per the brief's
  "waxy leaves" recipe, with real per-area variation instead of a flat
  0.55).

### Water accent (`createWaterMaterial`, `src/render/world.ts`)
- Physical character: glossy local response, gentle animated ripple.
- Maps: `water` family (tiling 2, roughness 0.03–0.25) + Subagent C's
  manifest water-lily/reflection linework as `baseTexture` once it finishes
  rasterizing. 256px, 14 broad swell blotches + 44 ripple-crest streaks
  (elongated, randomized angle — reads as directional ripple crests rather
  than round soft blobs) + grain.
- Bump strength: 1.1 (raised from 0.8).
- Animation: the family's normal texture's `uOffset`/`vOffset` scroll slowly
  (`WaterMaterial.update(nowMs)`, called from `world.ts`'s per-frame
  `update`) — a cheap "ripple" rather than a real fluid simulation, in
  keeping with the brief's performance guidance.
- Alpha: 0.88 (slight translucency/depth cue).

### Sprouts (`createManifestMaterial`, `src/render/sprouts.ts`)
- **Correction (this pass)**: this section previously documented Sprouts as
  a `disableLighting = true` unlit exception. That no longer matches
  `sprouts.ts` (and hadn't for a while — `src/render/sprouts.ts`'s own doc
  comment already said "Lit, not unlit-disableLighting", and
  `docs/ART_DIRECTION.md` §9 already said the same; only this file's
  Sprouts section was stale). Fixed here rather than left inconsistent,
  since this pass's emissive audit depends on documenting Sprouts'
  emissive usage accurately.
- **Sprouts are lit** (`disableLighting` is never set — `createManifestMaterial`'s
  default, fully lit `PBRMetallicRoughnessMaterial`), with a modest
  emissive supplement so they stay readable in the fill light's cooler
  shadow side. The brief flags "unlit planes for interactive focal assets"
  as something to avoid; Sprouts satisfy that by being genuinely lit, not
  by an unlit-plus-emissive workaround.
  - This is safe from the usual "lit billboard looks odd as the camera
    orbits" risk: Sprouts are Y-billboarded sprites (`BILLBOARDMODE_Y`,
    matching the diorama-with-standees look), and `src/render/camera.ts`'s
    `ArcRotateCamera.alpha` (yaw) is never rotated by any input path in this
    project (`panBy`/`zoomBy`/`setRadius` only), so a billboard's
    world-facing direction — and therefore its lit response to the fixed
    key light — is constant for the whole session, not per-frame-varying.
  - Roughness 0.55, metallic 0 (waxy/matte, non-metal, matching the
    `createManifestMaterial` default).
  - `emissiveColor = fallback.scale(0.35)` — a modest boost (not the sole
    light contribution, since Sprouts are lit) so the type's primary color
    stays legible in shadow, tuned to match the surrounding lit PBR
    materials' brightness rather than reading as an oversaturated sticker.
    Counted in the "Emissive audit" above as the one deliberately
    always-on emissive user, consistent with the brief's "reserve emissive
    for magical elements" rule given Sprouts are the game's #1
    visual-hierarchy item (needs-attention readability, not decoration).

## Performance notes

- Every procedural texture family is 256×256 (raised from 128×128 this pass
  — see "Resolution and detail increase" above; 64×64 for the environment
  cube faces, unchanged) — generated once at material-family creation,
  never regenerated per-frame or per-instance. Measured cost: ~127ms total
  for all 8 families from a cold cache (see "Resolution and detail
  increase" above for the per-family breakdown) — a one-time scene-setup
  cost, not a per-frame or steady-state cost.
- Texture memory: 256² RGBA8 = 256KB per map × 4 maps (albedo/normal/AO/
  metallic-roughness) × 8 family instances (soil, stone@3, wood,
  paintedMetal, water, path, stone@1, foliage) ≈ 8MB total — small relative
  to typical browser GPU memory budgets, and still bounded/shared rather
  than growing with object count (adding a 4th habitat or a 10th foliage
  card costs zero additional texture memory, same as before this pass).
- No per-object bespoke textures: 8 shared families (up from 6 — `foliage`
  is new, and `stone` now has two cache entries at different tiling
  factors, see "cache key includes tiling" above) cover every piece of
  world geometry; only the manifest-art `baseTexture` (Subagent C's SVGs,
  rasterized once and cached by key in `assets.ts`) varies per asset *type*
  (not per instance — e.g. every Ember Sprout shares one texture per state).
  Path tiles share ONE material instance total (fixed a pre-existing "one
  material per tile" issue in an earlier pass).
  environmentIntensity kept modest (0.7) so it reads as ambient fill, not a
  competing light source, on the WebGL backend where it's active.
- Shadow map stays at the existing 1024/512 (quality-tiered) resolution;
  unchanged this pass — no new shadow casters or additional shadow-map
  passes were added.
- Not device-profiled beyond the browser QA session that produced the
  numbers above (same caveat as the prior pass's report) — the architecture
  (shared materials, bounded texture count/memory, no per-frame
  allocation) is sound, and the resolution increase's actual generation
  cost is now measured rather than assumed, but a real frame-rate profile
  across a range of devices hasn't been run.

## Known limitation

`scene.environmentTexture` (the procedural IBL cube, `src/render/
environment.ts`) is only assigned on the WebGL fallback path — assigning it
under WebGPU (this project's default backend) causes a full black-screen
render failure. Re-investigated this pass with a much sharper bisection
(six live-browser probes: real production texture, `RawCubeTexture` instead
of `CubeTexture`, size/mipmap variants, flat-vs-gradient content, hard-split
content, flat-but-per-face-varying content) — see `docs/ART_DIRECTION.md`
§9 and `docs/ART_QA_REPORT.md` for the full probe-by-probe results, and
`environment.ts`'s doc comment for the complete writeup. Headline finding:
the trigger isn't texture construction, size, or mipmaps — it's the cube
having ANY non-uniform content at all (even face-to-face flat-color
variation with zero within-face variation still crashes); only a
literally-uniform single-color-on-every-texel cube survives, and that
carries zero directional information over the existing HemisphericLight
fill, so it isn't worth shipping as a partial fix. `RawCubeTexture` (the
most different construction path available — bypasses the loader/
ImageBitmap/extension-lookup path entirely) was tried and does NOT avoid
the crash, confirming this is a content-triggered shader/compute bug, not a
texture-creation-path bug. All materials above still function fully
correctly without it (directional key + hemispheric fill carry the scene);
only the ambient/ "faint global bounce" contribution IBL would add is
absent on WebGPU until Babylon fixes this.
