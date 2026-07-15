import * as THREE from 'three';

const LIVERY_PRIMARY = 0x0a2a6b;
const LIVERY_SECONDARY = 0xf2f2f2;
const LIVERY_ACCENT = 0xc41e1e;
const TIRE_COLOR = 0x1a1a1a;
const RIM_COLOR = 0xd4d4d4;

export const WHEEL_RADIUS = 0.33;
const WHEEL_WIDTH = 0.28;

// 1990 McLaren MP4/5-derived dimensions: front track 1820mm, rear track
// 1670mm, wheelbase 2940mm.
const FRONT_TRACK = 1.82;
const REAR_TRACK = 1.67;
const WHEELBASE = 2.94;
const FRONT_AXLE_Z = WHEELBASE * 0.53;
const REAR_AXLE_Z = FRONT_AXLE_Z - WHEELBASE;

/** Chassis-space wheel mount offsets (x = left/right, y = up/down, z = forward/back). */
export const WHEEL_MOUNTS = {
  frontLeft: new THREE.Vector3(-FRONT_TRACK / 2, 0.05, FRONT_AXLE_Z),
  frontRight: new THREE.Vector3(FRONT_TRACK / 2, 0.05, FRONT_AXLE_Z),
  rearLeft: new THREE.Vector3(-REAR_TRACK / 2, 0.05, REAR_AXLE_Z),
  rearRight: new THREE.Vector3(REAR_TRACK / 2, 0.05, REAR_AXLE_Z),
};

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

function buildWheel(): THREE.Mesh {
  const geometry = new THREE.CylinderGeometry(
    WHEEL_RADIUS,
    WHEEL_RADIUS,
    WHEEL_WIDTH,
    8,
  );
  geometry.rotateZ(Math.PI / 2);
  const material = new THREE.MeshStandardMaterial({
    color: TIRE_COLOR,
    flatShading: true,
  });
  const mesh = new THREE.Mesh(geometry, material);

  const rimGeometry = new THREE.CylinderGeometry(
    WHEEL_RADIUS * 0.55,
    WHEEL_RADIUS * 0.55,
    WHEEL_WIDTH * 1.02,
    6,
  );
  rimGeometry.rotateZ(Math.PI / 2);
  const rim = new THREE.Mesh(
    rimGeometry,
    new THREE.MeshStandardMaterial({ color: RIM_COLOR, flatShading: true }),
  );
  mesh.add(rim);

  return mesh;
}

function buildWheelAssembly(mount: THREE.Vector3): {
  pivot: THREE.Group;
  mesh: THREE.Mesh;
} {
  const pivot = new THREE.Group();
  pivot.position.copy(mount);
  const mesh = buildWheel();
  pivot.add(mesh);
  return { pivot, mesh };
}

export function buildCarMesh(): CarMesh {
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({
    color: LIVERY_PRIMARY,
    flatShading: true,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: LIVERY_SECONDARY,
    flatShading: true,
  });
  const wingMat = new THREE.MeshStandardMaterial({
    color: LIVERY_ACCENT,
    flatShading: true,
  });

  // Main tub, tapering slightly toward the nose via non-uniform scale.
  const tub = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.45, 2.6), bodyMat);
  tub.position.set(0, 0.35, -0.1);
  group.add(tub);

  // Nose cone.
  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.28, 1.3), accentMat);
  nose.position.set(0, 0.25, 1.75);
  group.add(nose);

  // Airbox behind the cockpit.
  const airbox = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.35, 0.5), bodyMat);
  airbox.position.set(0, 0.75, -0.8);
  group.add(airbox);

  // Front wing.
  const frontWing = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.06, 0.4), wingMat);
  frontWing.position.set(0, 0.18, 2.3);
  group.add(frontWing);

  // Rear wing plane + struts.
  const rearWing = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.06, 0.35), wingMat);
  rearWing.position.set(0, 0.95, -1.85);
  group.add(rearWing);
  const strutGeometry = new THREE.BoxGeometry(0.06, 0.4, 0.06);
  const strutLeft = new THREE.Mesh(strutGeometry, bodyMat);
  strutLeft.position.set(-0.5, 0.72, -1.85);
  group.add(strutLeft);
  const strutRight = new THREE.Mesh(strutGeometry, bodyMat);
  strutRight.position.set(0.5, 0.72, -1.85);
  group.add(strutRight);

  const frontLeft = buildWheelAssembly(WHEEL_MOUNTS.frontLeft);
  const frontRight = buildWheelAssembly(WHEEL_MOUNTS.frontRight);
  const rearLeft = buildWheelAssembly(WHEEL_MOUNTS.rearLeft);
  const rearRight = buildWheelAssembly(WHEEL_MOUNTS.rearRight);
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
