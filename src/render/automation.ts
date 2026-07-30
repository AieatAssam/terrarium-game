// Garden Slide / Colour Gate automation structures: a subtle "future build
// site" marker at their default site tiles until `automation:built` fires,
// then a solid structure. Also exposes a ghost/preview API for Subagent F's
// build menu UI to call while the player is choosing a placement — the menu
// UI itself is F's job (docs/CONTRACTS.md), but the 3D placement preview and
// valid/invalid feedback in the scene is E's.

import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { PBRMetallicRoughnessMaterial } from '@babylonjs/core/Materials/PBR/pbrMetallicRoughnessMaterial';
import type { Scene } from '@babylonjs/core/scene';
import type { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';

import { tileToWorld, type TileCoord } from './coords';
import { attachStandee, type FlatCap } from './flatArt';
import { createRoundedPrism } from './geometry';
import { AUTOMATION_SITE_TILES, isReservedTile } from './layout';
import { createPaintedMetalMaterial } from './pbrMaterials';
import { bodyRings, halfHeight, AUTOMATION_BODIES, AUTOMATION_PREVIEW_BODY, type PropBody } from './propDims';
import type { EventBus } from '../events/bus';
import type { AutomationId } from '../core/ids';

const SITE_FALLBACK_COLOR: Record<AutomationId, Color3> = {
  gardenSlide: new Color3(0.55, 0.45, 0.7),
  colourGate: new Color3(0.4, 0.6, 0.55),
};

/** Standee card bounding footprint for a site marker and its placement ghost. */
const SITE_CAP_WIDTH = 1.0;
const SITE_CAP_HEIGHT = 0.68;
const PREVIEW_CAP_WIDTH = 1.05;
const PREVIEW_CAP_HEIGHT = 0.71;

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

/**
 * Automation plinth body. Previously a plain `MeshBuilder.CreateBox` — a
 * literal cube with six razor-sharp edges, which is what "extremely blocky"
 * described. Now a `createRoundedPrism` with a soft-cornered rounded-rectangle
 * cross-section (garden equipment, not a pot: the corner radius is well under
 * the half-extent so it still reads as a square plinth), a chamfered top and
 * base, a wider foot with a shelf step, and a slight taper. Built as ONE mesh
 * deliberately: these markers are semi-transparent until built, and stacking
 * separate tier meshes would double-darken through the alpha blend.
 */
function buildAutomationMesh(scene: Scene, name: string, body: PropBody): Mesh {
  return createRoundedPrism(
    name,
    {
      halfWidth: body.halfWidth,
      halfDepth: body.halfDepth,
      cornerRadius: body.cornerRadius,
      radialSegments: body.radialSegments,
      rings: bodyRings(body),
    },
    scene,
  );
}

export function createAutomationManager(scene: Scene, bus: EventBus, shadowGenerator: ShadowGenerator): AutomationManager {
  const sites = {} as Record<AutomationId, SiteMarker>;

  for (const id of Object.keys(AUTOMATION_SITE_TILES) as AutomationId[]) {
    const tile = AUTOMATION_SITE_TILES[id];
    const world = tileToWorld(tile);
    const body = AUTOMATION_BODIES[id];
    const mesh = buildAutomationMesh(scene, `terrarium.automation.${id}`, body);
    mesh.position.set(world.x, body.centreY, world.z);
    mesh.isPickable = false;
    const bodyMaterial = createPaintedMetalMaterial(scene, `terrarium.automation.${id}.body.mat`, SITE_FALLBACK_COLOR[id]);
    bodyMaterial.alpha = 0.4; // "not yet built" site marker
    mesh.material = bodyMaterial;

    // Structure illustration standing upright as a billboarded card (see
    // src/render/flatArt.ts's attachStandee), not lying flat on the box top.
    // width:height ~1.54:1 roughly matches the source art's real 400x260
    // aspect (the texture itself is also letterboxed within its canvas, so
    // this doesn't need to be exact). attachStandee is handed the plinth's TOP
    // FACE (its own half-height) and does the anchoring itself, so the card's
    // bottom edge stays just clear of that face even after the content crop
    // resizes it.
    const cap = attachStandee(
      scene,
      mesh,
      `terrarium.automation.${id}.cap`,
      `structure.${id}.base`,
      SITE_FALLBACK_COLOR[id],
      SITE_CAP_WIDTH,
      SITE_CAP_HEIGHT,
      halfHeight(body),
    );
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
    const mesh = buildAutomationMesh(scene, 'terrarium.automation.preview', AUTOMATION_PREVIEW_BODY);
    mesh.position.set(world.x, AUTOMATION_PREVIEW_BODY.centreY, world.z);
    mesh.isPickable = false;
    const tint = valid ? new Color3(0.2, 0.7, 0.3) : new Color3(0.6, 0.15, 0.15);
    const bodyMaterial = createPaintedMetalMaterial(scene, 'terrarium.automation.preview.body.mat', SITE_FALLBACK_COLOR[automationId]);
    bodyMaterial.alpha = 0.55;
    bodyMaterial.emissiveColor = tint;
    mesh.material = bodyMaterial;

    const cap = attachStandee(
      scene,
      mesh,
      'terrarium.automation.preview.cap',
      `structure.${automationId}.base`,
      SITE_FALLBACK_COLOR[automationId],
      PREVIEW_CAP_WIDTH,
      PREVIEW_CAP_HEIGHT,
      halfHeight(AUTOMATION_PREVIEW_BODY),
    );
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
