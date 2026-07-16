import * as THREE from 'three';

/** A 3-component field (size or position) editable independently per axis. */
export interface Vec3Params {
  x: number;
  y: number;
  z: number;
}

/** A single box-shaped body part: dimensions plus chassis-space position. */
export interface BoxPart {
  size: Vec3Params;
  position: Vec3Params;
}

/**
 * A pointed nose cone: a single apex tapering back to a rectangular base
 * where it meets the tub. Gives a thin, pointed front that widens (and can
 * rise) toward the rear, instead of a uniform box.
 */
export interface NosePart {
  /** The pointed front tip. */
  tip: Vec3Params;
  /** Z position of the rectangular base, where the nose meets the tub. */
  baseZ: number;
  /** Full width of the base rectangle. */
  baseWidth: number;
  /** Top and bottom Y of the base rectangle. */
  baseTop: number;
  baseBottom: number;
}

/**
 * Full set of parameters `buildCarMesh` needs to construct the car. This is
 * the single source of truth for car shape/color/layout - the garage
 * (garage.ts) edits a copy of this shape live, and `DEFAULT_CAR_DESIGN` below
 * is what the main game renders.
 */
export interface CarDesign {
  colors: {
    primary: number;
    secondary: number;
    accent: number;
    tire: number;
    rim: number;
  };
  wheels: {
    front: { radius: number; width: number };
    rear: { radius: number; width: number };
  };
  /** Track widths, wheelbase, and derived axle/mount placement. */
  layout: {
    frontTrack: number;
    rearTrack: number;
    wheelbase: number;
    /** Fraction of the wheelbase, forward of the rear axle, where the front axle sits. */
    frontAxleRatio: number;
    mountHeight: number;
  };
  tub: BoxPart;
  nose: NosePart;
  airbox: BoxPart;
  frontWing: BoxPart;
  rearWing: BoxPart & {
    strutSize: Vec3Params;
    strutOffsetX: number;
    strutPositionY: number;
  };
}

function vec3(x: number, y: number, z: number): Vec3Params {
  return { x, y, z };
}

// 1990 F1-derived proportions, tuned in the garage (garage.html).
export const DEFAULT_CAR_DESIGN: CarDesign = {
  colors: {
    primary: 0x0a2a6b,
    secondary: 0xf2f2f2,
    accent: 0xc41e1e,
    tire: 0x1a1a1a,
    rim: 0xd4d4d4,
  },
  // Real 1990 F1 wheel sizes: front 635mm diameter x 254mm width, rear
  // 660mm diameter x 381mm width.
  wheels: {
    front: { radius: 0.3175, width: 0.254 },
    rear: { radius: 0.33, width: 0.381 },
  },
  layout: {
    frontTrack: 1.98,
    rearTrack: 1.9,
    wheelbase: 2.94,
    frontAxleRatio: 0.53,
    mountHeight: 0.05,
  },
  tub: {
    size: vec3(1.3, 0.44, 2.51),
    position: vec3(0, 0.1, -0.1),
  },
  nose: {
    tip: vec3(0, -0.1, 2.76),
    baseZ: 1.05,
    baseWidth: 0.65,
    baseTop: 0.43,
    baseBottom: -0.1,
  },
  airbox: {
    size: vec3(0.4, 0.55, 1.2),
    position: vec3(0, 0.48, -0.38),
  },
  frontWing: {
    size: vec3(1.9, 0.07, 0.46),
    position: vec3(0, 0, 2.3),
  },
  rearWing: {
    size: vec3(1.55, 0.06, 0.35),
    position: vec3(0, 0.81, -1.66),
    strutSize: vec3(0.03, 0.46, 0.15),
    strutOffsetX: 0.1,
    strutPositionY: 0.44,
  },
};

/** Chassis-space wheel mount offsets (x = left/right, y = up/down, z = forward/back). */
export function computeWheelMounts(design: CarDesign) {
  const frontAxleZ = design.layout.wheelbase * design.layout.frontAxleRatio;
  const rearAxleZ = frontAxleZ - design.layout.wheelbase;
  const { frontTrack, rearTrack, mountHeight } = design.layout;
  return {
    frontLeft: new THREE.Vector3(-frontTrack / 2, mountHeight, frontAxleZ),
    frontRight: new THREE.Vector3(frontTrack / 2, mountHeight, frontAxleZ),
    rearLeft: new THREE.Vector3(-rearTrack / 2, mountHeight, rearAxleZ),
    rearRight: new THREE.Vector3(rearTrack / 2, mountHeight, rearAxleZ),
  };
}

export const WHEEL_RADII = {
  front: DEFAULT_CAR_DESIGN.wheels.front.radius,
  rear: DEFAULT_CAR_DESIGN.wheels.rear.radius,
};
export const WHEEL_MOUNTS = computeWheelMounts(DEFAULT_CAR_DESIGN);

export interface CarMesh {
  /** Root group; place at the chassis rigid-body's transform each frame. */
  group: THREE.Group;
  /** Steer pivots (rotate around Y for front wheels) containing the rolling wheel mesh. */
  wheels: {
    frontLeft: THREE.Group;
    frontRight: THREE.Group;
    rearLeft: THREE.Group;
    rearRight: THREE.Group;
  };
  /** The rolling meshes themselves (rotate around local X for rolling animation). */
  wheelMeshes: {
    frontLeft: THREE.Mesh;
    frontRight: THREE.Mesh;
    rearLeft: THREE.Mesh;
    rearRight: THREE.Mesh;
  };
}

function buildWheel(radius: number, width: number, colors: CarDesign['colors']): THREE.Mesh {
  const geometry = new THREE.CylinderGeometry(radius, radius, width, 8);
  geometry.rotateZ(Math.PI / 2);
  const material = new THREE.MeshStandardMaterial({
    color: colors.tire,
    flatShading: true,
  });
  const mesh = new THREE.Mesh(geometry, material);

  const rimGeometry = new THREE.CylinderGeometry(radius * 0.55, radius * 0.55, width * 1.02, 6);
  rimGeometry.rotateZ(Math.PI / 2);
  const rim = new THREE.Mesh(
    rimGeometry,
    new THREE.MeshStandardMaterial({ color: colors.rim, flatShading: true }),
  );
  mesh.add(rim);

  return mesh;
}

function buildWheelAssembly(
  mount: THREE.Vector3,
  radius: number,
  width: number,
  colors: CarDesign['colors'],
): {
  pivot: THREE.Group;
  mesh: THREE.Mesh;
} {
  const pivot = new THREE.Group();
  pivot.position.copy(mount);
  const mesh = buildWheel(radius, width, colors);
  pivot.add(mesh);
  return { pivot, mesh };
}

function boxMesh(part: BoxPart, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(part.size.x, part.size.y, part.size.z),
    material,
  );
  mesh.position.set(part.position.x, part.position.y, part.position.z);
  return mesh;
}

/**
 * A 5-vertex pyramid: a single apex (the nose tip) tapering back to a
 * rectangular base (where the nose meets the tub). Winding is fixed for the
 * normal case of tip.z > baseZ (apex in front of the base).
 */
function buildNoseMesh(nose: NosePart, material: THREE.Material): THREE.Mesh {
  const halfWidth = nose.baseWidth / 2;
  // Vertex order: apex, base top-left, base top-right, base bottom-right, base bottom-left.
  const positions = new Float32Array([
    nose.tip.x, nose.tip.y, nose.tip.z,
    -halfWidth, nose.baseTop, nose.baseZ,
    halfWidth, nose.baseTop, nose.baseZ,
    halfWidth, nose.baseBottom, nose.baseZ,
    -halfWidth, nose.baseBottom, nose.baseZ,
  ]);
  // prettier-ignore
  const indices = [
    0, 2, 1, // top face
    0, 3, 2, // right face
    0, 4, 3, // bottom face
    0, 1, 4, // left face
    1, 3, 4, // base cap
    1, 2, 3, // base cap
  ];

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return new THREE.Mesh(geometry, material);
}

export function buildCarMesh(design: CarDesign = DEFAULT_CAR_DESIGN): CarMesh {
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({
    color: design.colors.primary,
    flatShading: true,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: design.colors.secondary,
    flatShading: true,
  });
  const wingMat = new THREE.MeshStandardMaterial({
    color: design.colors.accent,
    flatShading: true,
  });

  // Main tub.
  group.add(boxMesh(design.tub, bodyMat));

  // Nose cone: tapers from a point at the front to a rectangle at the tub.
  group.add(buildNoseMesh(design.nose, accentMat));

  // Airbox behind the cockpit.
  group.add(boxMesh(design.airbox, bodyMat));

  // Front wing.
  group.add(boxMesh(design.frontWing, wingMat));

  // Rear wing plane + struts.
  group.add(boxMesh(design.rearWing, wingMat));
  const strutGeometry = new THREE.BoxGeometry(
    design.rearWing.strutSize.x,
    design.rearWing.strutSize.y,
    design.rearWing.strutSize.z,
  );
  const strutLeft = new THREE.Mesh(strutGeometry, bodyMat);
  strutLeft.position.set(
    -design.rearWing.strutOffsetX,
    design.rearWing.strutPositionY,
    design.rearWing.position.z,
  );
  group.add(strutLeft);
  const strutRight = new THREE.Mesh(strutGeometry, bodyMat);
  strutRight.position.set(
    design.rearWing.strutOffsetX,
    design.rearWing.strutPositionY,
    design.rearWing.position.z,
  );
  group.add(strutRight);

  const mounts = computeWheelMounts(design);
  const { front, rear } = design.wheels;
  const frontLeft = buildWheelAssembly(mounts.frontLeft, front.radius, front.width, design.colors);
  const frontRight = buildWheelAssembly(mounts.frontRight, front.radius, front.width, design.colors);
  const rearLeft = buildWheelAssembly(mounts.rearLeft, rear.radius, rear.width, design.colors);
  const rearRight = buildWheelAssembly(mounts.rearRight, rear.radius, rear.width, design.colors);
  group.add(frontLeft.pivot, frontRight.pivot, rearLeft.pivot, rearRight.pivot);

  return {
    group,
    wheels: {
      frontLeft: frontLeft.pivot,
      frontRight: frontRight.pivot,
      rearLeft: rearLeft.pivot,
      rearRight: rearRight.pivot,
    },
    wheelMeshes: {
      frontLeft: frontLeft.mesh,
      frontRight: frontRight.mesh,
      rearLeft: rearLeft.mesh,
      rearRight: rearRight.mesh,
    },
  };
}
