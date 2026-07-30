// Static garden geometry: terrain, garden paths, water basins and the
// procedurally-generated decorative scenery layer. Positions come exclusively
// from src/render/layout.ts + tileToWorld — no invented screen-space
// placement. Habitats and automation structures are built by their own
// modules (habitats.ts, automation.ts) since they need reactive behavior this
// module doesn't.
//
// ---------------------------------------------------------------------------
// What changed in the procedural-world pass
// ---------------------------------------------------------------------------
//   * The ground is no longer a flat single-colour plane. It is a subdivided
//     mesh displaced by src/render/layout.ts's seeded height field, with
//     per-vertex tinting from the same field, and it is flattened to exactly
//     y = 0 under every gameplay surface so nothing that stands on it moved.
//   * Scenery is no longer 22 hand-listed flat billboard cards. It is a
//     seeded procedural scatter of real bevelled volumes — stones, folded
//     grass blades, leaf clusters, fungi, lily pads — drawn as THIN INSTANCES
//     (one draw call per master mesh, hundreds of objects) with per-instance
//     transform and colour variation.
//   * Water accents are recessed into carved basins with a stone shoulder,
//     instead of a flat blue ellipse lying on the soil.
//   * Buying "Decorative Expansion I" reveals a second generated layer
//     (kerb, lanterns, flower beds, moss carpet) — see `revealExpansion`.
//
// Everything generated here is deterministic: the layout module owns the seed
// and exports frozen instance arrays, so this module never rolls anything of
// its own and a reloaded garden is pixel-identical.

import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix } from '@babylonjs/core/Maths/math.vector';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
// Side-effect import: thin instances live in a prototype-extension module.
// This project deep-imports narrow Babylon submodules for tree-shaking, so
// without this `mesh.thinInstanceSetBuffer` is simply not a function at
// runtime — typecheck stays green because the .d.ts augmentation ships in the
// main types entry regardless of what was imported.
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Material } from '@babylonjs/core/Materials/material';
import type { PBRMetallicRoughnessMaterial } from '@babylonjs/core/Materials/PBR/pbrMetallicRoughnessMaterial';
import type { Scene } from '@babylonjs/core/scene';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';

import { GRID_SIZE, tileToWorld } from './coords';
import { attachStandee } from './flatArt';
import {
  basinRimVertexData,
  blossomVertexData,
  createMeshFromVertexData,
  createRoundedPrism,
  discVertexData,
  kerbStoneVertexData,
  lanternVertexData,
  leafClusterVertexData,
  lilyPadVertexData,
  mergeVertexData,
  mushroomVertexData,
  pebbleVertexData,
  transformVertexData,
  tuftVertexData,
} from './geometry';
import {
  BASE_SCENERY,
  EXPANSION_SCENERY,
  GARDEN_PATH_PIECES,
  PATH_DIRECTION_OFFSETS,
  NURSERY_TILE,
  WATER_BASINS,
  basinSurfaceHeight,
  groundTintAt,
  terrainHeightAt,
  type PathPiece,
  type SceneryInstance,
  type SceneryKind,
} from './layout';
import { bodyRings, halfHeight, NURSERY_BODY } from './propDims';
import { easeOutBack, easeOutCubic, type MotionConfig } from './motion';
import { createFireflies, createSparkleBurst, type FireflySystem } from './particles';
import {
  createFoliageBodyMaterial,
  createFungusMaterial,
  createLanternGlassMaterial,
  createPaintedMetalMaterial,
  createPathFlowMaterial,
  createPathMaterial,
  createPetalMaterial,
  createSceneryStoneMaterial,
  createSoilMaterial,
  createWaterMaterial,
  createWoodBodyMaterial,
  type LanternGlassMaterial,
  type WaterMaterial,
} from './pbrMaterials';
import type { EventBus, Unsubscribe } from '../events';
import { loadGame } from '../persistence';

export interface GardenWorld {
  nursery: Mesh;
  ground: Mesh;
  paths: Mesh[];
  /** Every decorative mesh in the world — base scatter plus, once revealed,
   * the first-expansion layer. Kept as a flat list for QA/debug enumeration;
   * each entry is a thin-instance MASTER carrying many objects. */
  scenery: Mesh[];
  /** Advances animated water-accent ripple normal maps, the garden path's
   * conveyor-flow chevrons, foliage wind sway and the expansion reveal — call
   * once per frame (wired from src/render/index.ts's render loop). Takes the
   * MotionConfig because every one of those has to respect reduced motion. */
  update: (motion: MotionConfig, nowMs: number) => void;
  /** True once the first decorative expansion has been revealed. Exposed for
   * QA/e2e assertions, not used by gameplay. */
  isExpansionRevealed: () => boolean;
  dispose: () => void;
}

/** One full grid tile — mirrors TILE_WORLD_SIZE in src/sim/grid.ts, which is
 * private there (src/render/coords.ts mirrors the same constant for the
 * inverse mapping). Path tiles are exactly tile-sized so adjacent treads abut
 * with no gap. */
const PATH_TILE_SIZE = 1;

/** Width of the tread band inside a path tile, matching the 68/160 band every
 * piece SVG in public/assets/paths/ is drawn with. The conveyor overlay is cut
 * to this so the chevrons stay on the path. */
const PATH_TREAD_WIDTH = (PATH_TILE_SIZE * 68) / 160;

/** Chevron marches per second along a tile at full motion. */
const PATH_FLOW_SPEED = 0.55;

/** World Y of the terrain datum — the height the ground plane sits at where
 * `terrainHeightAt` returns 0. Unchanged from the flat-ground pass so path
 * tiles (y = 0.01) still sit just proud of the soil. Every scattered object
 * adds this to its generated height. */
const GROUND_Y = -0.05;

/** How far a scattered object is pushed into the soil, so its base is bedded
 * in rather than tangent to the surface (which reads as floating the moment
 * the terrain curves away underneath it). */
const SCENERY_BED = 0.015;

/** Ground mesh subdivision count. 56 gives ~0.39 world units per quad across
 * the 22-unit apron — fine enough to resolve the height field's ~4-unit
 * wavelength swells smoothly without a visible facet, and 6272 triangles is a
 * rounding error next to the scenery. */
const GROUND_SUBDIVISIONS = 56;

/** Wind sway: peak lean in radians at sway = 1, and the base angular speed.
 * Small on purpose — this is a breeze through a terrarium, not a gale, and
 * anything larger reads as objects wobbling rather than the air moving. */
const SWAY_AMPLITUDE = 0.085;
const SWAY_SPEED = 1.05;

/** First-expansion reveal timing (full motion). The stagger runs outward from
 * the garden centre so the new layer reads as the garden GROWING outward,
 * which is the §6.6 "the world feels larger" beat, rather than everything
 * popping in at once. */
const REVEAL_DURATION_MS = 620;
const REVEAL_STAGGER_MS = 1100;

// ---------------------------------------------------------------------------
// Thin-instance scatter groups
// ---------------------------------------------------------------------------

/** Which shared material family a master mesh renders with. There is exactly
 * ONE material per entry here for the whole garden, however many thousands of
 * objects use it — per-object colour variation rides on the thin-instance
 * colour buffer instead. */
type ScatterMaterial = 'stone' | 'foliage' | 'petal' | 'fungus' | 'lanternFrame' | 'lanternGlass';

interface MasterPart {
  /** Suffix appended to the master's mesh name, so two parts of one object
   * (lantern frame + glass) are distinguishable in the scene graph. */
  suffix: string;
  data: VertexData;
  material: ScatterMaterial;
  /** Alpha-blended parts must not write into the shadow map. */
  castsShadow: boolean;
}

/**
 * A set of master meshes sharing ONE thin-instance transform buffer, plus the
 * generated instances that drive it.
 *
 * Sharing the buffer across parts is what makes a multi-material object (a
 * lantern's painted frame and its glowing glass) still cost one transform
 * update rather than two: both meshes are handed the same Float32Array.
 */
interface ScatterGroup {
  meshes: Mesh[];
  instances: SceneryInstance[];
  matrices: Float32Array;
  /** True if any instance sways, i.e. matrices must be rewritten per frame
   * while motion is enabled. */
  animated: boolean;
  /** Set while a reveal tween is running; matrices are rewritten regardless
   * of `animated` until it finishes. */
  revealStartMs?: number;
  revealDurationMs: number;
  revealStaggerMs: number;
  revealBounce: boolean;
  /** Per-instance stagger offset in [0,1], by distance from garden centre. */
  revealOrder: Float32Array;
  /** False until the reveal tween has run to completion (or was never needed). */
  settled: boolean;
}

const scratchScale = new Matrix();
const scratchRotation = new Matrix();
const scratchWorld = new Matrix();

/**
 * Writes every instance's world matrix into the group's shared buffer.
 *
 * Called once at build time and then per frame only while something is
 * actually moving (wind sway, or a reveal tween in progress). Deliberately
 * allocation-free: three module-level scratch matrices are reused, and the
 * destination is a preallocated Float32Array, so a 200-instance group costs no
 * garbage per frame — GameRules §12 bans per-frame allocation.
 */
function writeMatrices(group: ScatterGroup, timeSec: number, ambient: number, nowMs: number): void {
  const { instances, matrices } = group;
  const revealing = group.revealStartMs !== undefined && !group.settled;
  const easing = group.revealBounce ? easeOutBack : easeOutCubic;
  let allRevealed = true;
  for (let i = 0; i < instances.length; i++) {
    const instance = instances[i];
    let scale = instance.scale;
    if (revealing) {
      const delay = group.revealOrder[i] * group.revealStaggerMs;
      const t = (nowMs - (group.revealStartMs as number) - delay) / group.revealDurationMs;
      if (t < 1) allRevealed = false;
      scale *= Math.max(0, easing(t));
    }
    // Sway pivots at the object's ROOT, which is where every generator puts
    // its origin, so a swaying tuft bends from the soil rather than sliding.
    const sway = instance.sway * ambient * SWAY_AMPLITUDE;
    const roll = instance.tiltZ + (sway === 0 ? 0 : Math.sin(timeSec * SWAY_SPEED + instance.phase) * sway);
    const pitch = instance.tiltX + (sway === 0 ? 0 : Math.cos(timeSec * SWAY_SPEED * 0.73 + instance.phase * 1.4) * sway * 0.6);
    Matrix.ScalingToRef(scale, scale, scale, scratchScale);
    Matrix.RotationYawPitchRollToRef(instance.rotationY, pitch, roll, scratchRotation);
    scratchScale.multiplyToRef(scratchRotation, scratchWorld);
    scratchWorld.setTranslationFromFloats(instance.x, GROUND_Y + instance.y - SCENERY_BED, instance.z);
    scratchWorld.copyToArray(matrices, i * 16);
  }
  if (revealing && allRevealed) group.settled = true;
}

export function buildGardenWorld(scene: Scene, shadowGenerator: ShadowGenerator, bus: EventBus): GardenWorld {
  // -------------------------------------------------------------------------
  // Terrain
  // -------------------------------------------------------------------------
  const ground = MeshBuilder.CreateGround(
    'terrarium.ground',
    {
      width: GRID_SIZE + 6,
      height: GRID_SIZE + 6,
      subdivisions: GROUND_SUBDIVISIONS,
      // `updatable` is load-bearing, not defensive. MeshBuilder allocates
      // non-updatable (static) vertex buffers by default, and a later
      // `updateVerticesData` against one of those does NOT throw — it silently
      // does nothing. Found in browser QA: the displaced terrain rendered as a
      // perfectly flat plane and `__debug.extents('terrarium.ground')` reported
      // minY === maxY === -0.05, i.e. the whole height field was being
      // computed and then discarded.
      updatable: true,
    },
    scene,
  );
  const groundCenter = tileToWorld({ x: (GRID_SIZE - 1) / 2, z: (GRID_SIZE - 1) / 2 });
  ground.position.set(groundCenter.x, GROUND_Y, groundCenter.z);
  ground.receiveShadows = true;
  // Displace + tint. The ground is the largest surface on screen and was
  // previously a flat single-colour plane; this gives it real form (seeded
  // swells, carved basin bowls) and real colour variety (drier crests, mossier
  // hollows) while staying EXACTLY flat under every gameplay surface — see
  // layout.ts's TERRAIN_FLATTEN_BAND. Nothing that stands on the ground had to
  // move, because the datum under it did not.
  {
    const positions = ground.getVerticesData(VertexBuffer.PositionKind) as Float32Array;
    const indices = ground.getIndices() as number[];
    const colors = new Float32Array((positions.length / 3) * 4);
    for (let i = 0, c = 0; i < positions.length; i += 3, c += 4) {
      const worldX = positions[i] + groundCenter.x;
      const worldZ = positions[i + 2] + groundCenter.z;
      positions[i + 1] = terrainHeightAt(worldX, worldZ);
      const tint = groundTintAt(worldX, worldZ);
      colors[c] = tint.r;
      colors[c + 1] = tint.g;
      colors[c + 2] = tint.b;
      colors[c + 3] = 1;
    }
    ground.updateVerticesData(VertexBuffer.PositionKind, positions);
    const normals: number[] = [];
    VertexData.ComputeNormals(positions, indices, normals);
    ground.updateVerticesData(VertexBuffer.NormalKind, normals);
    ground.setVerticesData(VertexBuffer.ColorKind, colors, false, 4);
    // Bounding info is computed at build time from the FLAT plane, so it has
    // to be recomputed or the mesh's bounds (and therefore its frustum test
    // and any picking against it) still describe a flat plane.
    ground.refreshBoundingInfo();
  }
  // No manifest key for base terrain (C's asset list is creatures/habitats/
  // structures/scenery pieces, not a ground texture), but a real PBR soil
  // material — mottled albedo, normal-mapped clumps/pebbles, rough matte
  // response, AO in the "pores" — rather than a flat StandardMaterial fill.
  // See src/render/pbrMaterials.ts createSoilMaterial. The vertex colours
  // above multiply that albedo.
  ground.material = createSoilMaterial(scene);

  // -------------------------------------------------------------------------
  // Garden path (unchanged by this pass)
  // -------------------------------------------------------------------------
  // Piece type + rotation come from each tile's neighbours (see
  // src/render/layout.ts's GARDEN_PATH_PIECES) rather than every tile being
  // drawn as an unrotated straight run, which is what made corners, the
  // Nursery junction and the dead ends all point the same way.
  //
  // One shared material PER PIECE TYPE (at most five), not per tile — tiles
  // of the same type reuse the material and rotate their own mesh.
  const pathMaterials = new Map<PathPiece, PBRMetallicRoughnessMaterial>();
  const pathMaterialFor = (piece: PathPiece): PBRMetallicRoughnessMaterial => {
    const cached = pathMaterials.get(piece);
    if (cached) return cached;
    const material = createPathMaterial(
      scene,
      `terrarium.path.${piece}.mat`,
      `path.segment.${piece}`,
      new Color3(0.62, 0.55, 0.42),
    );
    pathMaterials.set(piece, material);
    return material;
  };
  // Conveyor flow overlay: one shared scrolling-chevron material (see
  // createPathFlowMaterial) plus one thin quad per tile, each ROTATED so its
  // local +X points the way Sprouts actually travel — outward from the Nursery
  // toward the habitats. Because direction lives in the per-tile rotation, a
  // single u offset animates the whole network correctly, including round the
  // corners and through the junction; nothing scrolls in a global screen
  // direction.
  const pathFlow = createPathFlowMaterial(scene);
  const paths: Mesh[] = [];
  for (const { tile, piece, quarterTurns, flowSegments } of GARDEN_PATH_PIECES) {
    const world = tileToWorld(tile);
    // A FULL tile wide (was 0.92): the piece art's arms run right to the
    // canvas edge, so anything under 1.0 leaves a visible gap of bare soil at
    // every tile join and the road reads as separated stepping stones.
    const path = MeshBuilder.CreateGround(`terrarium.path.${tile.x}.${tile.z}`, { width: PATH_TILE_SIZE, height: PATH_TILE_SIZE }, scene);
    path.position.set(world.x, 0.01, world.z);
    path.rotation.y = quarterTurns * (Math.PI / 2);
    path.receiveShadows = true;
    path.material = pathMaterialFor(piece);
    path.isPickable = false;
    path.metadata = { kind: 'path', tile, piece, quarterTurns };
    paths.push(path);

    // One quad per HALF tile (arriving half + leaving half), each only as wide
    // as the tread band. Half-tiles rather than one full-tile quad because a
    // corner has no tread in the quadrant opposite its bend — a full-tile quad
    // rotated to the outgoing direction spilled chevrons onto bare soil past
    // every corner.
    for (const segment of flowSegments) {
      const step = PATH_DIRECTION_OFFSETS[segment.halfDirection];
      const flow = MeshBuilder.CreateGround(
        `terrarium.path.flow.${tile.x}.${tile.z}.${segment.halfDirection}`,
        { width: PATH_TILE_SIZE / 2, height: PATH_TREAD_WIDTH },
        scene,
      );
      flow.position.set(world.x + step.x * PATH_TILE_SIZE * 0.25, 0.02, world.z + step.z * PATH_TILE_SIZE * 0.25);
      flow.rotation.y = segment.travelQuarterTurns * (Math.PI / 2);
      flow.material = pathFlow.material;
      flow.isPickable = false;
      flow.receiveShadows = false;
      flow.metadata = { kind: 'path.flow', tile, segment };
      paths.push(flow);
    }
  }

  // -------------------------------------------------------------------------
  // Shared scenery materials — one per family for the whole garden
  // -------------------------------------------------------------------------
  const lanternGlass: LanternGlassMaterial = createLanternGlassMaterial(scene, 'terrarium.scenery.lanternGlass.mat');
  const scatterMaterials: Record<ScatterMaterial, Material> = {
    stone: createSceneryStoneMaterial(scene, 'terrarium.scenery.stone.mat'),
    foliage: createFoliageBodyMaterial(scene, 'terrarium.scenery.foliage.mat', new Color3(0.3, 0.46, 0.26)),
    petal: createPetalMaterial(scene, 'terrarium.scenery.petal.mat'),
    fungus: createFungusMaterial(scene, 'terrarium.scenery.fungus.mat', new Color3(0.72, 0.62, 0.52)),
    lanternFrame: createPaintedMetalMaterial(scene, 'terrarium.scenery.lanternFrame.mat', new Color3(0.32, 0.3, 0.28)),
    lanternGlass: lanternGlass.material,
  };

  // -------------------------------------------------------------------------
  // Master meshes, one per (kind, variant)
  // -------------------------------------------------------------------------
  // Every scattered object in the garden is one of these, drawn as a thin
  // instance. Variant counts here MUST match the `variants` declared for each
  // layer in src/render/layout.ts — the generator picks a variant index in
  // [0, variants).
  const masterParts = (kind: SceneryKind, variant: number): MasterPart[] => {
    const seed = 0x51ed * (kind.length + 1) + kind.charCodeAt(0) * 7919 + variant * 104729;
    switch (kind) {
      case 'pebble':
        return [
          {
            suffix: 'body',
            data: scaleData(pebbleVertexData({ seed, segments: 10, rings: 6, flatten: 0.42, lumpiness: 0.26 }), 0.17),
            material: 'stone',
            castsShadow: false,
          },
        ];
      case 'boulder':
        return [
          {
            suffix: 'body',
            data: scaleData(pebbleVertexData({ seed, segments: 14, rings: 9, flatten: 0.66, lumpiness: 0.24 }), 0.52),
            material: 'stone',
            castsShadow: true,
          },
        ];
      case 'kerb':
        return [{ suffix: 'body', data: scaleData(kerbStoneVertexData(seed), 0.62), material: 'stone', castsShadow: true }];
      case 'tuft':
        return [
          {
            suffix: 'body',
            data: tuftVertexData({ seed, blades: 6 + variant, height: 0.23 + variant * 0.05, width: 0.048, spread: 0.1 }),
            material: 'foliage',
            castsShadow: false,
          },
        ];
      case 'bush':
        return [
          {
            suffix: 'body',
            data: leafClusterVertexData({ seed, leaves: 8, radius: 0.36, height: 0.44 + variant * 0.08, droop: 0.5, tiers: 3 }),
            material: 'foliage',
            castsShadow: true,
          },
        ];
      case 'fern':
        // Fronds ARCH — they rise then bend over — rather than being pitched
        // steeply downward. An earlier pass used droop 0.95, which rotated
        // whole fronds ~70 degrees below horizontal and buried their tips
        // 0.46 units under the soil (caught by `__debug.extents`, not by the
        // screenshot). The arc now comes from a long `bend` on the blade plus
        // a modest pitch, which is both correct and a better silhouette.
        return [
          {
            suffix: 'body',
            data: leafClusterVertexData({ seed, leaves: 7, radius: 0.52, height: 0.4, droop: 0.42, tiers: 2 }),
            material: 'foliage',
            castsShadow: true,
          },
        ];
      case 'mushroom':
        return [{ suffix: 'body', data: mushroomVertexData(seed), material: 'fungus', castsShadow: true }];
      case 'lily':
        return [{ suffix: 'body', data: lilyPadVertexData(seed), material: 'foliage', castsShadow: false }];
      case 'blossom': {
        const blossom = blossomVertexData({ seed, petals: 5 + (variant % 2), radius: 0.07 + variant * 0.012 });
        return [
          { suffix: 'stem', data: blossom.stem, material: 'foliage', castsShadow: false },
          { suffix: 'petals', data: blossom.petals, material: 'petal', castsShadow: false },
        ];
      }
      case 'lantern':
      default: {
        const lantern = lanternVertexData(seed);
        return [
          { suffix: 'frame', data: lantern.frame, material: 'lanternFrame', castsShadow: true },
          // The glass is alpha-blended and emissive: keeping it out of the
          // shadow map avoids a hard opaque square being stamped under every
          // lantern, which is what a blended caster produces.
          { suffix: 'glass', data: lantern.glass, material: 'lanternGlass', castsShadow: false },
        ];
      }
    }
  };

  const scenery: Mesh[] = [];
  const groups: ScatterGroup[] = [];

  /**
   * Groups a generated instance list by (kind, variant), builds one master
   * mesh per part, and uploads the thin-instance transform and colour buffers.
   *
   * The colour buffer is the reason this whole scene needs only ~6 scenery
   * materials: Babylon multiplies `instanceColor` into the PBR albedo per
   * instance (INSTANCESCOLOR), so every stone and shrub gets its own hue/value
   * without its own material, texture or draw call.
   */
  const buildScatter = (instances: SceneryInstance[], layerName: string, reveal: boolean): ScatterGroup[] => {
    const byMaster = new Map<string, SceneryInstance[]>();
    for (const instance of instances) {
      const key = `${instance.kind}:${instance.variant}`;
      const list = byMaster.get(key);
      if (list) list.push(instance);
      else byMaster.set(key, [instance]);
    }
    const built: ScatterGroup[] = [];
    for (const [key, list] of byMaster) {
      const [kind, variantText] = key.split(':');
      const variant = Number(variantText);
      const matrices = new Float32Array(list.length * 16);
      const colours = new Float32Array(list.length * 4);
      for (let i = 0; i < list.length; i++) {
        colours[i * 4] = list[i].tint.r;
        colours[i * 4 + 1] = list[i].tint.g;
        colours[i * 4 + 2] = list[i].tint.b;
        colours[i * 4 + 3] = 1;
      }
      // Stagger order: distance from the garden centre, normalised. Drives the
      // outward reveal sweep.
      const revealOrder = new Float32Array(list.length);
      for (let i = 0; i < list.length; i++) {
        const d = Math.hypot(list[i].x - groundCenter.x, list[i].z - groundCenter.z);
        revealOrder[i] = Math.min(1, d / (GRID_SIZE * 0.75));
      }
      const group: ScatterGroup = {
        meshes: [],
        instances: list,
        matrices,
        animated: list.some((i) => i.sway > 0),
        revealDurationMs: REVEAL_DURATION_MS,
        revealStaggerMs: REVEAL_STAGGER_MS,
        revealBounce: true,
        revealOrder,
        settled: !reveal,
      };
      // Fill with the FINAL transforms first, so the thin-instance bounding
      // info Babylon computes on upload covers where the objects will actually
      // be. A reveal that starts from scale 0 would otherwise register a
      // degenerate bounding box and the whole group could be frustum-culled
      // out of existence for its entire animation.
      writeMatrices(group, 0, 0, 0);
      for (const part of masterParts(kind as SceneryKind, variant)) {
        const mesh = createMeshFromVertexData(`terrarium.scenery.${layerName}.${kind}.${variant}.${part.suffix}`, part.data, scene);
        mesh.material = scatterMaterials[part.material];
        mesh.isPickable = false;
        mesh.receiveShadows = true;
        mesh.thinInstanceSetBuffer('matrix', matrices, 16, false);
        mesh.thinInstanceSetBuffer('color', colours, 4, true);
        if (part.castsShadow) shadowGenerator.addShadowCaster(mesh);
        mesh.metadata = { kind: 'scenery', sceneryKind: kind, layer: layerName, instances: list.length };
        group.meshes.push(mesh);
        scenery.push(mesh);
      }
      built.push(group);
    }
    return built;
  };

  groups.push(...buildScatter(BASE_SCENERY, 'base', false));

  // -------------------------------------------------------------------------
  // Water basins
  // -------------------------------------------------------------------------
  // Previously a flat blue disc lying on the soil, which the last art QA
  // called out as reading as a painted ellipse. Now the terrain is carved into
  // a bowl (layout.ts's terrainHeightAt), a ring of stones forms a physical
  // shoulder at the waterline, and the water surface sits recessed INSIDE
  // that. All basins merge into one rim mesh and one water mesh, so the whole
  // garden's water is two draw calls and one animated material.
  const waterMaterials: WaterMaterial[] = [];
  let basinRim: Mesh | undefined;
  let basinWater: Mesh | undefined;
  if (WATER_BASINS.length > 0) {
    const rimParts: VertexData[] = [];
    const waterParts: VertexData[] = [];
    for (const basin of WATER_BASINS) {
      // Both heights come from layout.ts's single derived definition, so the
      // stones sit exactly ON the waterline rather than at some independently
      // chosen height that happens to look close.
      const surfaceY = GROUND_Y + basinSurfaceHeight(basin);
      rimParts.push(
        transformVertexData(basinRimVertexData(basin.seed, basin.radius, basin.depth), Matrix.Translation(basin.x, surfaceY, basin.z)),
      );
      waterParts.push(transformVertexData(discVertexData(basin.waterRadius, 26), Matrix.Translation(basin.x, surfaceY, basin.z)));
    }
    basinRim = createMeshFromVertexData('terrarium.scenery.basin.rim', mergeVertexData(rimParts), scene);
    basinRim.material = scatterMaterials.stone;
    basinRim.isPickable = false;
    basinRim.receiveShadows = true;
    shadowGenerator.addShadowCaster(basinRim);
    scenery.push(basinRim);

    const water = createWaterMaterial(scene, 'terrarium.scenery.water.mat');
    waterMaterials.push(water);
    basinWater = createMeshFromVertexData('terrarium.scenery.basin.water', mergeVertexData(waterParts), scene);
    basinWater.material = water.material;
    basinWater.isPickable = false;
    basinWater.receiveShadows = false;
    scenery.push(basinWater);
  }

  // -------------------------------------------------------------------------
  // Nursery mound (unchanged by this pass)
  // -------------------------------------------------------------------------
  const nurseryWorld = tileToWorld(NURSERY_TILE);
  // Bevelled mound rather than a bare 24-sided cylinder: rounded top rim,
  // chamfered base, a wider foot with a shelf step, and a gentle taper — a
  // two-tier "pot with a foot" silhouette in one mesh. Dimensions come from
  // NURSERY_BODY (src/render/propDims.ts), which is also what the Sprout float
  // height and the Pod standee's localY are derived from, so the top surface
  // can't drift out of sync with the things that stand on it.
  const nursery = createRoundedPrism(
    'terrarium.nursery',
    {
      halfWidth: NURSERY_BODY.halfWidth,
      halfDepth: NURSERY_BODY.halfDepth,
      cornerRadius: NURSERY_BODY.cornerRadius,
      radialSegments: NURSERY_BODY.radialSegments,
      rings: bodyRings(NURSERY_BODY),
    },
    scene,
  );
  nursery.position.set(nurseryWorld.x, NURSERY_BODY.centreY, nurseryWorld.z);
  const nurseryFallback = new Color3(0.55, 0.4, 0.28);
  // Warm wood/soil-mound PBR body (src/render/pbrMaterials.ts
  // createWoodBodyMaterial) rather than a flat StandardMaterial fill.
  nursery.material = createWoodBodyMaterial(scene, 'terrarium.nursery.body.mat', nurseryFallback);
  nursery.receiveShadows = true;
  nursery.metadata = { kind: 'nursery' };
  shadowGenerator.addShadowCaster(nursery);
  // Pod illustration standing upright as a billboarded card, not lying flat
  // on top of the drum — see src/render/flatArt.ts's attachStandee doc
  // comment. localY = mound half-height + standee half-height, derived rather
  // than hard-coded so it follows NURSERY_BODY.
  const NURSERY_CAP_SIZE = 1.0;
  const nurseryCap = attachStandee(
    scene,
    nursery,
    'terrarium.nursery.cap',
    'structure.nursery.base',
    nurseryFallback,
    NURSERY_CAP_SIZE,
    NURSERY_CAP_SIZE,
    halfHeight(NURSERY_BODY),
  );

  // -------------------------------------------------------------------------
  // First expansion (GameRules §6.6)
  // -------------------------------------------------------------------------
  // "Decorative Expansion I" (src/data/upgrades.ts) previously changed nothing
  // visible, which breaks §2.3 ("every meaningful unlock produces a visible
  // change in the garden") and §6.6 ("must make the world feel larger and more
  // personal, not merely increase capacity invisibly").
  //
  // Buying it now reveals a whole second generated layer: a stone kerb ringing
  // the garden on ground that was bare apron (a larger, defined plot), lanterns
  // along the path verge with their own fireflies (the first light the player
  // owns), and flower beds plus a denser moss carpet threaded through the
  // existing planting.
  //
  // The layer is generated deterministically at module load like everything
  // else — purchase only decides WHEN it appears. That is what makes the
  // save-reload path below safe: rebuilding from a loaded save produces the
  // identical garden, just without replaying the reveal animation.
  let expansionGroups: ScatterGroup[] = [];
  let fireflies: FireflySystem | undefined;
  let expansionRevealed = false;

  const revealExpansion = (animate: boolean, motion?: MotionConfig): void => {
    if (expansionRevealed) return;
    expansionRevealed = true;
    expansionGroups = buildScatter(EXPANSION_SCENERY, 'expansion', animate);
    const startMs = performance.now();
    for (const group of expansionGroups) {
      if (!animate) continue;
      group.revealStartMs = startMs;
      // Reduced motion still gets a reveal — §2.3's visible change is
      // information, not decoration — but a calm, short, non-overshooting one.
      const reduced = motion !== undefined && motion.ambientIntensity === 0;
      group.revealDurationMs = reduced ? 260 : REVEAL_DURATION_MS;
      group.revealStaggerMs = reduced ? 320 : REVEAL_STAGGER_MS;
      group.revealBounce = !reduced;
      writeMatrices(group, 0, 0, startMs);
      for (const mesh of group.meshes) mesh.thinInstanceBufferUpdated('matrix');
    }
    const lanterns = EXPANSION_SCENERY.filter((i) => i.kind === 'lantern');
    if (lanterns.length > 0) {
      fireflies = createFireflies(scene, {
        minX: groundCenter.x - GRID_SIZE * 0.5,
        maxX: groundCenter.x + GRID_SIZE * 0.5,
        minZ: groundCenter.z - GRID_SIZE * 0.5,
        maxZ: groundCenter.z + GRID_SIZE * 0.5,
        y: 0.55,
      });
      if (animate) {
        // A small celebration at each new lantern, so the player's eye is
        // taken to the change rather than having to hunt for it.
        for (const lantern of lanterns) {
          createSparkleBurst(
            scene,
            { x: lantern.x, y: GROUND_Y + lantern.y + 0.55, z: lantern.z },
            { count: Math.max(1, Math.round(14 * (motion?.particleDensity ?? 1))) },
          );
        }
      }
    }
  };

  const subscriptions: Unsubscribe[] = [
    bus.subscribe('upgrade:purchased', (event) => {
      if (event.upgradeId === 'decorativeExpansion1') revealExpansion(true, lastMotion);
    }),
    // Restoring a save that already owns the expansion must show it, without
    // replaying the purchase celebration — the same "don't replay old history"
    // rule src/events/types.ts documents for `save:loaded`.
    bus.subscribe('save:loaded', (event) => {
      if ((event.snapshot.upgradeLevels.decorativeExpansion1 ?? 0) > 0) revealExpansion(false);
    }),
  ];

  /**
   * Fallback for the `save:loaded` subscription above, which in practice
   * almost never fires for the renderer.
   *
   * `src/main.ts` starts the sim runtime immediately and only awaits one
   * IndexedDB read before emitting `save:loaded`, while the renderer is still
   * behind `bootstrap()` (engine/WebGPU device creation) and
   * `loadManifest()` (a network fetch). The event has therefore already been
   * emitted and discarded — EventBus has no replay — by the time this module
   * subscribes. Verified in the browser, not assumed: after buying the
   * expansion and reloading, the Upgrades panel correctly showed "Level 1 / 1"
   * (the UI store mounts synchronously and does catch the event) while the
   * garden showed no expansion meshes at all.
   *
   * So the persisted level is also read directly. This is a READ-ONLY query of
   * the same envelope the sim loaded — it starts nothing, mutates nothing and
   * owns nothing; `revealExpansion` is idempotent, so whichever path arrives
   * first wins and the other is a no-op. The alternative (re-emitting
   * `save:loaded`, or giving the bus replay semantics) would mean changing
   * src/sim or src/events, which this module does not own.
   */
  void loadGame()
    .then((envelope) => {
      if (envelope && (envelope.sim.upgradeLevels.decorativeExpansion1 ?? 0) > 0) revealExpansion(false);
    })
    .catch(() => {
      /* no save, or storage unavailable — nothing to restore */
    });

  // -------------------------------------------------------------------------
  // Per-frame update
  // -------------------------------------------------------------------------
  let lastMotion: MotionConfig | undefined;
  /** True while the last frame had motion enabled — used to write the rest
   * pose exactly once when motion is switched off, rather than every frame. */
  let swayWasActive = false;

  const update = (motion: MotionConfig, nowMs: number): void => {
    lastMotion = motion;
    for (const water of waterMaterials) water.update(motion.backgroundMotion > 0 ? nowMs : 0);
    // Reduced motion sets backgroundMotion to 0, which stops the conveyor
    // dead rather than merely slowing it. The chevrons are directional by
    // shape, so a frozen conveyor still tells the player which way traffic
    // moves — the information survives, only the animation goes.
    pathFlow.advance(nowMs, PATH_FLOW_SPEED * motion.backgroundMotion);

    const ambient = motion.ambientIntensity;
    const swayActive = ambient > 0;
    const timeSec = nowMs / 1000;
    for (const group of [...groups, ...expansionGroups]) {
      const needsReveal = group.revealStartMs !== undefined && !group.settled;
      // Rewrite matrices when something is genuinely moving, or exactly once
      // on the frame motion is disabled (to settle everything to its rest
      // pose). Static groups under reduced motion cost nothing at all.
      if (!needsReveal && !(group.animated && (swayActive || swayWasActive))) continue;
      writeMatrices(group, timeSec, ambient, nowMs);
      for (const mesh of group.meshes) mesh.thinInstanceBufferUpdated('matrix');
    }
    swayWasActive = swayActive;

    if (fireflies) {
      fireflies.setDensity(motion.backgroundMotion * motion.particleDensity);
      // Slow, shallow flicker — a lantern breathing, not a strobe. Frozen at
      // its resting brightness under reduced motion.
      lanternGlass.setGlow(motion.backgroundMotion > 0 ? 0.5 + 0.5 * Math.sin(timeSec * 0.9) : 0.75);
    }
  };

  const dispose = (): void => {
    for (const unsubscribe of subscriptions) unsubscribe();
    fireflies?.dispose();
    ground.dispose();
    for (const material of pathMaterials.values()) material.dispose(); // one shared instance per piece type, not per tile
    pathFlow.dispose(); // material AND its shared chevron texture — see PathFlowMaterial.dispose
    for (const p of paths) p.dispose();
    for (const s of scenery) s.dispose();
    for (const material of Object.values(scatterMaterials)) material.dispose();
    for (const water of waterMaterials) water.material.dispose();
    basinRim = undefined;
    basinWater = undefined;
    nurseryCap.mesh.dispose();
    nurseryCap.material.dispose();
    nursery.dispose();
  };

  return { nursery, ground, paths, scenery, update, isExpansionRevealed: () => expansionRevealed, dispose };
}

/** Uniformly scales a generated VertexData in place. Master meshes are
 * authored at a convenient nominal size and scaled once here, so the
 * per-instance `scale` in layout.ts stays a readable "0.7x to 1.3x of a
 * normal one of these" rather than encoding absolute world units. */
function scaleData(data: VertexData, factor: number): VertexData {
  const positions = data.positions as number[];
  for (let i = 0; i < positions.length; i++) positions[i] *= factor;
  return data;
}
