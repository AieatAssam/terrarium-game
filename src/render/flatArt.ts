// Shared helper for displaying Subagent C's flat, top-down/iso "painted
// card" SVG art (nursery, habitats, automation sites, scenery — see
// docs/ART_DIRECTION.md §1/§5, every one of these is a single illustrated
// disc/card meant to be viewed roughly from above) cleanly in the 3D scene.
//
// Bug this works around: Babylon's MeshBuilder.CreateCylinder/CreateBox
// apply the SAME default UV rect to every face (bottom cap / side / top cap
// for a cylinder, all 6 faces for a box) unless you hand it a custom
// faceUV + multi-material setup. For a single flat illustration that's
// meant to read as "a picture sitting on top of a drum," the default
// mapping instead wraps/smears the art around the side wall and squashes it
// onto the (often tiny) bottom cap too — this was flagged by the integrator
// as visible distortion on the Nursery mound and is present on every
// cylinder/box structure that uses createManifestMaterial the same way,
// plus scenery (rocks/foliage) which showed as barely-visible "wrapped"
// slivers because most of the source art's transparent padding got smeared
// across the whole lateral surface.
//
// Fix: give the "volume" mesh (drum/box body) a flat untextured material,
// and add a separate ground-parallel disc/plane CHILD mesh carrying the
// actual manifest texture. A flat disc/plane's default UV is already a
// clean, non-wrapped 0..1 rect — exactly how C's art was authored to be
// viewed (a flat card, not a texture wrapped around a solid).

import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import type { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Scene } from '@babylonjs/core/scene';

import { createManifestMaterial, type ManifestKey } from './assets';

export interface FlatCap {
  mesh: Mesh;
  material: StandardMaterial;
}

/**
 * Ground-parallel circular card carrying a manifest-keyed texture, parented
 * to `parent` at local offset `localY` above its pivot (i.e. sits exactly on
 * a cylinder/drum's flat top). `radius` is typically ~0.9x the body's own
 * top radius so a thin rim of the body's flat color frames the art like a
 * dish edge, rather than the card overhanging the drum.
 */
export function attachDiscCap(
  scene: Scene,
  parent: Mesh,
  name: string,
  key: ManifestKey,
  fallbackColor: Color3,
  radius: number,
  localY: number,
  tessellation = 40,
): FlatCap {
  const mesh = MeshBuilder.CreateDisc(name, { radius, tessellation }, scene);
  mesh.rotation.x = Math.PI / 2;
  mesh.parent = parent;
  mesh.position.set(0, localY, 0);
  mesh.isPickable = false;
  const material = createManifestMaterial(scene, `${name}.mat`, key, fallbackColor);
  material.backFaceCulling = false;
  mesh.material = material;
  return { mesh, material };
}

/**
 * Ground-parallel rectangular card — used for box-footprint structures
 * (automation site markers) and standalone scenery decals that don't need a
 * separate 3D "body" mesh at all (a flat painted card lying on the grass is
 * exactly what the scenery SVGs already depict, ground shadow baked in).
 * `parent` is optional: pass a body mesh to sit the card on top of it, or
 * `null` for a freestanding ground decal (position it directly afterward).
 */
export function attachPlaneCap(
  scene: Scene,
  parent: Mesh | null,
  name: string,
  key: ManifestKey,
  fallbackColor: Color3,
  width: number,
  height: number,
  localY: number,
): FlatCap {
  const mesh = MeshBuilder.CreatePlane(name, { width, height }, scene);
  mesh.rotation.x = Math.PI / 2;
  if (parent) {
    mesh.parent = parent;
    mesh.position.set(0, localY, 0);
  } else {
    mesh.position.y = localY;
  }
  mesh.isPickable = false;
  const material = createManifestMaterial(scene, `${name}.mat`, key, fallbackColor);
  material.backFaceCulling = false;
  mesh.material = material;
  return { mesh, material };
}
