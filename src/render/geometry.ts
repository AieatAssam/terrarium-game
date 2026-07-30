// Procedural stylised-diorama geometry helpers.
//
// Everything the garden is built from is a *bevelled* volume rather than a
// raw MeshBuilder primitive. The brief (.claude/agents/visual-fidelity-artist.md,
// "GEOMETRY AND DEPTH REQUIREMENTS") calls for bevelled hard-surface edges and
// "silhouette detail before texture detail" on pots, stones, slides and gates;
// the first Babylon pass used `CreateCylinder({ tessellation: 6 })` for the
// Ember Nook and `tessellation: 8` for the Sunflower Meadow, which read as
// faceted hexagonal/octagonal prisms with razor-sharp unbevelled vertical
// edges, and plain `CreateBox` cubes for the automation sites.
//
// `createRoundedPrism` replaces both cases with one generator:
//
//   * The cross-section is a rounded rectangle with half-extents
//     (halfWidth, halfDepth) and a corner radius. Setting
//     cornerRadius === halfWidth === halfDepth degenerates it to a true
//     circle, which is how the round habitat drums / Nursery mound are built;
//     a smaller corner radius gives the soft-cornered "garden equipment
//     plinth" the automation sites want.
//   * The vertical silhouette comes from a ring list (see `drumProfile`):
//     a chamfered/rounded top rim, a chamfered base, an optional wider foot
//     with a shelf step, and an optional taper. That is real layered
//     silhouette detail in a single draw call rather than a stack of meshes
//     (important because the automation site markers are semi-transparent,
//     where overlapping meshes would double-darken).
//
// Winding / normals are NOT guessed. Both were read off Babylon's own
// builders so this mesh shades identically to a MeshBuilder primitive:
//
//   * `cylinderBuilder.js` emits ring vertices as (cos(-a), sin(-a)) — i.e.
//     z is negated relative to the usual (cos a, sin a) — and indexes each
//     quad as (lower_j, upper_j, lower_j+1) / (upper_j+1, lower_j+1, upper_j).
//     `ringOutline` below mirrors that z-negation so the same index order
//     produces outward-facing triangles.
//   * `VertexData.ComputeNormals` derives a facet normal as
//     (p1 - p2) x (p3 - p2), which agrees with that winding. We nevertheless
//     supply ANALYTIC normals instead of calling it, because the side wall
//     needs a duplicated seam column (so u can run a full 0..1) and
//     ComputeNormals would give the two seam vertices only half their
//     neighbouring facets each — a visible vertical shading seam down every
//     drum. Analytic normals give both seam vertices the same value, so the
//     seam disappears.
//   * Cap indices are reversed for the top face exactly as
//     `createCylinderCap` does, and caps get their own vertices with
//     (0, ±1, 0) normals so the flat top face stays crisp against the
//     rounded rim instead of being smoothed into it.

import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';

/** One horizontal slice of a prism's silhouette. `inset` shrinks the
 * cross-section's half-extents AND corner radius at this height (a negative
 * inset flares it outward, which is how the base foot is expressed). */
export interface PrismRing {
  y: number;
  inset: number;
}

export interface RoundedPrismOptions {
  /** Nominal half-extent along X at inset 0. */
  halfWidth: number;
  /** Nominal half-extent along Z at inset 0. */
  halfDepth: number;
  /** Cross-section corner radius. Clamped to min(halfWidth, halfDepth);
   * passing exactly that gives a circle/ellipse rather than a rounded box. */
  cornerRadius: number;
  /** Bottom-to-top ring list — must be ordered by ascending `y`. */
  rings: PrismRing[];
  /** Points around the cross-section. Rounded to a multiple of 4 so each
   * quadrant gets the same resolution. */
  radialSegments?: number;
}

interface OutlinePoint {
  x: number;
  z: number;
  /** Unit outward horizontal normal at this point. */
  nx: number;
  nz: number;
}

/**
 * One cross-section outline, plus its per-point outward horizontal normal.
 *
 * Two branches, chosen by whether the corner radius fills the whole
 * half-extent:
 *
 *   * True circle/ellipse — one continuous loop of `segments` points.
 *   * Rounded rectangle — four quarter arcs, each emitting `perQuadrant + 1`
 *     points so BOTH tangent points of every flat side are present. Without
 *     the inclusive endpoint a flat side's two ends would carry slightly
 *     different normals and the flat face would shade as a faint curve.
 *
 * The branch condition depends only on (halfWidth - cornerRadius) and
 * (halfDepth - cornerRadius), which `createRoundedPrism` shrinks by the same
 * `inset` on every ring — so every ring of a given prism takes the same
 * branch and yields the same point count, which the quad indexing relies on.
 *
 * z is negated (both arc centres and arc offsets) so the outline is traversed
 * in the same rotational direction as Babylon's cylinder builder — see the
 * module doc comment on winding.
 */
function ringOutline(halfWidth: number, halfDepth: number, cornerRadius: number, segments: number): OutlinePoint[] {
  const hw = Math.max(1e-4, halfWidth);
  const hd = Math.max(1e-4, halfDepth);
  const r = Math.max(0, Math.min(cornerRadius, hw, hd));
  const rx = hw - r;
  const rz = hd - r;
  const points: OutlinePoint[] = [];

  if (rx < 1e-6 && rz < 1e-6) {
    for (let i = 0; i <= segments; i++) {
      const angle = (Math.PI * 2 * i) / segments;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      points.push({ x: hw * cos, z: -hd * sin, nx: cos, nz: -sin });
    }
    return points;
  }

  const perQuadrant = Math.max(1, segments / 4);
  const centres: ReadonlyArray<readonly [number, number]> = [
    [rx, rz],
    [-rx, rz],
    [-rx, -rz],
    [rx, -rz],
  ];
  for (let q = 0; q < 4; q++) {
    const [cx, cz] = centres[q];
    for (let i = 0; i <= perQuadrant; i++) {
      const angle = (q * Math.PI) / 2 + (i / perQuadrant) * (Math.PI / 2);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      points.push({ x: cx + r * cos, z: -(cz + r * sin), nx: cos, nz: -sin });
    }
  }
  // Seam vertex: same position as the first point but a separate vertex, so
  // the side wall's u can run a full 0..1 instead of wrapping.
  points.push({ ...points[0] });
  return points;
}

export function createRoundedPrism(name: string, options: RoundedPrismOptions, scene: Scene): Mesh {
  const segments = Math.max(8, Math.round((options.radialSegments ?? 32) / 4) * 4);
  const { rings, halfWidth, halfDepth, cornerRadius } = options;

  const outlines = rings.map((ring) =>
    ringOutline(halfWidth - ring.inset, halfDepth - ring.inset, cornerRadius - ring.inset, segments),
  );
  const cols = outlines[0].length;
  const minY = rings[0].y;
  const maxY = rings[rings.length - 1].y;
  const span = Math.max(1e-6, maxY - minY);

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // --- side wall -----------------------------------------------------------
  // The profile's local slope decides how far each ring's normal tilts off
  // horizontal: over a step the outline radius changes by -dInset while the
  // height changes by dY, so the outward normal in the (radial, y) plane is
  // (dY, dInset) normalised. A straight wall (dInset = 0) therefore gets a
  // purely radial normal; a top chamfer (inset growing upward) tilts up; a
  // base chamfer (inset shrinking upward) tilts down.
  for (let row = 0; row < rings.length; row++) {
    const prev = rings[Math.max(0, row - 1)];
    const next = rings[Math.min(rings.length - 1, row + 1)];
    const dY = next.y - prev.y;
    const dInset = next.inset - prev.inset;
    const slopeLength = Math.max(1e-6, Math.hypot(dY, dInset));
    const horizontal = dY / slopeLength;
    const vertical = dInset / slopeLength;
    const outline = outlines[row];
    for (let col = 0; col < cols; col++) {
      const point = outline[col];
      positions.push(point.x, rings[row].y, point.z);
      const nx = point.nx * horizontal;
      const nz = point.nz * horizontal;
      const length = Math.max(1e-6, Math.hypot(nx, vertical, nz));
      normals.push(nx / length, vertical / length, nz / length);
      uvs.push(col / (cols - 1), (rings[row].y - minY) / span);
    }
  }
  for (let row = 0; row < rings.length - 1; row++) {
    for (let col = 0; col < cols - 1; col++) {
      const lower = row * cols + col;
      const upper = (row + 1) * cols + col;
      indices.push(lower, upper, lower + 1);
      indices.push(upper + 1, lower + 1, upper);
    }
  }

  // --- flat caps -----------------------------------------------------------
  const addCap = (row: number, isTop: boolean): void => {
    const outline = outlines[row];
    const y = rings[row].y;
    const base = positions.length / 3;
    positions.push(0, y, 0);
    normals.push(0, isTop ? 1 : -1, 0);
    uvs.push(0.5, 0.5);
    for (let col = 0; col < cols; col++) {
      const point = outline[col];
      positions.push(point.x, y, point.z);
      normals.push(0, isTop ? 1 : -1, 0);
      uvs.push(0.5 + point.x / (2 * halfWidth), 0.5 + point.z / (2 * halfDepth));
    }
    for (let col = 0; col < cols - 1; col++) {
      // Top fan wound the opposite way from the bottom fan, matching
      // cylinderBuilder.js's createCylinderCap.
      if (isTop) indices.push(base, base + col + 2, base + col + 1);
      else indices.push(base, base + col + 1, base + col + 2);
    }
  };
  addCap(0, false);
  addCap(rings.length - 1, true);

  const data = new VertexData();
  data.positions = positions;
  data.normals = normals;
  data.uvs = uvs;
  data.indices = indices;
  const mesh = new Mesh(name, scene);
  data.applyToMesh(mesh);
  return mesh;
}

export interface DrumProfileOptions {
  /** Total height of the volume; rings run from -height/2 to +height/2 so
   * the mesh's own pivot stays at its vertical centre, exactly like
   * MeshBuilder.CreateCylinder. */
  height: number;
  /** Rounded rim at the top face. */
  topBevel: number;
  /** Chamfer where the volume meets the ground. */
  bottomBevel: number;
  /** Extra inset at the bottom of the main wall, fading linearly to 0 at the
   * top — a taper (the Sunflower Meadow's original diameterTop/diameterBottom
   * difference is expressed this way). */
  taperInset?: number;
  /** A wider skirt at the base with a shelf step up to the main wall. This is
   * the "pot with a foot" silhouette layer: it reads as a distinct tier at
   * gameplay distance without a second mesh. */
  foot?: { height: number; outset: number; bevel: number };
  /** Ring count used for each quarter-round bevel arc. */
  bevelSegments?: number;
}

/**
 * Ring list for a bevelled drum/plinth: chamfered base (or foot + shelf),
 * optionally tapered main wall, rounded top rim, flat top face.
 */
export function drumProfile(options: DrumProfileOptions): PrismRing[] {
  const { height, topBevel, bottomBevel, taperInset = 0, foot } = options;
  const arcSegments = Math.max(2, options.bevelSegments ?? 3);
  const bottomY = -height / 2;
  const topY = height / 2;
  const rings: PrismRing[] = [];

  /** Taper contribution at a height: full `taperInset` at the base, 0 at the top. */
  const taperAt = (y: number): number => taperInset * (1 - (y - bottomY) / height);

  const add = (y: number, inset: number): void => {
    const last = rings[rings.length - 1];
    if (last && Math.abs(last.y - y) < 1e-6 && Math.abs(last.inset - inset) < 1e-6) return;
    rings.push({ y, inset });
  };

  if (foot) {
    // Quarter-round chamfer at the very bottom of the foot, then straight up
    // the foot wall, then a short shelf stepping in to the main wall.
    for (let i = 0; i <= arcSegments; i++) {
      const phi = (Math.PI / 2) * (i / arcSegments);
      const y = bottomY + foot.bevel * (1 - Math.cos(phi));
      add(y, -foot.outset + foot.bevel * (1 - Math.sin(phi)) + taperAt(y));
    }
    const shelfY = bottomY + foot.height;
    add(shelfY, -foot.outset + taperAt(shelfY));
    add(shelfY + foot.bevel, taperAt(shelfY + foot.bevel));
  } else {
    for (let i = 0; i <= arcSegments; i++) {
      const phi = (Math.PI / 2) * (i / arcSegments);
      const y = bottomY + bottomBevel * (1 - Math.cos(phi));
      add(y, bottomBevel * (1 - Math.sin(phi)) + taperAt(y));
    }
  }

  // Straight (or tapered) main wall up to where the top rim starts.
  add(topY - topBevel, taperAt(topY - topBevel));

  // Rounded top rim, ending exactly on the top face.
  for (let i = 0; i <= arcSegments; i++) {
    const phi = (Math.PI / 2) * (1 - i / arcSegments);
    const y = topY - topBevel * (1 - Math.cos(phi));
    add(y, topBevel * (1 - Math.sin(phi)) + taperAt(y));
  }

  return rings;
}

// ===========================================================================
// PROCEDURAL SCENERY GEOMETRY
// ===========================================================================
//
// The scenery layer used to be flat billboard cards carrying a top-down
// illustration (rocks read as grey diamonds lying on the soil, foliage as
// green blobs). docs/ART_QA_REPORT.md's Phase 4 pass LOWERED the Polish score
// specifically because of them: once the props became bevelled volumes, the
// cards were the only thing left in frame with no silhouette at all.
//
// Everything below replaces them with real, if small, volumes. The design
// rules, matching the brief's "silhouette detail before texture detail":
//
//   * Nothing is a single flat quad. Even a blade of grass is a folded ribbon
//     (three columns, midrib raised) so it has a cross-section and catches the
//     key light differently along its length.
//   * Every generator is DETERMINISTIC from an integer seed, so master meshes
//     are identical across reloads (src/render/layout.ts owns the world's
//     seeding contract; this module only needs per-master repeatability).
//   * Generators return `VertexData`, not meshes, so several parts can be
//     composed into ONE master mesh (`mergeVertexData`) and that master can be
//     drawn hundreds of times as thin instances — one draw call per KIND, not
//     per object.
//   * Normals are computed with `VertexData.ComputeNormals` and then WELDED
//     (`weldNormals`) across coincident vertices. Without the weld, every
//     revolved shape shows a shading seam down the duplicated UV seam column,
//     and every merged part shows a hard crease where it meets its neighbour.

/** Local deterministic PRNG for master-mesh generation. Sequential (rather
 * than positional like layout.ts's `rand01`) is fine here: each master mesh is
 * generated once from its own seed and never has elements inserted into the
 * middle of its draw order. */
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Averages normals across vertices that share a position, so duplicated seam
 * vertices and merged part boundaries shade continuously. Quantised to 1e-4 so
 * float noise doesn't defeat the match. */
function weldNormals(positions: number[], normals: number[]): void {
  const buckets = new Map<string, number[]>();
  for (let i = 0; i < positions.length; i += 3) {
    const key = `${Math.round(positions[i] * 1e4)},${Math.round(positions[i + 1] * 1e4)},${Math.round(positions[i + 2] * 1e4)}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(i);
    else buckets.set(key, [i]);
  }
  for (const bucket of buckets.values()) {
    if (bucket.length < 2) continue;
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (const i of bucket) {
      nx += normals[i];
      ny += normals[i + 1];
      nz += normals[i + 2];
    }
    const length = Math.hypot(nx, ny, nz);
    if (length < 1e-6) continue;
    for (const i of bucket) {
      normals[i] = nx / length;
      normals[i + 1] = ny / length;
      normals[i + 2] = nz / length;
    }
  }
}

function finishVertexData(positions: number[], indices: number[], uvs: number[]): VertexData {
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  weldNormals(positions, normals);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.uvs = uvs;
  data.normals = normals;
  return data;
}

/** Concatenates several VertexData blocks into one (offsetting indices).
 * This is how a mushroom's stem and cap, or a lantern's post and finial,
 * become a single mesh with a single draw call. */
export function mergeVertexData(parts: VertexData[]): VertexData {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (const part of parts) {
    const offset = positions.length / 3;
    positions.push(...(part.positions as number[]));
    normals.push(...(part.normals as number[]));
    uvs.push(...(part.uvs as number[]));
    for (const index of part.indices as number[]) indices.push(index + offset);
  }
  const merged = new VertexData();
  merged.positions = positions;
  merged.normals = normals;
  merged.uvs = uvs;
  merged.indices = indices;
  return merged;
}

/** Applies a transform to a VertexData in place (positions and normals).
 * Used to place a part — a petal, a leaf, a lantern pane — inside a master
 * mesh's local space before merging. */
export function transformVertexData(data: VertexData, matrix: Matrix): VertexData {
  const positions = data.positions as number[];
  const normals = data.normals as number[];
  const point = new Vector3();
  for (let i = 0; i < positions.length; i += 3) {
    point.set(positions[i], positions[i + 1], positions[i + 2]);
    const transformed = Vector3.TransformCoordinates(point, matrix);
    positions[i] = transformed.x;
    positions[i + 1] = transformed.y;
    positions[i + 2] = transformed.z;
    point.set(normals[i], normals[i + 1], normals[i + 2]);
    const rotated = Vector3.TransformNormal(point, matrix);
    rotated.normalize();
    normals[i] = rotated.x;
    normals[i + 1] = rotated.y;
    normals[i + 2] = rotated.z;
  }
  return data;
}

export function createMeshFromVertexData(name: string, data: VertexData, scene: Scene): Mesh {
  const mesh = new Mesh(name, scene);
  data.applyToMesh(mesh);
  return mesh;
}

// ---------------------------------------------------------------------------
// Revolved profiles (lathe)
// ---------------------------------------------------------------------------

export interface LathePoint {
  /** Radius at this height. 0 closes the surface to a point (no cap needed). */
  r: number;
  y: number;
}

/**
 * Surface of revolution through a bottom-to-top radius profile. Winding and
 * the z-negated ring traversal match `ringOutline`/`createRoundedPrism` above
 * (which in turn mirror Babylon's own `cylinderBuilder`), so these shade
 * identically to the rest of the garden's geometry.
 *
 * Flat caps are added automatically at either end when that end's radius is
 * non-zero — a mushroom stem needs a bottom cap, a lantern finial tapering to
 * r = 0 does not.
 */
export function latheVertexData(profile: LathePoint[], segments: number): VertexData {
  const cols = segments + 1; // inclusive seam column so u can run a full 0..1
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const minY = profile[0].y;
  const maxY = profile[profile.length - 1].y;
  const span = Math.max(1e-6, maxY - minY);

  for (const point of profile) {
    for (let col = 0; col < cols; col++) {
      const angle = (Math.PI * 2 * col) / segments;
      positions.push(point.r * Math.cos(angle), point.y, -point.r * Math.sin(angle));
      uvs.push(col / segments, (point.y - minY) / span);
    }
  }
  for (let row = 0; row < profile.length - 1; row++) {
    for (let col = 0; col < cols - 1; col++) {
      const lower = row * cols + col;
      const upper = (row + 1) * cols + col;
      indices.push(lower, upper, lower + 1);
      indices.push(upper + 1, lower + 1, upper);
    }
  }

  const addCap = (row: number, isTop: boolean): void => {
    const point = profile[row];
    if (point.r <= 1e-5) return;
    const base = positions.length / 3;
    positions.push(0, point.y, 0);
    uvs.push(0.5, 0.5);
    for (let col = 0; col < cols; col++) {
      const angle = (Math.PI * 2 * col) / segments;
      positions.push(point.r * Math.cos(angle), point.y, -point.r * Math.sin(angle));
      uvs.push(0.5 + Math.cos(angle) * 0.5, 0.5 - Math.sin(angle) * 0.5);
    }
    for (let col = 0; col < cols - 1; col++) {
      if (isTop) indices.push(base, base + col + 2, base + col + 1);
      else indices.push(base, base + col + 1, base + col + 2);
    }
  };
  addCap(0, false);
  addCap(profile.length - 1, true);

  return finishVertexData(positions, indices, uvs);
}

// ---------------------------------------------------------------------------
// Stones
// ---------------------------------------------------------------------------

export interface PebbleOptions {
  seed: number;
  /** Points around the equator. */
  segments?: number;
  /** Latitude bands. */
  rings?: number;
  /** Vertical squash: 1 = sphere, 0.45 = a pebble resting in the soil. */
  flatten?: number;
  /** How far the surface deviates from a sphere (0.18 ≈ a rounded river
   * stone, 0.32 ≈ a chipped garden rock). */
  lumpiness?: number;
}

/**
 * A rounded, irregular stone: a sphere whose radius is modulated by three
 * smooth low-frequency lobes at seeded frequencies/phases, then squashed.
 * Deliberately LOBED rather than noise-displaced — high-frequency noise on a
 * 120-triangle mesh reads as faceting, whereas a few big lobes read as a
 * genuinely irregular boulder silhouette at gameplay distance, which is what
 * the flat cards were missing.
 */
export function pebbleVertexData(options: PebbleOptions): VertexData {
  const segments = options.segments ?? 12;
  const rings = options.rings ?? 8;
  const flatten = options.flatten ?? 0.55;
  const lumpiness = options.lumpiness ?? 0.22;
  const rand = mulberry32(options.seed);
  const lobes = Array.from({ length: 3 }, () => ({
    fx: 1 + rand() * 1.7,
    fy: 1 + rand() * 1.7,
    fz: 1 + rand() * 1.7,
    px: rand() * Math.PI * 2,
    py: rand() * Math.PI * 2,
    pz: rand() * Math.PI * 2,
    amp: lumpiness * (0.45 + rand() * 0.55),
  }));

  const cols = segments + 1;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let row = 0; row <= rings; row++) {
    const phi = (Math.PI * row) / rings;
    const y0 = -Math.cos(phi);
    const r0 = Math.sin(phi);
    for (let col = 0; col < cols; col++) {
      const angle = (Math.PI * 2 * col) / segments;
      const ux = r0 * Math.cos(angle);
      const uy = y0;
      const uz = -r0 * Math.sin(angle);
      let radius = 1;
      for (const lobe of lobes) {
        radius += lobe.amp * Math.sin(ux * lobe.fx * 2.4 + lobe.px) * Math.sin(uy * lobe.fy * 2.1 + lobe.py) * Math.sin(uz * lobe.fz * 2.6 + lobe.pz);
      }
      positions.push(ux * radius * 0.5, (uy * radius * 0.5 + 0.5) * flatten, uz * radius * 0.5);
      uvs.push(col / segments, row / rings);
    }
  }
  for (let row = 0; row < rings; row++) {
    for (let col = 0; col < cols - 1; col++) {
      const lower = row * cols + col;
      const upper = (row + 1) * cols + col;
      indices.push(lower, upper, lower + 1);
      indices.push(upper + 1, lower + 1, upper);
    }
  }
  return finishVertexData(positions, indices, uvs);
}

// ---------------------------------------------------------------------------
// Foliage
// ---------------------------------------------------------------------------

export interface BladeOptions {
  length: number;
  width: number;
  /** Segments along the blade. More = a smoother arc; 4 is plenty at this scale. */
  segments?: number;
  /** Horizontal displacement at the tip — the droop. */
  bend: number;
  /** Height of the raised midrib as a fraction of the local width. A blade
   * with fold = 0 is a flat quad, which is exactly the look being replaced. */
  fold?: number;
  /** Exponent on the width taper: 1 = linear, >1 = holds its width longer
   * before tapering (a fern pinna rather than a grass blade). */
  taper?: number;
}

/**
 * One folded blade/leaf, growing up +Y from the origin and bending toward +X.
 * Three columns per row (left edge, raised midrib, right edge) so the blade
 * has a shallow V cross-section: it catches a highlight along the rib and
 * falls into shade at the edges, which is what stops foliage reading as
 * paper. Two-sided by material (`doubleSided`), so no back faces are emitted.
 */
export function bladeVertexData(options: BladeOptions): VertexData {
  const segments = options.segments ?? 4;
  const fold = options.fold ?? 0.35;
  const taper = options.taper ?? 1.1;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let row = 0; row <= segments; row++) {
    const t = row / segments;
    const width = options.width * Math.pow(1 - t, taper) * 0.5;
    const y = options.length * Math.sin((t * Math.PI) / 2.15); // eases over at the tip
    const x = options.bend * t * t;
    positions.push(x, y, -width);
    positions.push(x + fold * width * 0.6, y + fold * width, 0);
    positions.push(x, y, width);
    uvs.push(0, t, 0.5, t, 1, t);
  }
  for (let row = 0; row < segments; row++) {
    const a = row * 3;
    const b = (row + 1) * 3;
    indices.push(a, b, a + 1);
    indices.push(b, b + 1, a + 1);
    indices.push(a + 1, b + 1, a + 2);
    indices.push(b + 1, b + 2, a + 2);
  }
  return finishVertexData(positions, indices, uvs);
}

export interface TuftOptions {
  seed: number;
  blades?: number;
  height?: number;
  width?: number;
  /** How far the blades splay outward. */
  spread?: number;
}

/** A clump of grass/moss blades fanning out from one root. */
export function tuftVertexData(options: TuftOptions): VertexData {
  const rand = mulberry32(options.seed);
  const count = options.blades ?? 7;
  const height = options.height ?? 0.24;
  const parts: VertexData[] = [];
  for (let i = 0; i < count; i++) {
    const blade = bladeVertexData({
      length: height * (0.6 + rand() * 0.7),
      width: (options.width ?? 0.05) * (0.7 + rand() * 0.6),
      bend: (options.spread ?? 0.11) * (0.4 + rand()),
      segments: 3,
      fold: 0.4,
      taper: 1.25,
    });
    const yaw = (i / count) * Math.PI * 2 + rand() * 0.8;
    const lean = (rand() - 0.5) * 0.35;
    transformVertexData(
      blade,
      Matrix.RotationZ(lean).multiply(Matrix.RotationY(yaw)).multiply(Matrix.Translation((rand() - 0.5) * 0.05, 0, (rand() - 0.5) * 0.05)),
    );
    parts.push(blade);
  }
  return mergeVertexData(parts);
}

export interface LeafClusterOptions {
  seed: number;
  leaves?: number;
  radius?: number;
  height?: number;
  /** 0 = leaves point straight up, 1 = they lie almost flat (a fern). */
  droop?: number;
  /** Extra tiers of leaves stacked up the cluster, which is what gives a bush
   * depth instead of a single ring of leaves around a bald centre. */
  tiers?: number;
}

/** A bush/fern: tiers of folded leaves radiating from a short stem, each tier
 * smaller and steeper than the one below. */
export function leafClusterVertexData(options: LeafClusterOptions): VertexData {
  const rand = mulberry32(options.seed);
  const leaves = options.leaves ?? 7;
  const radius = options.radius ?? 0.3;
  const height = options.height ?? 0.34;
  const droop = options.droop ?? 0.45;
  const tiers = options.tiers ?? 2;
  const parts: VertexData[] = [];
  for (let tier = 0; tier < tiers; tier++) {
    const tierT = tiers === 1 ? 0 : tier / (tiers - 1);
    const tierY = height * 0.28 * tierT;
    const tierScale = 1 - tierT * 0.35;
    const count = Math.max(3, Math.round(leaves * tierScale));
    for (let i = 0; i < count; i++) {
      const leaf = bladeVertexData({
        length: height * tierScale * (0.75 + rand() * 0.5),
        width: radius * 0.55 * tierScale * (0.75 + rand() * 0.5),
        bend: radius * (0.6 + rand() * 0.6),
        segments: 3,
        fold: 0.3,
        taper: 0.85,
      });
      const yaw = (i / count) * Math.PI * 2 + tierT * 0.7 + rand() * 0.45;
      const pitch = -droop * (0.6 + rand() * 0.7) * (1 - tierT * 0.5);
      transformVertexData(
        leaf,
        Matrix.RotationZ(pitch).multiply(Matrix.RotationY(yaw)).multiply(Matrix.Translation(0, tierY, 0)),
      );
      parts.push(leaf);
    }
  }
  return mergeVertexData(parts);
}

export interface BlossomOptions {
  seed: number;
  petals?: number;
  radius?: number;
  stemHeight?: number;
}

/**
 * A small flower, returned as TWO blocks because they want different
 * materials AND different per-instance tinting: the stem/centre stays garden
 * green whatever colour the bloom is, while the petals carry the instance's
 * pastel tint. Both blocks are thin-instanced against one shared transform
 * buffer, so a flower is two draw calls for the whole flower bed.
 */
export function blossomVertexData(options: BlossomOptions): { stem: VertexData; petals: VertexData } {
  const rand = mulberry32(options.seed);
  const petals = options.petals ?? 5;
  const radius = options.radius ?? 0.075;
  const stemHeight = options.stemHeight ?? 0.16;
  const stemParts: VertexData[] = [];
  const parts: VertexData[] = [];

  stemParts.push(
    latheVertexData(
      [
        { r: 0.012, y: 0 },
        { r: 0.009, y: stemHeight * 0.6 },
        { r: 0.008, y: stemHeight },
      ],
      6,
    ),
  );
  for (let i = 0; i < petals; i++) {
    const petal = bladeVertexData({
      length: radius * 1.5,
      width: radius * 1.25,
      bend: radius * 0.5,
      segments: 2,
      fold: 0.5,
      taper: 0.5,
    });
    const yaw = (i / petals) * Math.PI * 2 + rand() * 0.15;
    transformVertexData(
      petal,
      Matrix.RotationZ(-1.05 - rand() * 0.25).multiply(Matrix.RotationY(yaw)).multiply(Matrix.Translation(0, stemHeight, 0)),
    );
    parts.push(petal);
  }
  stemParts.push(
    transformVertexData(
      latheVertexData(
        [
          { r: radius * 0.34, y: 0 },
          { r: radius * 0.4, y: radius * 0.14 },
          { r: radius * 0.26, y: radius * 0.3 },
          { r: 0, y: radius * 0.4 },
        ],
        8,
      ),
      Matrix.Translation(0, stemHeight, 0),
    ),
  );
  return { stem: mergeVertexData(stemParts), petals: mergeVertexData(parts) };
}

/** A mushroom: bevelled stem plus a domed cap with a rolled rim. */
export function mushroomVertexData(seed: number): VertexData {
  const rand = mulberry32(seed);
  const capRadius = 0.09 + rand() * 0.05;
  const stemHeight = 0.09 + rand() * 0.06;
  const capHeight = capRadius * (0.7 + rand() * 0.4);
  const stem = latheVertexData(
    [
      { r: capRadius * 0.32, y: 0 },
      { r: capRadius * 0.24, y: stemHeight * 0.45 },
      { r: capRadius * 0.27, y: stemHeight },
    ],
    9,
  );
  const cap = transformVertexData(
    latheVertexData(
      [
        { r: capRadius * 0.34, y: 0 },
        { r: capRadius, y: capHeight * 0.16 },
        { r: capRadius * 0.94, y: capHeight * 0.3 },
        { r: capRadius * 0.72, y: capHeight * 0.72 },
        { r: 0, y: capHeight },
      ],
      12,
    ),
    Matrix.Translation(0, stemHeight * 0.94, 0),
  );
  return mergeVertexData([stem, cap]);
}

/** A lily pad: a shallow dome with a wedge notch cut out of it, so it reads
 * as a lily pad in silhouette rather than as a green coin. */
export function lilyPadVertexData(seed: number): VertexData {
  const rand = mulberry32(seed);
  const radius = 0.18 + rand() * 0.07;
  const notch = 0.5 + rand() * 0.3; // radians of missing wedge
  const segments = 14;
  const rings = 3;
  const positions: number[] = [0, radius * 0.06, 0];
  const uvs: number[] = [0.5, 0.5];
  const indices: number[] = [];
  const arc = Math.PI * 2 - notch;
  for (let ring = 1; ring <= rings; ring++) {
    const t = ring / rings;
    for (let col = 0; col <= segments; col++) {
      const angle = notch / 2 + (arc * col) / segments;
      const r = radius * t;
      positions.push(r * Math.cos(angle), radius * 0.06 * (1 - t * t) + radius * 0.02 * Math.sin(angle * 3), -r * Math.sin(angle));
      uvs.push(0.5 + Math.cos(angle) * t * 0.5, 0.5 - Math.sin(angle) * t * 0.5);
    }
  }
  const ringStart = (ring: number): number => 1 + (ring - 1) * (segments + 1);
  for (let col = 0; col < segments; col++) {
    indices.push(0, ringStart(1) + col + 1, ringStart(1) + col);
  }
  for (let ring = 1; ring < rings; ring++) {
    for (let col = 0; col < segments; col++) {
      const a = ringStart(ring) + col;
      const b = ringStart(ring + 1) + col;
      indices.push(a, b + 1, b);
      indices.push(a, a + 1, b + 1);
    }
  }
  return finishVertexData(positions, indices, uvs);
}

/** A laid kerb stone for the first-expansion border: a low rounded block,
 * longer than it is deep, with a slightly domed top so a row of them reads as
 * hand-set stones rather than an extruded wall. */
export function kerbStoneVertexData(seed: number): VertexData {
  const rand = mulberry32(seed);
  const data = pebbleVertexData({ seed: seed ^ 0x33, segments: 10, rings: 6, flatten: 0.42, lumpiness: 0.14 });
  const positions = data.positions as number[];
  // Proportions matter more than they look: an earlier pass squashed these to
  // 0.34 of their height and 0.24 of their depth, and at gameplay distance the
  // resulting ring read as a scatter of pale pebbles rather than as a laid
  // border. A kerb needs enough vertical face to catch the key light and cast
  // a continuous shadow line.
  const stretch = 1.5 + rand() * 0.35;
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] *= stretch * 0.46;
    positions[i + 1] *= 0.78;
    positions[i + 2] *= 0.4;
  }
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, data.indices as number[], normals);
  weldNormals(positions, normals);
  data.normals = normals;
  return data;
}

/**
 * A garden lantern, returned as TWO vertex-data blocks because they need
 * different materials: an opaque painted post/frame and an emissive glass
 * housing. Both are thin-instanced against the same transform buffer, so a
 * lantern costs two draw calls total no matter how many are placed.
 */
export function lanternVertexData(seed: number): { frame: VertexData; glass: VertexData } {
  const rand = mulberry32(seed);
  const postHeight = 0.42 + rand() * 0.06;
  const housingY = postHeight;
  const housingHeight = 0.17;
  const frame = mergeVertexData([
    // Foot
    latheVertexData(
      [
        { r: 0.075, y: 0 },
        { r: 0.07, y: 0.018 },
        { r: 0.05, y: 0.035 },
        { r: 0.026, y: 0.055 },
      ],
      10,
    ),
    // Post
    latheVertexData(
      [
        { r: 0.024, y: 0.03 },
        { r: 0.019, y: postHeight * 0.55 },
        { r: 0.022, y: housingY },
      ],
      8,
    ),
    // Housing base ring
    latheVertexData(
      [
        { r: 0.05, y: housingY - 0.012 },
        { r: 0.062, y: housingY },
        { r: 0.055, y: housingY + 0.016 },
      ],
      10,
    ),
    // Roof
    latheVertexData(
      [
        { r: 0.068, y: housingY + housingHeight },
        { r: 0.075, y: housingY + housingHeight + 0.012 },
        { r: 0.03, y: housingY + housingHeight + 0.052 },
        { r: 0, y: housingY + housingHeight + 0.075 },
      ],
      10,
    ),
  ]);
  const glass = latheVertexData(
    [
      { r: 0.036, y: housingY + 0.012 },
      { r: 0.05, y: housingY + housingHeight * 0.42 },
      { r: 0.046, y: housingY + housingHeight * 0.8 },
      { r: 0.032, y: housingY + housingHeight },
    ],
    12,
  );
  return { frame, glass };
}

/**
 * The stone shoulder around a water basin: a ring of overlapping pebble-like
 * lumps at the waterline. This is the fix for the flat blue ellipse the water
 * accents used to be — the water now sits INSIDE something, with a physical
 * edge that catches light, instead of ending on a hard polygon boundary.
 */
export function basinRimVertexData(seed: number, radius: number, depth: number): VertexData {
  const rand = mulberry32(seed);
  const count = Math.max(8, Math.round(radius * 9));
  const parts: VertexData[] = [];
  for (let i = 0; i < count; i++) {
    const stone = pebbleVertexData({
      seed: seed + i * 977,
      segments: 8,
      rings: 5,
      flatten: 0.5,
      lumpiness: 0.24,
    });
    const scale = radius * (0.28 + rand() * 0.16);
    const angle = (i / count) * Math.PI * 2 + (rand() - 0.5) * 0.25;
    // Stones straddle the WATERLINE rather than ringing it from dry land. An
    // earlier pass set this to 0.93 of the bowl radius while the water only
    // reached 0.72, which left a band of bare soil between the two and the
    // water still ended on a hard unbroken polygon edge — the exact defect
    // this rim exists to fix. Sitting them on the edge means the outline is
    // physically interrupted by geometry from every angle.
    const ringRadius = radius * (0.84 + (rand() - 0.5) * 0.12);
    transformVertexData(
      stone,
      Matrix.Scaling(scale, scale * (0.7 + rand() * 0.5), scale)
        .multiply(Matrix.RotationY(rand() * Math.PI * 2))
        .multiply(Matrix.Translation(Math.cos(angle) * ringRadius, -depth * 0.42 * rand(), Math.sin(angle) * ringRadius)),
    );
    parts.push(stone);
  }
  return mergeVertexData(parts);
}

/** A flat, upward-facing disc with a centre vertex and clean radial UVs —
 * the open water surface inside a basin. `MeshBuilder.CreateDisc` would do
 * the same job, but returning VertexData lets several basins merge into one
 * mesh (one draw call for all the water in the garden). */
export function discVertexData(radius: number, segments = 24): VertexData {
  const positions: number[] = [0, 0, 0];
  const uvs: number[] = [0.5, 0.5];
  const indices: number[] = [];
  for (let col = 0; col <= segments; col++) {
    const angle = (Math.PI * 2 * col) / segments;
    positions.push(radius * Math.cos(angle), 0, -radius * Math.sin(angle));
    uvs.push(0.5 + Math.cos(angle) * 0.5, 0.5 - Math.sin(angle) * 0.5);
  }
  for (let col = 0; col < segments; col++) {
    indices.push(0, col + 2, col + 1);
  }
  return finishVertexData(positions, indices, uvs);
}
