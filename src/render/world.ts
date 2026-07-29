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
        mesh = MeshBuilder.CreateBox(`terrarium.scenery.rock.${placement.tile.x}.${placement.tile.z}`, { size: 0.4 }, scene);
        mesh.position.set(world.x, 0.2, world.z);
        mesh.rotation.y = (placement.variant * Math.PI) / 5;
        mesh.material = createManifestMaterial(scene, `${key}.mat`, key, new Color3(0.5, 0.48, 0.46));
        break;
      case 'water':
        mesh = MeshBuilder.CreateDisc(`terrarium.scenery.water.${placement.tile.x}.${placement.tile.z}`, { radius: 0.4, tessellation: 20 }, scene);
        mesh.rotation.x = Math.PI / 2;
        mesh.position.set(world.x, 0.015, world.z);
        mesh.material = createManifestMaterial(scene, `${key}.mat`, key, new Color3(0.3, 0.55, 0.7));
        break;
      case 'foliage':
      default:
        mesh = MeshBuilder.CreateCylinder(`terrarium.scenery.foliage.${placement.tile.x}.${placement.tile.z}`, {
          height: 0.5,
          diameterTop: 0.05,
          diameterBottom: 0.4,
          tessellation: 8,
        }, scene);
        mesh.position.set(world.x, 0.25, world.z);
        mesh.material = createManifestMaterial(scene, `${key}.mat`, key, new Color3(0.28, 0.5, 0.24));
        break;
    }
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    shadowGenerator.addShadowCaster(mesh);
    scenery.push(mesh);
  }

  const nurseryWorld = tileToWorld(NURSERY_TILE);
  const nursery = MeshBuilder.CreateCylinder('terrarium.nursery', { height: 0.7, diameter: 1.6, tessellation: 12 }, scene);
  nursery.position.set(nurseryWorld.x, 0.35, nurseryWorld.z);
  nursery.material = createManifestMaterial(scene, 'terrarium.nursery.mat', 'structure.nursery.base', new Color3(0.55, 0.4, 0.28));
  nursery.receiveShadows = true;
  nursery.metadata = { kind: 'nursery' };
  shadowGenerator.addShadowCaster(nursery);

  const dispose = (): void => {
    ground.dispose();
    for (const p of paths) p.dispose();
    for (const s of scenery) s.dispose();
    nursery.dispose();
  };

  return { nursery, ground, paths, scenery, dispose };
}
