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
