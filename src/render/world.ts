// Static garden geometry: ground, garden paths, and decorative scenery
// (foliage/rocks/water). Positions come exclusively from src/render/layout.ts
// + tileToWorld — no invented screen-space placement. Habitats and
// automation structures are built by their own modules (habitats.ts,
// automation.ts) since they need reactive behavior this module doesn't.

import { Color3 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';

import { createManifestMaterial } from './assets';
import { GRID_SIZE, tileToWorld } from './coords';
import { attachDiscCap } from './flatArt';
import { GARDEN_PATH_TILES, NURSERY_TILE, SCENERY_PLACEMENTS } from './layout';

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
  dispose: () => void;
}

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
  // structures/scenery pieces, not a ground texture) — flat material is
  // intentional here, not a missing-asset bug. Flagged as an art-polish item.
  const groundMaterial = new StandardMaterial('terrarium.ground.mat', scene);
  groundMaterial.diffuseColor = new Color3(0.22, 0.36, 0.2);
  groundMaterial.specularColor = Color3.Black();
  ground.material = groundMaterial;

  const paths: Mesh[] = [];
  for (const tile of GARDEN_PATH_TILES) {
    const world = tileToWorld(tile);
    const path = MeshBuilder.CreateGround(`terrarium.path.${tile.x}.${tile.z}`, { width: 0.92, height: 0.92 }, scene);
    path.position.set(world.x, 0.01, world.z);
    path.receiveShadows = true;
    path.material = createManifestMaterial(scene, `terrarium.path.mat.${tile.x}.${tile.z}`, 'path.segment.straight', new Color3(0.62, 0.55, 0.42));
    path.isPickable = false;
    paths.push(path);
  }

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
        (mesh.material as StandardMaterial).backFaceCulling = false;
        break;
      case 'water':
        mesh = MeshBuilder.CreateDisc(`terrarium.scenery.water.${placement.tile.x}.${placement.tile.z}`, { radius: 0.4, tessellation: 20 }, scene);
        mesh.rotation.x = Math.PI / 2;
        mesh.position.set(world.x, 0.015, world.z);
        mesh.material = createManifestMaterial(scene, `${key}.mat`, key, new Color3(0.3, 0.55, 0.7));
        break;
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
        (mesh.material as StandardMaterial).backFaceCulling = false;
        break;
    }
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    shadowGenerator.addShadowCaster(mesh);
    scenery.push(mesh);
  }

  const nurseryWorld = tileToWorld(NURSERY_TILE);
  const nursery = MeshBuilder.CreateCylinder('terrarium.nursery', { height: 0.7, diameter: 1.6, tessellation: 24 }, scene);
  nursery.position.set(nurseryWorld.x, 0.35, nurseryWorld.z);
  const nurseryFallback = new Color3(0.55, 0.4, 0.28);
  const nurseryBodyMaterial = new StandardMaterial('terrarium.nursery.body.mat', scene);
  nurseryBodyMaterial.diffuseColor = nurseryFallback;
  nurseryBodyMaterial.specularColor = Color3.Black();
  nursery.material = nurseryBodyMaterial;
  nursery.receiveShadows = true;
  nursery.metadata = { kind: 'nursery' };
  shadowGenerator.addShadowCaster(nursery);
  // Top-down pod illustration on a flat cap disc, not wrapped around the
  // drum — see src/render/flatArt.ts for why (this was the specific
  // "Nursery mesh gets distorted" defect flagged in QA).
  const nurseryCap = attachDiscCap(
    scene,
    nursery,
    'terrarium.nursery.cap',
    'structure.nursery.base',
    nurseryFallback,
    0.72,
    0.351,
  );

  const dispose = (): void => {
    ground.dispose();
    for (const p of paths) p.dispose();
    for (const s of scenery) s.dispose();
    nurseryCap.mesh.dispose();
    nurseryCap.material.dispose();
    nursery.dispose();
  };

  return { nursery, ground, paths, scenery, dispose };
}
