import * as THREE from 'three';

const DASH_COLOR = 0x1c1c1c;
const NEEDLE_COLOR = 0xd42020;
const DIGIT_COLOR = 0xff8800;
const TICK_COLOR = 0x999999;

const NEEDLE_START_ANGLE = 2.0; // radians, rpm = 0
const NEEDLE_END_ANGLE = -2.0; // radians, rpm = redline

/** Which segments (a..g, standard 7-segment layout) are lit for each digit. */
const DIGIT_SEGMENTS: Record<number, string[]> = {
  0: ['a', 'b', 'c', 'd', 'e', 'f'],
  1: ['b', 'c'],
  2: ['a', 'b', 'g', 'e', 'd'],
  3: ['a', 'b', 'g', 'c', 'd'],
  4: ['f', 'g', 'b', 'c'],
  5: ['a', 'f', 'g', 'c', 'd'],
  6: ['a', 'f', 'g', 'e', 'c', 'd'],
};

export interface Dashboard {
  group: THREE.Group;
  needlePivot: THREE.Group;
  setRpmFraction(fraction: number): void;
  setGear(gear: number): void;
}

function buildGearDigit(): { group: THREE.Group; segments: Record<string, THREE.Mesh> } {
  const w = 0.16;
  const h = 0.26;
  const t = 0.02;
  const st = 0.028;
  const material = new THREE.MeshStandardMaterial({ color: DIGIT_COLOR, flatShading: true });

  const specs: Record<string, [number, number, number, number, number]> = {
    a: [0, h / 2, w, st, t],
    d: [0, -h / 2, w, st, t],
    g: [0, 0, w, st, t],
    f: [-w / 2, h / 4, st, h / 2, t],
    b: [w / 2, h / 4, st, h / 2, t],
    e: [-w / 2, -h / 4, st, h / 2, t],
    c: [w / 2, -h / 4, st, h / 2, t],
  };

  const group = new THREE.Group();
  const segments: Record<string, THREE.Mesh> = {};
  for (const [key, [x, y, sx, sy, sz]] of Object.entries(specs)) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
    mesh.position.set(x, y, 0);
    group.add(mesh);
    segments[key] = mesh;
  }
  return { group, segments };
}

export function buildDashboard(): Dashboard {
  const group = new THREE.Group();

  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.32, 0.04),
    new THREE.MeshStandardMaterial({ color: DASH_COLOR, flatShading: true }),
  );
  group.add(panel);

  // Rev-counter face + tick marks, offset to the left half of the panel.
  const gaugeCenter = new THREE.Vector3(-0.13, 0, 0.03);
  const tickMat = new THREE.MeshStandardMaterial({ color: TICK_COLOR, flatShading: true });
  const tickGeometry = new THREE.BoxGeometry(0.012, 0.05, 0.01);
  const tickCount = 9;
  for (let i = 0; i < tickCount; i++) {
    const t = i / (tickCount - 1);
    const angle = THREE.MathUtils.lerp(NEEDLE_START_ANGLE, NEEDLE_END_ANGLE, t);
    const tick = new THREE.Mesh(tickGeometry, tickMat);
    tick.position.set(
      gaugeCenter.x + Math.sin(angle) * 0.12,
      gaugeCenter.y + Math.cos(angle) * 0.12,
      gaugeCenter.z,
    );
    tick.rotation.z = angle;
    group.add(tick);
  }

  const needlePivot = new THREE.Group();
  needlePivot.position.copy(gaugeCenter);
  needlePivot.rotation.z = NEEDLE_START_ANGLE;
  const needle = new THREE.Mesh(
    new THREE.BoxGeometry(0.014, 0.11, 0.015),
    new THREE.MeshStandardMaterial({ color: NEEDLE_COLOR, flatShading: true }),
  );
  needle.position.set(0, 0.055, 0);
  needlePivot.add(needle);
  group.add(needlePivot);

  // Gear indicator, offset to the right half of the panel.
  const digitAnchor = new THREE.Group();
  digitAnchor.position.set(0.15, 0, 0.03);
  group.add(digitAnchor);

  const digits: Record<number, ReturnType<typeof buildGearDigit>> = {};
  for (let d = 0; d <= 6; d++) {
    const digit = buildGearDigit();
    const lit = new Set(DIGIT_SEGMENTS[d]);
    for (const [key, mesh] of Object.entries(digit.segments)) {
      mesh.visible = lit.has(key);
    }
    digit.group.visible = false;
    digitAnchor.add(digit.group);
    digits[d] = digit;
  }
  digits[0].group.visible = true;

  let currentGear = 0;

  return {
    group,
    needlePivot,
    setRpmFraction(fraction: number) {
      const clamped = THREE.MathUtils.clamp(fraction, 0, 1);
      needlePivot.rotation.z = THREE.MathUtils.lerp(
        NEEDLE_START_ANGLE,
        NEEDLE_END_ANGLE,
        clamped,
      );
    },
    setGear(gear: number) {
      const clamped = THREE.MathUtils.clamp(Math.round(gear), 0, 6);
      if (clamped === currentGear) return;
      digits[currentGear].group.visible = false;
      digits[clamped].group.visible = true;
      currentGear = clamped;
    },
  };
}
