// Shared helper for displaying Subagent C's flat, top-down/iso "painted
// card" SVG art (nursery, habitats, automation sites — see docs/ART_DIRECTION.md
// §1/§5) as upright standees in the 3D scene.
//
// First bug this worked around: Babylon's MeshBuilder.CreateCylinder/CreateBox
// apply the SAME default UV rect to every face (bottom cap / side / top cap
// for a cylinder, all 6 faces for a box) unless you hand it a custom
// faceUV + multi-material setup, so a single flat illustration wraps/smears
// around the side wall instead of showing cleanly. Fix: give the "volume"
// mesh (drum/box body) a flat untextured material, and add a separate card
// CHILD mesh carrying the actual manifest texture — a plane's default UV is
// already a clean, non-wrapped 0..1 rect.
//
// Second iteration: that card first lay flat on top of the drum (a
// ground-parallel disc/plane). At this camera angle a flat top-down picture
// reads as a table decal, not as "a thing" — so it was changed to stand
// upright instead, billboarded like the Sprouts (src/render/sprouts.ts)
// so it always faces the camera while staying vertical, matching the
// diorama-with-standees look the Sprouts already establish.
//
// Third bug (found via browser QA, not visible from source alone — see
// docs/ART_QA_REPORT.md): once upright, these standees still read as
// "basically invisible / flat colored blobs" at the default gameplay camera.
// Root cause, confirmed with a scene-graph + pixel-level debug pass (not the
// billboard math — that was verified correct via world-matrix inspection):
// the source SVGs for these particular assets (habitat/nursery/automation
// "painted card" illustrations, docs/ART_DIRECTION.md §1) are authored as
// TOP-DOWN decals — a wide, short ellipse with a baked ground shadow,
// deliberately offset toward the bottom of their square canvas, meant to be
// viewed lying flat on a surface. Rasterized as-is onto an upright card, that
// content occupies only the lower fraction of the card's height and reads as
// a small, squashed disc riding low on an otherwise-empty vertical rectangle
// — which is indistinguishable from "not there" against the body mesh it's
// standing on. Sprout art (src/render/sprouts.ts) doesn't have this problem
// because it was authored face-on for exactly this kind of billboard.
//
// Fix: crop the standee's texture UV to the source art's actual opaque
// content (computed once per texture in assets.ts's getManifestContentBBox)
// and resize/re-anchor the card to that content's aspect ratio instead of
// the artwork's full (mostly-transparent) square canvas, so the illustration
// actually fills the standee and sits flush on the surface it's standing on.
//
// Fourth bug (reported by the player as "the symbols above the habitats are
// clipped"): that crop was computing its V window with the wrong sign, so it
// showed the WRONG SLICE of the canvas. The V convention here is settled by
// two independent facts, not by guesswork:
//
//   1. assets.ts rasterizes into a DynamicTexture and calls
//      `texture.update(false)` — invertY = false, so the canvas is uploaded
//      without a vertical flip and texture v = 0 samples the canvas's TOP row.
//   2. Independently confirmed in the running scene via the garden path's
//      orientation: `groundBuilder.js` puts ground v = 0 at z = -height/2, and
//      a rendered path corner showed the source SVG's top edge facing world
//      -Z. Same conclusion — v = 0 is the canvas top.
//
// The previous code set `vOffset = 1 - bbox.maxV`, which is only correct if
// v runs bottom-up. Because these illustrations are bottom-anchored in their
// canvas (a wide ground-shadow ellipse near the bottom edge), that sign error
// showed the canvas's TOP band instead of the content band. Measured in the
// browser before the fix, `habitat.dewPond.base` has its content in canvas
// rows 0.434..1.0 while the card was sampling rows 0.0..0.566 — an overlap of
// barely a fifth of the canvas, i.e. most of every habitat symbol was simply
// not on the card.
//
// Two consequences are handled below:
//   * The V window is `[bbox.minV, bbox.maxV]`, expressed as a NEGATIVE
//     vScale anchored at maxV. Negative, because a plane's own v = 0 is at its
//     BOTTOM edge (`planeBuilder.js`) while texture v = 0 is the canvas TOP —
//     so a positive scale would render the art upside down.
//   * The card is anchored by its BOTTOM EDGE, and that anchoring is
//     recomputed from the POST-CROP height. Callers now pass the local Y of
//     the surface the card stands on and this module owns all the half-height
//     arithmetic; previously each caller pre-computed `localY` from the
//     ORIGINAL requested height, which stopped being the card's real
//     half-height the moment the content crop resized it.

import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Color3 } from '@babylonjs/core/Maths/math.color';
import type { PBRMetallicRoughnessMaterial } from '@babylonjs/core/Materials/PBR/pbrMetallicRoughnessMaterial';
import type { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Scene } from '@babylonjs/core/scene';

import { createManifestMaterial, getManifestTexture, onManifestContentBBoxReady, type ManifestKey } from './assets';

export interface FlatCap {
  mesh: Mesh;
  material: PBRMetallicRoughnessMaterial;
}

/** Gap left between the surface a standee stands on and the card's bottom
 * edge. Small but non-zero on purpose: a card whose bottom edge is exactly
 * coplanar with the top face it stands on z-fights with that face along its
 * whole bottom row, which reads as a clipped//frayed edge. */
const STANDEE_GROUND_CLEARANCE = 0.02;

/**
 * Upright "standee" card — a vertical plane, billboarded (BILLBOARDMODE_Y,
 * same as src/render/sprouts.ts's Sprout sprites) so it always faces the
 * camera while staying vertical.
 *
 * `width`/`height` are a MAXIMUM bounding footprint — see the content-crop
 * note above; the actual rendered card is fit inside this box at the source
 * art's real content aspect ratio, not forced to fill it.
 *
 * `surfaceLocalY` is the parent-local Y of the TOP FACE the card stands on
 * (e.g. `halfHeight(body)` for a drum whose pivot is its vertical centre) —
 * NOT a centre height. This function owns all the half-height arithmetic,
 * including redoing it against the post-crop height, so the card's bottom edge
 * is always just clear of that surface no matter how the content crop resizes
 * it. Callers used to pass a pre-computed centre height derived from the
 * ORIGINAL `height`, which silently stopped matching the card's real
 * half-height once the crop applied.
 */
export function attachStandee(
  scene: Scene,
  parent: Mesh,
  name: string,
  key: ManifestKey,
  fallbackColor: Color3,
  width: number,
  height: number,
  surfaceLocalY: number,
): FlatCap {
  const mesh = MeshBuilder.CreatePlane(name, { width, height }, scene);
  mesh.billboardMode = Mesh.BILLBOARDMODE_Y;
  mesh.parent = parent;
  const bottomY = surfaceLocalY + STANDEE_GROUND_CLEARANCE;
  mesh.position.set(0, bottomY + height / 2, 0);
  mesh.isPickable = false;
  const material = createManifestMaterial(scene, `${name}.mat`, key, fallbackColor);
  material.backFaceCulling = false;
  mesh.material = material;

  // Bbox readiness is tracked independently of the texture's own
  // isReady()/onReady (see onManifestContentBBoxReady's doc comment) — a
  // DynamicTexture reports ready as soon as it's constructed, before its
  // canvas has real pixels, so relying on the texture callback here would
  // fire this too early (no bbox yet) and never again.
  onManifestContentBBoxReady(key, (bbox) => {
    if (mesh.isDisposed()) return;
    // Fetch the texture directly rather than reading material.diffuseTexture
    // — createManifestMaterial's own onReady assignment isn't guaranteed to
    // have run yet relative to this callback, but the texture itself (cached
    // by key) is available as soon as it exists.
    const texture = getManifestTexture(scene, key) as Texture | undefined;
    if (!texture) return;
    const contentW = bbox.maxU - bbox.minU;
    const contentH = bbox.maxV - bbox.minV;
    if (contentW <= 0 || contentH <= 0) return;
    const contentAspect = contentW / contentH;
    const boxAspect = width / height;
    const fitWidth = contentAspect > boxAspect ? width : height * contentAspect;
    const fitHeight = contentAspect > boxAspect ? width / contentAspect : height;
    mesh.scaling.x = fitWidth / width;
    mesh.scaling.y = fitHeight / height;
    mesh.position.y = bottomY + fitHeight / 2;
    material.baseTexture = texture;
    // Shared texture (same manifest key may back several standees — e.g.
    // automation site/preview/built cards), so every consumer wants the same
    // crop; safe to mutate directly rather than cloning per-instance.
    texture.uOffset = bbox.minU;
    texture.uScale = contentW;
    // V window = [bbox.minV, bbox.maxV] in canvas rows, expressed with a
    // NEGATIVE scale anchored at maxV. See the module doc comment: texture
    // v = 0 is the canvas's TOP row (assets.ts uploads with invertY = false)
    // while a plane's own v = 0 is its BOTTOM edge, so sampling must run
    // backwards for the art to come out upright. Sampled v at the card's
    // bottom edge (mesh v = 0) is maxV — the content's bottom row — and at its
    // top edge (mesh v = 1) it is maxV - contentH = minV.
    texture.vOffset = bbox.maxV;
    texture.vScale = -contentH;
  });

  return { mesh, material };
}
