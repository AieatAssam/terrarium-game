// Static garden geometry: ground, garden paths, and decorative scenery
// (foliage/rocks/water). Positions come exclusively from src/render/layout.ts
// + tileToWorld — no invented screen-space placement. Habitats and
// automation structures are built by their own modules (habitats.ts,
// automation.ts) since they need reactive behavior this module doesn't.

import { Color3 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { PBRMetallicRoughnessMaterial } from '@babylonjs/core/Materials/PBR/pbrMetallicRoughnessMaterial';
import type { Scene } from '@babylonjs/core/scene';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';

import { createManifestMaterial, getManifestTexture } from './assets';
import { GRID_SIZE, tileToWorld } from './coords';
import { attachStandee } from './flatArt';
import { createRoundedPrism } from './geometry';
import { GARDEN_PATH_PIECES, PATH_DIRECTION_OFFSETS, NURSERY_TILE, SCENERY_PLACEMENTS, type PathPiece } from './layout';
import { bodyRings, halfHeight, NURSERY_BODY } from './propDims';
import type { MotionConfig } from './motion';
import {
  applyFoliageDetail,
  applyRockDetail,
  createPathFlowMaterial,
  createPathMaterial,
  createSoilMaterial,
  createWaterMaterial,
  createWoodBodyMaterial,
  type WaterMaterial,
} from './pbrMaterials';

// Maps a scenery placement to the actual manifest keys Subagent C produced
// (scenery.rockSmall/rockLarge/fern/bush/waterAccent) — there's no
// per-variant-number family, just these five fixed pieces.
function sceneryManifestKey(kind: 'foliage' | 'rock' | 'water', variant: number): string {
  if (kind === 'rock') return variant % 2 === 0 ? 'scenery.rockLarge' : 'scenery.rockSmall';
  if (kind === 'water') return 'scenery.waterAccent';
  return variant % 2 === 0 ? 'scenery.bush' : 'scenery.fern';
}

export interface GardenWorld {
  nursery: Mesh;
  ground: Mesh;
  paths: Mesh[];
  scenery: Mesh[];
  /** Advances animated water-accent ripple normal maps and the garden path's
   * conveyor-flow chevrons — call once per frame (wired from
   * src/render/index.ts's render loop). Takes the MotionConfig because the
   * conveyor has to respect the reduced-motion preference. */
  update: (motion: MotionConfig, nowMs: number) => void;
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

export function buildGardenWorld(scene: Scene, shadowGenerator: ShadowGenerator): GardenWorld {
  const ground = MeshBuilder.CreateGround(
    'terrarium.ground',
    { width: GRID_SIZE + 6, height: GRID_SIZE + 6, subdivisions: 8 },
    scene,
  );
  const groundCenter = tileToWorld({ x: (GRID_SIZE - 1) / 2, z: (GRID_SIZE - 1) / 2 });
  ground.position.set(groundCenter.x, -0.05, groundCenter.z);
  ground.receiveShadows = true;
  // No manifest key for base terrain (C's asset list is creatures/habitats/
  // structures/scenery pieces, not a ground texture), but a real PBR soil
  // material — mottled albedo, normal-mapped clumps/pebbles, rough matte
  // response, AO in the "pores" — rather than a flat StandardMaterial fill.
  // See src/render/pbrMaterials.ts createSoilMaterial.
  ground.material = createSoilMaterial(scene);

  // Garden path. Piece type + rotation come from each tile's neighbours (see
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

  const waterMaterials: WaterMaterial[] = [];
  const scenery: Mesh[] = [];
  for (const placement of SCENERY_PLACEMENTS) {
    const world = tileToWorld(placement.tile);
    const key = sceneryManifestKey(placement.kind, placement.variant);
    let mesh: Mesh;
    switch (placement.kind) {
      case 'rock':
        // Flat ground-parallel card, not a textured box: every scenery SVG
        // (see docs/ART_DIRECTION.md §5, "Scenery piece") is a single
        // top-down illustration with its own baked-in ground shadow — a
        // painted decal, not a volume. Wrapping it around a CreateBox's 6
        // faces (the previous approach) smeared the mostly-transparent
        // source art across the whole cube and read as a near-solid dark
        // block (see docs/ART_QA_REPORT.md). A flat card's default UV is a
        // clean 0..1 rect, matching how the art was authored.
        mesh = MeshBuilder.CreatePlane(`terrarium.scenery.rock.${placement.tile.x}.${placement.tile.z}`, { width: 0.5, height: 0.5 }, scene);
        mesh.rotation.x = Math.PI / 2;
        mesh.rotation.y = (placement.variant * Math.PI) / 5;
        mesh.position.set(world.x, 0.02, world.z);
        mesh.material = createManifestMaterial(scene, `${key}.mat`, key, new Color3(0.5, 0.48, 0.46));
        mesh.material.backFaceCulling = false;
        // Layer the shared stone family's normal/AO/roughness detail on top
        // of the manifest-art albedo (see pbrMaterials.ts applyRockDetail) —
        // previously these were manifest art with no PBR detail pass at all.
        applyRockDetail(scene, mesh.material as PBRMetallicRoughnessMaterial);
        break;
      case 'water': {
        mesh = MeshBuilder.CreateDisc(`terrarium.scenery.water.${placement.tile.x}.${placement.tile.z}`, { radius: 0.4, tessellation: 20 }, scene);
        mesh.rotation.x = Math.PI / 2;
        mesh.position.set(world.x, 0.015, world.z);
        // Water accent gets the glossy animated-ripple PBR water material
        // (src/render/pbrMaterials.ts createWaterMaterial), with C's
        // manifest illustration (water-lily/reflection linework) layered on
        // as the albedo once it finishes rasterizing.
        const water = createWaterMaterial(scene, `${key}.mat.${placement.tile.x}.${placement.tile.z}`);
        getManifestTexture(scene, key, (tex) => {
          water.material.baseTexture = tex;
        });
        mesh.material = water.material;
        waterMaterials.push(water);
        break;
      }
      case 'foliage':
      default:
        // Same "flat painted card" fix as rocks above — previously a cone
        // (CreateCylinder with a near-point top) whose lateral surface got
        // the same wrap-distortion bug, rendering as thin illegible green
        // slivers instead of a readable bush/fern silhouette.
        mesh = MeshBuilder.CreatePlane(`terrarium.scenery.foliage.${placement.tile.x}.${placement.tile.z}`, { width: 0.55, height: 0.55 }, scene);
        mesh.rotation.x = Math.PI / 2;
        mesh.position.set(world.x, 0.02, world.z);
        mesh.material = createManifestMaterial(scene, `${key}.mat`, key, new Color3(0.28, 0.5, 0.24));
        mesh.material.backFaceCulling = false;
        // Leaf-cluster shadow pockets + vein-like fine streaks layered on
        // top of the manifest bush/fern art (see pbrMaterials.ts
        // applyFoliageDetail) — the brief explicitly calls out foliage as
        // needing its own richer detail pass, not the flat roughness=0.55
        // every other manifest-art card gets.
        applyFoliageDetail(scene, mesh.material as PBRMetallicRoughnessMaterial);
        break;
    }
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    shadowGenerator.addShadowCaster(mesh);
    scenery.push(mesh);
  }

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

  const update = (motion: MotionConfig, nowMs: number): void => {
    for (const water of waterMaterials) water.update(nowMs);
    // Reduced motion sets backgroundMotion to 0, which stops the conveyor
    // dead rather than merely slowing it. The chevrons are directional by
    // shape, so a frozen conveyor still tells the player which way traffic
    // moves — the information survives, only the animation goes.
    pathFlow.advance(nowMs, PATH_FLOW_SPEED * motion.backgroundMotion);
  };

  const dispose = (): void => {
    ground.dispose();
    for (const material of pathMaterials.values()) material.dispose(); // one shared instance per piece type, not per tile
    pathFlow.dispose(); // material AND its shared chevron texture — see PathFlowMaterial.dispose
    for (const p of paths) p.dispose();
    for (const s of scenery) s.dispose();
    nurseryCap.mesh.dispose();
    nurseryCap.material.dispose();
    nursery.dispose();
  };

  return { nursery, ground, paths, scenery, update, dispose };
}
