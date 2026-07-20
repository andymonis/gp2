import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

// --- Track shape ------------------------------------------------------------
// A fictional low-poly track inspired by 1990-era Silverstone: the black
// 1949-1990 base perimeter plus the purple 1987 Woodcote/Luffield alterations
// from research/tracks/silverstone/track_layout_all.png (the layout in use
// through the 1990 season, before the 1991 Priory/Brooklands reprofile).
// Corner sequence: Copse -> Maggotts -> Becketts -> Chapel -> Hangar Straight
// -> Stowe -> Vale -> Club -> Abbey -> Bridge -> Luffield -> Woodcote -> pit
// straight. Coordinates are hand-estimated from the reference image's
// proportions (not pixel-traced) - "hand-built, inspired-by", not a
// laser-scanned recreation, per requirements doc §8. Flat (no elevation),
// matching the real circuit's ex-airfield character.
//
// Entry/exit points flank each named corner (not just its apex) so the
// Catmull-Rom spline through them doesn't overshoot/undershoot at the
// tighter corners (Luffield, Woodcote).
const TRACK_WAYPOINTS: [x: number, z: number][] = [
  [150, 650], // start/finish (pit straight)
  [150, 350], // Copse entry
  [250, 200], // Copse apex (fast right)
  [500, 170], // Copse exit
  [650, 190], // Maggotts entry
  [750, 130], // Maggotts apex (left)
  [850, 170], // Becketts apex 1 (right)
  [950, 110], // Becketts apex 2 (left)
  [1080, 150], // Becketts apex 3 / Chapel (right)
  [1250, 140], // Chapel exit onto Hangar Straight
  [1550, 220], // Hangar Straight mid
  [1850, 380], // Hangar Straight end / Stowe entry
  [1980, 600], // Stowe apex (fast right)
  [1950, 750], // Stowe exit / Vale entry
  [1880, 820], // Vale apex (left)
  [1930, 900], // Club entry
  [2000, 1000], // Club apex (right)
  [1900, 1150], // Abbey entry
  [1750, 1230], // Abbey apex (flat-out right kink)
  [1550, 1280], // Bridge entry
  [1300, 1300], // Bridge apex (fast right sweep)
  [1050, 1280], // Bridge exit / Luffield entry
  [850, 1200], // Luffield apex 1 (tightening left)
  [720, 1100], // Luffield apex 2 (hairpin)
  [650, 950], // Luffield exit / Woodcote entry
  [500, 900], // Woodcote apex 1 (right)
  [400, 820], // Woodcote apex 2 (left flick)
  [200, 780], // Woodcote exit onto pit straight
];

// --- Tunables ----------------------------------------------------------------
const TRACK_WIDTH = 15; // meters, realistic F1-track paved width
const KERB_WIDTH = 1.8;
// Real curbs alternate physically raised and flush blocks (not just paint) as
// a deterrent to driving over them. Went through three sizes: 10cm (visual
// only, flat collision - a genuine 10cm bump on a suspension with only 3.5cm
// of travel risked reintroducing the force-spike instability that took two
// tuning passes to fix), then 1cm (small enough to make the collision real
// too, as a mild vibration), then pushed up to 5cm on request - this time
// deliberately wanting real instability, not just a vibration, since curbs
// are meant to be actively avoided rather than a comfortable racing line
// extension. At 5cm the step exceeds SUSPENSION_MAX_TRAVEL (3.5cm), so the
// wheel genuinely tops out and some of the bump transmits straight into the
// chassis rather than being fully absorbed - the suspension's existing
// safety clamps (MAX_COMPRESSION_VEL, SUSPENSION_MAX_FORCE) still bound the
// worst case, so this is "unsettles the car for real" rather than "breaks
// the physics" - verified via scripted diagnostic, not assumed.
const KERB_FLUSH_HEIGHT = 0.005; // just above the asphalt, avoids z-fighting
const KERB_RISE = 0.05; // the "raised" blocks sit this much higher than flush
const KERB_RAISED_HEIGHT = KERB_FLUSH_HEIGHT + KERB_RISE;
const KERB_BLOCK_LENGTH = 4; // meters per alternating red/white, raised/flush block
const SAMPLE_COUNT = 1200; // ~4.6m spacing around the ~5.5km lap

// A corner is flagged wherever the centerline's curvature implies a radius
// tighter than this - used to decide where kerbs (and the wider paved
// collision footprint under them) appear. Dilated by CORNER_DILATE_M so kerbs
// start slightly before/after the curvature actually crosses the threshold,
// instead of clipping on abruptly at the exact sample.
const CORNER_RADIUS_THRESHOLD = 200; // meters
const CORNER_DILATE_M = 15;

const ASPHALT_COLOR = 0x3a3a3a;
const GRASS_COLOR = 0x2f6b2f;
const KERB_RED = 0xcc2222;
const KERB_WHITE = 0xf0f0f0;

const GRASS_PADDING = 400; // meters beyond the track's bounding box
const GRASS_COLLIDER_DROP = 0.05; // grass sits slightly below the track surface

// A permanent white line along both edges of the track, everywhere the kerb
// isn't already marking the boundary (kerbs and lines are mutually exclusive
// by isCorner, so together they cover the whole loop without overlapping).
const EDGE_LINE_WIDTH = 0.1;
const EDGE_LINE_COLOR = 0xf2f2f2;
const EDGE_LINE_HEIGHT = 0.008; // just above the asphalt, avoids z-fighting

// Perimeter walls, both outside the track and around the infield - offset
// from the paved edge (not the centerline) per the brief's "5-10m from the
// edge". Colored concrete by default, switching to a tire-barrier look
// (alternating black/white, like stacked tires) at corners specifically,
// since that's where real circuits actually place them (higher impact risk)
// - reuses the same isCorner flag as the kerbs, no separate placement logic.
const WALL_OFFSET_FROM_EDGE = 7; // meters beyond the paved edge
const WALL_HEIGHT = 1.2;
const WALL_THICKNESS = 0.3;
const WALL_CONCRETE_COLOR = 0x9a9a9a;
const WALL_TIRE_BLACK = 0x1a1a1a;
const WALL_TIRE_WHITE = 0xe8e8e8;
const WALL_TIRE_BLOCK_LENGTH = 3; // meters per alternating black/white block

// Distance boards before each corner, like real trackside braking markers -
// placed trackside (past the kerb, into the grass verge) so they never
// intrude on the paved/collision footprint. Stripe count mimics the
// real-world convention of more stripes = further out.
const MARKER_DISTANCES: [distanceBefore: number, stripeCount: number][] = [
  [200, 2],
  [100, 1],
];
const MARKER_OFFSET = TRACK_WIDTH / 2 + KERB_WIDTH + 3;
const POLE_HEIGHT = 3;
const POLE_RADIUS = 0.08;
const SIGN_WIDTH = 1.4;
const SIGN_HEIGHT = 1;
const SIGN_THICKNESS = 0.06;
const STRIPE_HEIGHT = 0.22;
const STRIPE_GAP = 0.1;

// Grip multipliers applied on top of the vehicle's own tire grip
// (TIRE_GRIP_FRONT/REAR in vehicle.ts) - a first pass, expected to be
// re-tuned once this can be played on the real track rather than judged in
// isolation. Track is tuned a bit above the old open-plane baseline (real
// asphalt vs. generic ground); grass is deliberately slippery so straying off
// line is punished, per the brief ("track should have a higher grip
// coefficient, grass should be slippier").
export const SURFACE_GRIP_TRACK = 1.15;
export const SURFACE_GRIP_GRASS = 0.5;
// Slightly less grip than the main track, without being as punishing as
// grass - a deterrent to using the curbs as extra track width, not a trap.
export const SURFACE_GRIP_KERB = 0.85;

const UP = new THREE.Vector3(0, 1, 0);

export interface TrackHandle {
  startPosition: THREE.Vector3;
  startYaw: number;
  /** Half-width of the start/finish crossing gate, wall to wall (not just the paved track) - a car that's gone wide onto the grass should still trigger the lap timer, only a car that's hit the wall shouldn't be able to. */
  startLineHalfWidth: number;
  /** Looks up the grip multiplier for a Rapier collider handle hit by a wheel raycast. Defaults to track grip for anything unrecognized. */
  getSurfaceGrip: (colliderHandle: number) => number;
}

interface TrackSamples {
  center: THREE.Vector3[];
  right: THREE.Vector3[]; // world-space "right of travel" unit vector per sample
  distanceAlong: number[];
  isCorner: boolean[];
  length: number; // total lap length, meters
}

export function buildTrack(world: RAPIER.World, scene: THREE.Scene): TrackHandle {
  const curvePoints = TRACK_WAYPOINTS.map(([x, z]) => new THREE.Vector3(x, 0, z));
  const curve = new THREE.CatmullRomCurve3(curvePoints, true, 'catmullrom', 0.5);

  const samples = sampleTrack(curve);

  const group = new THREE.Group();
  group.add(buildAsphaltMesh(samples));
  group.add(buildKerbMesh(samples));
  group.add(buildEdgeLineMesh(samples));
  group.add(buildStartFinishMarker(samples));
  group.add(buildDistanceMarkers(samples));
  group.add(buildWallMesh(samples, 1));
  group.add(buildWallMesh(samples, -1));
  scene.add(group);

  const grassMesh = buildGrassMesh(samples);
  scene.add(grassMesh);

  const surfaceGrip = new Map<number, number>();
  const trackBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());

  const trackCollider = world.createCollider(buildTrackColliderDesc(samples), trackBody);
  surfaceGrip.set(trackCollider.handle, SURFACE_GRIP_TRACK);

  const kerbCollider = world.createCollider(buildKerbColliderDesc(samples), trackBody);
  surfaceGrip.set(kerbCollider.handle, SURFACE_GRIP_KERB);

  world.createCollider(buildWallColliderDesc(samples, 1), trackBody);
  world.createCollider(buildWallColliderDesc(samples, -1), trackBody);

  const bounds = trackBounds(samples.center);
  const grassCollider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(
      (bounds.maxX - bounds.minX) / 2 + GRASS_PADDING,
      0.5,
      (bounds.maxZ - bounds.minZ) / 2 + GRASS_PADDING,
    )
      .setTranslation(
        (bounds.minX + bounds.maxX) / 2,
        -0.5 - GRASS_COLLIDER_DROP,
        (bounds.minZ + bounds.maxZ) / 2,
      )
      .setFriction(0.6),
    trackBody,
  );
  surfaceGrip.set(grassCollider.handle, SURFACE_GRIP_GRASS);

  const startPosition = samples.center[0].clone().setY(1);
  const startDir = samples.center[1].clone().sub(samples.center[0]).setY(0).normalize();
  const startYaw = Math.atan2(startDir.x, startDir.z);

  return {
    startPosition,
    startYaw,
    startLineHalfWidth: TRACK_WIDTH / 2 + WALL_OFFSET_FROM_EDGE,
    getSurfaceGrip: (handle: number) => surfaceGrip.get(handle) ?? SURFACE_GRIP_TRACK,
  };
}

/** Samples the centerline at ~uniform arc-length spacing and computes per-sample tangent/right/curvature. */
function sampleTrack(curve: THREE.CatmullRomCurve3): TrackSamples {
  const raw = curve.getPoints(SAMPLE_COUNT);
  const center = raw.slice(0, SAMPLE_COUNT); // drop the duplicated closing point
  const n = center.length;

  const right: THREE.Vector3[] = new Array(n);
  const distanceAlong: number[] = new Array(n);
  const curvature: number[] = new Array(n);

  let distance = 0;
  for (let i = 0; i < n; i++) {
    const prev = center[(i - 1 + n) % n];
    const next = center[(i + 1) % n];
    const tangent = next.clone().sub(prev).setY(0).normalize();
    right[i] = new THREE.Vector3().crossVectors(UP, tangent).normalize();

    distanceAlong[i] = distance;
    distance += center[(i + 1) % n].distanceTo(center[i]);

    const headingPrev = Math.atan2(
      center[i].x - prev.x,
      center[i].z - prev.z,
    );
    const headingNext = Math.atan2(
      next.x - center[i].x,
      next.z - center[i].z,
    );
    let dHeading = headingNext - headingPrev;
    while (dHeading > Math.PI) dHeading -= Math.PI * 2;
    while (dHeading < -Math.PI) dHeading += Math.PI * 2;
    const segLength = center[i].distanceTo(prev) + next.distanceTo(center[i]);
    curvature[i] = segLength > 0 ? Math.abs(dHeading) / segLength : 0;
  }

  const rawCorner = curvature.map((k) => k > 1 / CORNER_RADIUS_THRESHOLD);
  const avgSpacing = distance / n;
  const dilateSamples = Math.max(1, Math.ceil(CORNER_DILATE_M / avgSpacing));
  const isCorner: boolean[] = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    if (!rawCorner[i]) continue;
    for (let d = -dilateSamples; d <= dilateSamples; d++) {
      isCorner[(i + d + n) % n] = true;
    }
  }

  return { center, right, distanceAlong, isCorner, length: distance };
}

function trackBounds(center: THREE.Vector3[]) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of center) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  return { minX, maxX, minZ, maxZ };
}

function edgePoint(samples: TrackSamples, i: number, offset: number, y: number): THREE.Vector3 {
  return samples.center[i].clone().addScaledVector(samples.right[i], offset).setY(y);
}

function pushTri(
  positions: number[],
  colors: number[],
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
  color: THREE.Color,
) {
  for (const p of [a, b, c]) {
    positions.push(p.x, p.y, p.z);
    colors.push(color.r, color.g, color.b);
  }
}

function pushQuad(
  positions: number[],
  colors: number[],
  leftA: THREE.Vector3,
  rightA: THREE.Vector3,
  leftB: THREE.Vector3,
  rightB: THREE.Vector3,
  color: THREE.Color,
) {
  // Winding chosen so the face normal points +Y (up) for a strip running
  // in the +right/+tangent plane - see edgePoint's right-vector convention.
  pushTri(positions, colors, leftA, leftB, rightA, color);
  pushTri(positions, colors, leftB, rightB, rightA, color);
}

function buildVertexColoredMesh(positions: number[], colors: number[]): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geometry, material);
}

function buildAsphaltMesh(samples: TrackSamples): THREE.Mesh {
  const positions: number[] = [];
  const colors: number[] = [];
  const color = new THREE.Color(ASPHALT_COLOR);
  const n = samples.center.length;
  const half = TRACK_WIDTH / 2;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    pushQuad(
      positions,
      colors,
      edgePoint(samples, i, -half, 0),
      edgePoint(samples, i, half, 0),
      edgePoint(samples, j, -half, 0),
      edgePoint(samples, j, half, 0),
      color,
    );
  }
  return buildVertexColoredMesh(positions, colors);
}

function kerbBlockIndex(samples: TrackSamples, i: number): number {
  return Math.floor(samples.distanceAlong[i] / KERB_BLOCK_LENGTH);
}

function kerbHeightForBlock(blockIndex: number): number {
  return blockIndex % 2 === 0 ? KERB_RAISED_HEIGHT : KERB_FLUSH_HEIGHT;
}

/**
 * Kerb strips on both the inside and outside edge of every corner, alternating
 * red/white and physically raised/flush together by arc length (real curbs
 * step up and down, not just change color). Each transition between blocks
 * gets a vertical riser quad so the step reads as a real 3D edge rather than
 * a crack between two flat tops drawn at different heights.
 */
function buildKerbMesh(samples: TrackSamples): THREE.Mesh {
  const positions: number[] = [];
  const colors: number[] = [];
  const red = new THREE.Color(KERB_RED);
  const white = new THREE.Color(KERB_WHITE);
  const n = samples.center.length;
  const half = TRACK_WIDTH / 2;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (!samples.isCorner[i] && !samples.isCorner[j]) continue;

    const blockI = kerbBlockIndex(samples, i);
    const isRaised = blockI % 2 === 0;
    const blockColor = isRaised ? red : white;
    const heightI = kerbHeightForBlock(blockI);

    // Outside-of-right edge (flat top at this block's height).
    pushQuad(
      positions,
      colors,
      edgePoint(samples, i, half, heightI),
      edgePoint(samples, i, half + KERB_WIDTH, heightI),
      edgePoint(samples, j, half, heightI),
      edgePoint(samples, j, half + KERB_WIDTH, heightI),
      blockColor,
    );
    // Outside-of-left edge.
    pushQuad(
      positions,
      colors,
      edgePoint(samples, i, -half - KERB_WIDTH, heightI),
      edgePoint(samples, i, -half, heightI),
      edgePoint(samples, j, -half - KERB_WIDTH, heightI),
      edgePoint(samples, j, -half, heightI),
      blockColor,
    );

    // Vertical riser where the next segment belongs to a different block -
    // without this the two flat tops (each drawn at its own height) would
    // leave a visible gap instead of a stepped curb.
    if (samples.isCorner[j]) {
      const blockJ = kerbBlockIndex(samples, j);
      if (blockJ !== blockI) {
        const heightJ = kerbHeightForBlock(blockJ);
        pushQuad(
          positions,
          colors,
          edgePoint(samples, j, half, heightI),
          edgePoint(samples, j, half + KERB_WIDTH, heightI),
          edgePoint(samples, j, half, heightJ),
          edgePoint(samples, j, half + KERB_WIDTH, heightJ),
          blockColor,
        );
        pushQuad(
          positions,
          colors,
          edgePoint(samples, j, -half - KERB_WIDTH, heightI),
          edgePoint(samples, j, -half, heightI),
          edgePoint(samples, j, -half - KERB_WIDTH, heightJ),
          edgePoint(samples, j, -half, heightJ),
          blockColor,
        );
      }
    }
  }
  return buildVertexColoredMesh(positions, colors);
}

function buildStartFinishMarker(samples: TrackSamples): THREE.Mesh {
  const half = TRACK_WIDTH / 2;
  const positions: number[] = [];
  const colors: number[] = [];
  const white = new THREE.Color(0xffffff);
  pushQuad(
    positions,
    colors,
    edgePoint(samples, 0, -half, KERB_FLUSH_HEIGHT),
    edgePoint(samples, 0, half, KERB_FLUSH_HEIGHT),
    edgePoint(samples, 1, -half, KERB_FLUSH_HEIGHT),
    edgePoint(samples, 1, half, KERB_FLUSH_HEIGHT),
    white,
  );
  return buildVertexColoredMesh(positions, colors);
}

/** Permanent white line along both track edges, wherever a kerb isn't already marking the boundary. */
function buildEdgeLineMesh(samples: TrackSamples): THREE.Mesh {
  const positions: number[] = [];
  const colors: number[] = [];
  const color = new THREE.Color(EDGE_LINE_COLOR);
  const n = samples.center.length;
  const half = TRACK_WIDTH / 2;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (samples.isCorner[i] || samples.isCorner[j]) continue;

    pushQuad(
      positions,
      colors,
      edgePoint(samples, i, half - EDGE_LINE_WIDTH, EDGE_LINE_HEIGHT),
      edgePoint(samples, i, half, EDGE_LINE_HEIGHT),
      edgePoint(samples, j, half - EDGE_LINE_WIDTH, EDGE_LINE_HEIGHT),
      edgePoint(samples, j, half, EDGE_LINE_HEIGHT),
      color,
    );
    pushQuad(
      positions,
      colors,
      edgePoint(samples, i, -half, EDGE_LINE_HEIGHT),
      edgePoint(samples, i, -half + EDGE_LINE_WIDTH, EDGE_LINE_HEIGHT),
      edgePoint(samples, j, -half, EDGE_LINE_HEIGHT),
      edgePoint(samples, j, -half + EDGE_LINE_WIDTH, EDGE_LINE_HEIGHT),
      color,
    );
  }
  return buildVertexColoredMesh(positions, colors);
}

/** Index of the first sample of every contiguous isCorner run - one "entry" per corner. */
function findCornerEntries(samples: TrackSamples): number[] {
  const n = samples.isCorner.length;
  const entries: number[] = [];
  for (let i = 0; i < n; i++) {
    const prev = samples.isCorner[(i - 1 + n) % n];
    if (samples.isCorner[i] && !prev) entries.push(i);
  }
  return entries;
}

/** Nearest sample index to a given arc-length distance along the (closed) track. */
function sampleIndexAtDistance(samples: TrackSamples, targetDistance: number): number {
  const n = samples.distanceAlong.length;
  const wrapped = ((targetDistance % samples.length) + samples.length) % samples.length;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (samples.distanceAlong[mid] < wrapped) lo = mid + 1;
    else hi = mid;
  }
  return lo % n;
}

/** 200m/100m braking-marker boards trackside before every corner entry. */
function buildDistanceMarkers(samples: TrackSamples): THREE.Group {
  const group = new THREE.Group();
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x333333, flatShading: true });
  const boardMat = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, flatShading: true });
  const stripeMat = new THREE.MeshStandardMaterial({ color: KERB_RED, flatShading: true });

  for (const entry of findCornerEntries(samples)) {
    for (const [distanceBefore, stripeCount] of MARKER_DISTANCES) {
      const idx = sampleIndexAtDistance(samples, samples.distanceAlong[entry] - distanceBefore);
      const tangent = new THREE.Vector3().crossVectors(samples.right[idx], UP);
      const yaw = Math.atan2(tangent.x, tangent.z);

      const markerGroup = new THREE.Group();
      markerGroup.position.copy(edgePoint(samples, idx, MARKER_OFFSET, 0));
      markerGroup.rotation.y = yaw;

      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(POLE_RADIUS, POLE_RADIUS, POLE_HEIGHT, 6),
        poleMat,
      );
      pole.position.y = POLE_HEIGHT / 2;
      markerGroup.add(pole);

      const board = new THREE.Mesh(
        new THREE.BoxGeometry(SIGN_WIDTH, SIGN_HEIGHT, SIGN_THICKNESS),
        boardMat,
      );
      const boardCenterY = POLE_HEIGHT - SIGN_HEIGHT / 2 - 0.1;
      board.position.y = boardCenterY;
      markerGroup.add(board);

      for (let s = 0; s < stripeCount; s++) {
        const stripe = new THREE.Mesh(
          new THREE.BoxGeometry(SIGN_WIDTH * 0.9, STRIPE_HEIGHT, SIGN_THICKNESS * 1.5),
          stripeMat,
        );
        stripe.position.set(
          0,
          boardCenterY + SIGN_HEIGHT / 2 - 0.18 - s * (STRIPE_HEIGHT + STRIPE_GAP),
          0,
        );
        markerGroup.add(stripe);
      }

      group.add(markerGroup);
    }
  }
  return group;
}

function buildGrassMesh(samples: TrackSamples): THREE.Mesh {
  const bounds = trackBounds(samples.center);
  const width = bounds.maxX - bounds.minX + GRASS_PADDING * 2;
  const depth = bounds.maxZ - bounds.minZ + GRASS_PADDING * 2;
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshStandardMaterial({ color: GRASS_COLOR, flatShading: true }),
  );
  plane.rotation.x = -Math.PI / 2;
  plane.position.set(
    (bounds.minX + bounds.maxX) / 2,
    -GRASS_COLLIDER_DROP,
    (bounds.minZ + bounds.maxZ) / 2,
  );
  return plane;
}

/** The core drivable track footprint used for collision: constant track width, flat. */
function buildTrackColliderDesc(samples: TrackSamples): RAPIER.ColliderDesc {
  const vertices: number[] = [];
  const indices: number[] = [];
  const n = samples.center.length;
  const half = TRACK_WIDTH / 2;

  for (let i = 0; i < n; i++) {
    const left = edgePoint(samples, i, -half, 0);
    const right = edgePoint(samples, i, half, 0);
    vertices.push(left.x, left.y, left.z, right.x, right.y, right.z);
  }

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const li = i * 2;
    const ri = i * 2 + 1;
    const lj = j * 2;
    const rj = j * 2 + 1;
    indices.push(li, lj, ri, lj, rj, ri);
  }

  return RAPIER.ColliderDesc.trimesh(
    new Float32Array(vertices),
    new Uint32Array(indices),
  ).setFriction(1);
}

/** Appends a quad (4 fresh, unshared vertices) to a growing collider vertex/index buffer - used for the kerb and wall colliders, which aren't one continuous loop so can't reuse the shared-vertex-per-sample trick the track/grass colliders use. */
function pushColliderQuad(
  vertices: number[],
  indices: number[],
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
  d: THREE.Vector3,
) {
  const base = vertices.length / 3;
  for (const p of [a, b, c, d]) vertices.push(p.x, p.y, p.z);
  indices.push(base, base + 2, base + 1, base + 2, base + 3, base + 1);
}

/**
 * The kerb footprint's own collision strip (both sides, corner zones only) -
 * a real physical step matching the visual (buildKerbMesh), not just a flat
 * flush strip. Sized (see KERB_RISE's comment) to genuinely unsettle the car
 * rather than just vibrate it, since a real, physically-felt penalty is
 * exactly what discourages using a curb as extra track width, on top of the
 * separate SURFACE_GRIP_KERB grip penalty.
 */
function buildKerbColliderDesc(samples: TrackSamples): RAPIER.ColliderDesc {
  const vertices: number[] = [];
  const indices: number[] = [];
  const n = samples.center.length;
  const half = TRACK_WIDTH / 2;

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (!samples.isCorner[i] && !samples.isCorner[j]) continue;

    const heightI = kerbHeightForBlock(kerbBlockIndex(samples, i));

    pushColliderQuad(
      vertices,
      indices,
      edgePoint(samples, i, half, heightI),
      edgePoint(samples, i, half + KERB_WIDTH, heightI),
      edgePoint(samples, j, half, heightI),
      edgePoint(samples, j, half + KERB_WIDTH, heightI),
    );
    pushColliderQuad(
      vertices,
      indices,
      edgePoint(samples, i, -half - KERB_WIDTH, heightI),
      edgePoint(samples, i, -half, heightI),
      edgePoint(samples, j, -half - KERB_WIDTH, heightI),
      edgePoint(samples, j, -half, heightI),
    );
  }

  return RAPIER.ColliderDesc.trimesh(new Float32Array(vertices), new Uint32Array(indices)).setFriction(0.9);
}

function wallColorAt(samples: TrackSamples, i: number): THREE.Color {
  if (!samples.isCorner[i]) return new THREE.Color(WALL_CONCRETE_COLOR);
  const blockIndex = Math.floor(samples.distanceAlong[i] / WALL_TIRE_BLOCK_LENGTH);
  return new THREE.Color(blockIndex % 2 === 0 ? WALL_TIRE_BLACK : WALL_TIRE_WHITE);
}

/** Perimeter wall on one side of the track (side=1 for the +right offset ring, -1 for the other) - concrete by default, tire-barrier colored at corners. */
function buildWallMesh(samples: TrackSamples, side: 1 | -1): THREE.Mesh {
  const positions: number[] = [];
  const colors: number[] = [];
  const n = samples.center.length;
  const centerOffset = side * (TRACK_WIDTH / 2 + WALL_OFFSET_FROM_EDGE);
  const innerOffset = centerOffset - side * (WALL_THICKNESS / 2);
  const outerOffset = centerOffset + side * (WALL_THICKNESS / 2);

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const color = wallColorAt(samples, i);

    // Inner face (facing the track).
    pushQuad(
      positions,
      colors,
      edgePoint(samples, i, innerOffset, 0),
      edgePoint(samples, i, innerOffset, WALL_HEIGHT),
      edgePoint(samples, j, innerOffset, 0),
      edgePoint(samples, j, innerOffset, WALL_HEIGHT),
      color,
    );
    // Outer face.
    pushQuad(
      positions,
      colors,
      edgePoint(samples, i, outerOffset, WALL_HEIGHT),
      edgePoint(samples, i, outerOffset, 0),
      edgePoint(samples, j, outerOffset, WALL_HEIGHT),
      edgePoint(samples, j, outerOffset, 0),
      color,
    );
    // Top cap.
    pushQuad(
      positions,
      colors,
      edgePoint(samples, i, innerOffset, WALL_HEIGHT),
      edgePoint(samples, i, outerOffset, WALL_HEIGHT),
      edgePoint(samples, j, innerOffset, WALL_HEIGHT),
      edgePoint(samples, j, outerOffset, WALL_HEIGHT),
      color,
    );
  }
  return buildVertexColoredMesh(positions, colors);
}

/** Collision for one perimeter wall - inner + outer faces only (the top cap isn't needed to stop a car driving into the side of it). */
function buildWallColliderDesc(samples: TrackSamples, side: 1 | -1): RAPIER.ColliderDesc {
  const vertices: number[] = [];
  const indices: number[] = [];
  const n = samples.center.length;
  const centerOffset = side * (TRACK_WIDTH / 2 + WALL_OFFSET_FROM_EDGE);
  const innerOffset = centerOffset - side * (WALL_THICKNESS / 2);
  const outerOffset = centerOffset + side * (WALL_THICKNESS / 2);

  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    pushColliderQuad(
      vertices,
      indices,
      edgePoint(samples, i, innerOffset, 0),
      edgePoint(samples, i, innerOffset, WALL_HEIGHT),
      edgePoint(samples, j, innerOffset, 0),
      edgePoint(samples, j, innerOffset, WALL_HEIGHT),
    );
    pushColliderQuad(
      vertices,
      indices,
      edgePoint(samples, i, outerOffset, 0),
      edgePoint(samples, i, outerOffset, WALL_HEIGHT),
      edgePoint(samples, j, outerOffset, 0),
      edgePoint(samples, j, outerOffset, WALL_HEIGHT),
    );
  }

  return RAPIER.ColliderDesc.trimesh(new Float32Array(vertices), new Uint32Array(indices)).setFriction(0.7);
}
