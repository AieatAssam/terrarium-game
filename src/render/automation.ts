// Garden Slide / Colour Gate automation structures: a subtle "future build
// site" marker at their default site tiles until `automation:built` fires,
// then a solid structure. Also exposes a ghost/preview API for Subagent F's
// build menu UI to call while the player is choosing a placement — the menu
// UI itself is F's job (docs/CONTRACTS.md), but the 3D placement preview and
// valid/invalid feedback in the scene is E's.

import { Color3 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { PBRMetallicRoughnessMaterial } from '@babylonjs/core/Materials/PBR/pbrMetallicRoughnessMaterial';
import type { Scene } from '@babylonjs/core/scene';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';

import { tileToWorld, type TileCoord } from './coords';
import { attachStandee, type FlatCap } from './flatArt';
import { AUTOMATION_SITE_TILES, isReservedTile } from './layout';
import { createPaintedMetalMaterial } from './pbrMaterials';
import type { EventBus } from '../events/bus';
import type { AutomationId } from '../core/ids';

const SITE_FALLBACK_COLOR: Record<AutomationId, Color3> = {
  gardenSlide: new Color3(0.55, 0.45, 0.7),
  colourGate: new Color3(0.4, 0.6, 0.55),
};

interface SiteMarker {
  id: AutomationId;
  mesh: Mesh;
  /** Flat cap plane's material — carries C's structure illustration (see
   * flatArt.ts: a CreateBox's default UV wraps a single flat illustration
   * around all 6 faces instead of showing it top-down, which is what made
   * these markers look like plain dark cubes). */
  material: PBRMetallicRoughnessMaterial;
  bodyMaterial: PBRMetallicRoughnessMaterial;
  built: boolean;
}

export interface AutomationManager {
  previewAt: (automationId: AutomationId, tile: TileCoord, valid: boolean) => void;
  clearPreview: () => void;
  dispose: () => void;
}

export function createAutomationManager(scene: Scene, bus: EventBus, shadowGenerator: ShadowGenerator): AutomationManager {
  const sites = {} as Record<AutomationId, SiteMarker>;

  for (const id of Object.keys(AUTOMATION_SITE_TILES) as AutomationId[]) {
    const tile = AUTOMATION_SITE_TILES[id];
    const world = tileToWorld(tile);
    const mesh = MeshBuilder.CreateBox(`terrarium.automation.${id}`, { width: 0.8, height: 0.5, depth: 0.8 }, scene);
    mesh.position.set(world.x, 0.25, world.z);
    mesh.isPickable = false;
    const bodyMaterial = createPaintedMetalMaterial(scene, `terrarium.automation.${id}.body.mat`, SITE_FALLBACK_COLOR[id]);
    bodyMaterial.alpha = 0.4; // "not yet built" site marker
    mesh.material = bodyMaterial;

    // Structure illustration standing upright as a billboarded card (see
    // src/render/flatArt.ts's attachStandee), not lying flat on the box top.
    // width:height ~1.54:1 roughly matches the source art's real 400x260
    // aspect (the texture itself is also letterboxed within its canvas, so
    // this doesn't need to be exact).
    const cap = attachStandee(scene, mesh, `terrarium.automation.${id}.cap`, `structure.${id}.base`, SITE_FALLBACK_COLOR[id], 1.0, 0.68, 0.59);
    cap.material.alpha = 0.4;

    sites[id] = { id, mesh, material: cap.material, bodyMaterial, built: false };
  }

  const unsubBuilt = bus.subscribe('automation:built', (e) => {
    const site = sites[e.automationId];
    if (!site) return;
    site.built = true;
    site.material.alpha = 1;
    site.bodyMaterial.alpha = 1;
    shadowGenerator.addShadowCaster(site.mesh);
  });

  let previewMesh: Mesh | undefined;
  let previewBodyMaterial: PBRMetallicRoughnessMaterial | undefined;
  let previewCap: FlatCap | undefined;

  const previewAt = (automationId: AutomationId, tile: TileCoord, valid: boolean): void => {
    clearPreview();
    const world = tileToWorld(tile);
    const mesh = MeshBuilder.CreateBox('terrarium.automation.preview', { width: 0.85, height: 0.55, depth: 0.85 }, scene);
    mesh.position.set(world.x, 0.28, world.z);
    mesh.isPickable = false;
    const tint = valid ? new Color3(0.2, 0.7, 0.3) : new Color3(0.6, 0.15, 0.15);
    const bodyMaterial = createPaintedMetalMaterial(scene, 'terrarium.automation.preview.body.mat', SITE_FALLBACK_COLOR[automationId]);
    bodyMaterial.alpha = 0.55;
    bodyMaterial.emissiveColor = tint;
    mesh.material = bodyMaterial;

    const cap = attachStandee(scene, mesh, 'terrarium.automation.preview.cap', `structure.${automationId}.base`, SITE_FALLBACK_COLOR[automationId], 1.05, 0.71, 0.63);
    cap.material.alpha = 0.55;
    cap.material.emissiveColor = tint;

    previewMesh = mesh;
    previewBodyMaterial = bodyMaterial;
    previewCap = cap;
  };

  const clearPreview = (): void => {
    previewMesh?.dispose(); // recursively disposes the cap child mesh too
    previewBodyMaterial?.dispose();
    previewCap?.material.dispose();
    previewMesh = undefined;
    previewBodyMaterial = undefined;
    previewCap = undefined;
  };

  const dispose = (): void => {
    unsubBuilt();
    clearPreview();
    for (const site of Object.values(sites)) {
      site.mesh.dispose(); // recursively disposes the cap child mesh too
      site.material.dispose();
      site.bodyMaterial.dispose();
    }
  };

  return { previewAt, clearPreview, dispose };
}

/** Whether a tile is free for an automation build (inside grid, not on the reserved nursery/habitat/path/other-site layout). Exposed for input's ghost-preview validity check. */
export function isBuildableTile(tile: TileCoord): boolean {
  return !isReservedTile(tile);
}
