import * as THREE from 'three';
import { buildCarMesh, DEFAULT_CAR_DESIGN, type CarDesign } from './car-mesh';

// --- Design state ------------------------------------------------------
// A plain-data working copy of the design. Every control panel field reads
// and writes into this object via a path, then triggers a mesh rebuild.

function deepRoundClone<T>(value: T): T {
  if (typeof value === 'number') return Number(value.toFixed(4)) as unknown as T;
  if (Array.isArray(value)) return value.map(deepRoundClone) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = deepRoundClone(v);
    }
    return out as T;
  }
  return value;
}

const design: CarDesign = deepRoundClone(DEFAULT_CAR_DESIGN);

function getIn(obj: unknown, path: string[]): number {
  let cur: unknown = obj;
  for (const key of path) cur = (cur as Record<string, unknown>)[key];
  return cur as number;
}

function setIn(obj: unknown, path: string[], value: number): void {
  let cur = obj as Record<string, unknown>;
  for (let i = 0; i < path.length - 1; i++) cur = cur[path[i]] as Record<string, unknown>;
  cur[path[path.length - 1]] = value;
}

// --- Scene setup ---------------------------------------------------------

const SIDEBAR_WIDTH = 320;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1c1f24);
scene.add(new THREE.HemisphereLight(0xffffff, 0x33363c, 1.3));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(20, 30, 15);
scene.add(sun);

const grid = new THREE.GridHelper(12, 24, 0x666666, 0x3a3a3a);
scene.add(grid);
const axisMarker = new THREE.AxesHelper(1.5);
scene.add(axisMarker);

const viewWidth = () => window.innerWidth - SIDEBAR_WIDTH;
const viewHeight = () => window.innerHeight;

const FRUSTUM_HALF_HEIGHT = 2.3;
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
camera.zoom = 1;

function updateCameraFrustum() {
  const aspect = viewWidth() / viewHeight();
  const halfH = FRUSTUM_HALF_HEIGHT;
  const halfW = halfH * aspect;
  camera.left = -halfW;
  camera.right = halfW;
  camera.top = halfH;
  camera.bottom = -halfH;
  camera.updateProjectionMatrix();
}
updateCameraFrustum();

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(viewWidth(), viewHeight());
renderer.domElement.style.position = 'fixed';
renderer.domElement.style.left = '0';
renderer.domElement.style.top = '0';
document.body.appendChild(renderer.domElement);

window.addEventListener('resize', () => {
  updateCameraFrustum();
  renderer.setSize(viewWidth(), viewHeight());
});

// --- Locked view presets ---------------------------------------------------

const VIEW_TARGET = new THREE.Vector3(0, 0.45, 0.1);
const VIEW_DISTANCE = 15;

type ViewName = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

const VIEW_PRESETS: Record<ViewName, { position: THREE.Vector3; up: THREE.Vector3 }> = {
  front: { position: new THREE.Vector3(0, VIEW_TARGET.y, VIEW_DISTANCE), up: new THREE.Vector3(0, 1, 0) },
  back: { position: new THREE.Vector3(0, VIEW_TARGET.y, -VIEW_DISTANCE), up: new THREE.Vector3(0, 1, 0) },
  left: { position: new THREE.Vector3(-VIEW_DISTANCE, VIEW_TARGET.y, 0), up: new THREE.Vector3(0, 1, 0) },
  right: { position: new THREE.Vector3(VIEW_DISTANCE, VIEW_TARGET.y, 0), up: new THREE.Vector3(0, 1, 0) },
  top: { position: new THREE.Vector3(0, VIEW_DISTANCE, 0), up: new THREE.Vector3(0, 0, 1) },
  bottom: { position: new THREE.Vector3(0, -VIEW_DISTANCE, 0), up: new THREE.Vector3(0, 0, 1) },
};

let currentView: ViewName = 'left';

function setView(name: ViewName) {
  currentView = name;
  const preset = VIEW_PRESETS[name];
  camera.position.copy(preset.position).add(new THREE.Vector3(VIEW_TARGET.x, 0, VIEW_TARGET.z));
  camera.up.copy(preset.up);
  camera.lookAt(VIEW_TARGET);
  camera.zoom = 1;
  camera.updateProjectionMatrix();
  updateViewButtons();
}

renderer.domElement.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.001);
    camera.zoom = Math.min(6, Math.max(0.3, camera.zoom * factor));
    camera.updateProjectionMatrix();
  },
  { passive: false },
);

const VIEW_KEYS: Record<string, ViewName> = {
  '1': 'front',
  '2': 'back',
  '3': 'left',
  '4': 'right',
  '5': 'top',
  '6': 'bottom',
};

window.addEventListener('keydown', (e) => {
  const view = VIEW_KEYS[e.key];
  if (view) setView(view);
});

// --- Car mesh rebuild ------------------------------------------------------

let carGroup: THREE.Group | null = null;

function disposeGroup(group: THREE.Group) {
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const mat of materials) mat.dispose();
    }
  });
}

function rebuildCar() {
  if (carGroup) {
    scene.remove(carGroup);
    disposeGroup(carGroup);
  }
  carGroup = buildCarMesh(design).group;
  scene.add(carGroup);
}

function renderLoop() {
  renderer.render(scene, camera);
  requestAnimationFrame(renderLoop);
}
renderLoop();

// --- Control panel ----------------------------------------------------------

interface NumberFieldSpec {
  kind: 'number';
  path: string[];
  label: string;
  min: number;
  max: number;
  step: number;
}
interface ColorFieldSpec {
  kind: 'color';
  path: string[];
  label: string;
}
type FieldSpec = NumberFieldSpec | ColorFieldSpec;

function num(path: string, label: string, min: number, max: number, step: number): NumberFieldSpec {
  return { kind: 'number', path: path.split('.'), label, min, max, step };
}
function color(path: string, label: string): ColorFieldSpec {
  return { kind: 'color', path: path.split('.'), label };
}

function boxFields(
  prefix: string,
  ranges: {
    sizeX: [number, number]; sizeY: [number, number]; sizeZ: [number, number];
    posX: [number, number]; posY: [number, number]; posZ: [number, number];
  },
): FieldSpec[] {
  return [
    num(`${prefix}.size.x`, 'Size X (width)', ...ranges.sizeX, 0.01),
    num(`${prefix}.size.y`, 'Size Y (height)', ...ranges.sizeY, 0.01),
    num(`${prefix}.size.z`, 'Size Z (length)', ...ranges.sizeZ, 0.01),
    num(`${prefix}.position.x`, 'Position X', ...ranges.posX, 0.01),
    num(`${prefix}.position.y`, 'Position Y', ...ranges.posY, 0.01),
    num(`${prefix}.position.z`, 'Position Z', ...ranges.posZ, 0.01),
  ];
}

const SECTIONS: { title: string; fields: FieldSpec[] }[] = [
  {
    title: 'Colors',
    fields: [
      color('colors.primary', 'Primary'),
      color('colors.secondary', 'Secondary'),
      color('colors.accent', 'Accent (wings)'),
      color('colors.tire', 'Tire'),
      color('colors.rim', 'Rim'),
    ],
  },
  {
    title: 'Front wheels',
    fields: [
      num('wheels.front.radius', 'Radius', 0.15, 0.5, 0.005),
      num('wheels.front.width', 'Width', 0.1, 0.45, 0.005),
    ],
  },
  {
    title: 'Rear wheels',
    fields: [
      num('wheels.rear.radius', 'Radius', 0.15, 0.5, 0.005),
      num('wheels.rear.width', 'Width', 0.1, 0.45, 0.005),
    ],
  },
  {
    title: 'Layout',
    fields: [
      num('layout.frontTrack', 'Front track', 1.2, 2.2, 0.01),
      num('layout.rearTrack', 'Rear track', 1.1, 2.1, 0.01),
      num('layout.wheelbase', 'Wheelbase', 2.2, 3.6, 0.01),
      num('layout.frontAxleRatio', 'Front axle ratio', 0.3, 0.7, 0.005),
      num('layout.mountHeight', 'Wheel mount height', -0.1, 0.3, 0.005),
    ],
  },
  {
    title: 'Tub',
    fields: boxFields('tub', {
      sizeX: [0.6, 2.2], sizeY: [0.2, 1.0], sizeZ: [1.5, 4.0],
      posX: [-1, 1], posY: [0, 1.2], posZ: [-2, 2],
    }),
  },
  {
    title: 'Nose',
    fields: [
      num('nose.tip.x', 'Tip X', -0.3, 0.3, 0.01),
      num('nose.tip.y', 'Tip Y (height)', -0.1, 0.6, 0.01),
      num('nose.tip.z', 'Tip Z (front point)', 1.3, 3.2, 0.01),
      num('nose.baseZ', 'Base Z (meets tub)', 0.3, 2.0, 0.01),
      num('nose.baseWidth', 'Base width', 0.2, 1.4, 0.01),
      num('nose.baseTop', 'Base top Y', 0.1, 1.0, 0.01),
      num('nose.baseBottom', 'Base bottom Y', -0.1, 0.6, 0.01),
    ],
  },
  {
    title: 'Airbox',
    fields: boxFields('airbox', {
      sizeX: [0.1, 0.9], sizeY: [0.1, 0.8], sizeZ: [0.1, 1.2],
      posX: [-0.5, 0.5], posY: [0.3, 1.3], posZ: [-2, 0.5],
    }),
  },
  {
    title: 'Front wing',
    fields: boxFields('frontWing', {
      sizeX: [0.8, 2.4], sizeY: [0.02, 0.2], sizeZ: [0.1, 0.8],
      posX: [-1, 1], posY: [0, 0.5], posZ: [1, 3],
    }),
  },
  {
    title: 'Rear wing',
    fields: [
      ...boxFields('rearWing', {
        sizeX: [0.8, 2.2], sizeY: [0.02, 0.2], sizeZ: [0.1, 0.7],
        posX: [-1, 1], posY: [0.4, 1.6], posZ: [-3, -0.5],
      }),
      num('rearWing.strutSize.x', 'Strut thickness X', 0.02, 0.15, 0.005),
      num('rearWing.strutSize.y', 'Strut height', 0.1, 0.8, 0.01),
      num('rearWing.strutSize.z', 'Strut thickness Z', 0.02, 0.15, 0.005),
      num('rearWing.strutOffsetX', 'Strut offset X', 0.1, 1, 0.01),
      num('rearWing.strutPositionY', 'Strut position Y', 0.3, 1.4, 0.01),
    ],
  },
];

const sidebar = document.createElement('div');
sidebar.style.position = 'fixed';
sidebar.style.top = '0';
sidebar.style.right = '0';
sidebar.style.width = `${SIDEBAR_WIDTH}px`;
sidebar.style.height = '100vh';
sidebar.style.overflowY = 'auto';
sidebar.style.background = 'rgba(20, 22, 26, 0.92)';
sidebar.style.color = '#e0e0e0';
sidebar.style.fontFamily = 'monospace';
sidebar.style.fontSize = '11px';
sidebar.style.padding = '10px';
sidebar.style.boxSizing = 'border-box';
sidebar.style.zIndex = '10';
document.body.appendChild(sidebar);

const heading = document.createElement('div');
heading.textContent = 'GP2 Garage';
heading.style.fontSize = '15px';
heading.style.fontWeight = 'bold';
heading.style.marginBottom = '4px';
sidebar.appendChild(heading);

const backLink = document.createElement('a');
backLink.href = './index.html';
backLink.textContent = '← back to track';
backLink.style.color = '#8fd0ff';
backLink.style.display = 'block';
backLink.style.marginBottom = '10px';
sidebar.appendChild(backLink);

const viewRow = document.createElement('div');
viewRow.style.display = 'grid';
viewRow.style.gridTemplateColumns = 'repeat(3, 1fr)';
viewRow.style.gap = '4px';
viewRow.style.marginBottom = '10px';
sidebar.appendChild(viewRow);

const viewButtons: Partial<Record<ViewName, HTMLButtonElement>> = {};
function updateViewButtons() {
  for (const [name, btn] of Object.entries(viewButtons)) {
    if (!btn) continue;
    btn.style.background = name === currentView ? '#3a6bd6' : '#33363c';
  }
}
(Object.entries(VIEW_KEYS) as [string, ViewName][]).forEach(([key, name]) => {
  const btn = document.createElement('button');
  btn.textContent = `${name} (${key})`;
  btn.style.cursor = 'pointer';
  btn.style.color = '#e0e0e0';
  btn.style.border = '1px solid #555';
  btn.style.borderRadius = '3px';
  btn.style.padding = '4px 0';
  btn.style.fontFamily = 'monospace';
  btn.style.fontSize = '10px';
  btn.addEventListener('click', () => setView(name));
  viewButtons[name] = btn;
  viewRow.appendChild(btn);
});
updateViewButtons();

const hint = document.createElement('div');
hint.textContent = 'Scroll to zoom. Number keys 1-6 also switch views.';
hint.style.opacity = '0.6';
hint.style.marginBottom = '12px';
sidebar.appendChild(hint);

function renderField(spec: FieldSpec, container: HTMLElement) {
  const row = document.createElement('div');
  row.style.marginBottom = '6px';

  const label = document.createElement('label');
  label.style.display = 'flex';
  label.style.justifyContent = 'space-between';
  label.style.alignItems = 'center';
  label.style.gap = '6px';

  const labelText = document.createElement('span');
  labelText.textContent = spec.label;
  labelText.style.flex = '1';
  labelText.style.whiteSpace = 'nowrap';
  labelText.style.overflow = 'hidden';
  labelText.style.textOverflow = 'ellipsis';
  label.appendChild(labelText);

  if (spec.kind === 'color') {
    const input = document.createElement('input');
    input.type = 'color';
    const value = getIn(design, spec.path);
    input.value = '#' + value.toString(16).padStart(6, '0');
    input.style.width = '48px';
    input.addEventListener('input', () => {
      setIn(design, spec.path, parseInt(input.value.slice(1), 16));
      rebuildCar();
    });
    label.appendChild(input);
  } else {
    const valueDisplay = document.createElement('span');
    valueDisplay.style.width = '52px';
    valueDisplay.style.textAlign = 'right';
    valueDisplay.style.opacity = '0.8';
    const value = getIn(design, spec.path);
    valueDisplay.textContent = value.toFixed(3);

    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    input.value = String(value);
    input.style.flex = '2';
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      setIn(design, spec.path, v);
      valueDisplay.textContent = v.toFixed(3);
      rebuildCar();
    });

    label.appendChild(input);
    label.appendChild(valueDisplay);
  }

  row.appendChild(label);
  container.appendChild(row);
}

for (const section of SECTIONS) {
  const details = document.createElement('details');
  details.open = true;
  details.style.marginBottom = '6px';
  const summary = document.createElement('summary');
  summary.textContent = section.title;
  summary.style.cursor = 'pointer';
  summary.style.fontWeight = 'bold';
  summary.style.marginBottom = '4px';
  details.appendChild(summary);
  for (const field of section.fields) renderField(field, details);
  sidebar.appendChild(details);
}

// Now that the control panel (including view buttons) exists, build the
// initial car and select the default view.
rebuildCar();
setView('left');

// --- Export --------------------------------------------------------------

function serializeDesign(current: CarDesign): string {
  const rounded = deepRoundClone(current);
  let json = JSON.stringify(rounded, null, 2);
  for (const [key, decimal] of Object.entries(rounded.colors)) {
    const hex = '0x' + (decimal as number).toString(16).padStart(6, '0');
    json = json.replace(new RegExp(`"${key}": ${decimal}(?!\\d)`), `"${key}": ${hex}`);
  }
  return `export const DEFAULT_CAR_DESIGN: CarDesign = ${json};\n`;
}

const exportButton = document.createElement('button');
exportButton.textContent = 'Export design';
exportButton.style.width = '100%';
exportButton.style.marginTop = '10px';
exportButton.style.padding = '8px 0';
exportButton.style.cursor = 'pointer';
exportButton.style.color = '#e0e0e0';
exportButton.style.background = '#3a6bd6';
exportButton.style.border = 'none';
exportButton.style.borderRadius = '4px';
exportButton.style.fontFamily = 'monospace';
sidebar.appendChild(exportButton);

const exportArea = document.createElement('textarea');
exportArea.readOnly = true;
exportArea.style.width = '100%';
exportArea.style.height = '160px';
exportArea.style.marginTop = '6px';
exportArea.style.background = '#0d0e10';
exportArea.style.color = '#9fd89f';
exportArea.style.fontFamily = 'monospace';
exportArea.style.fontSize = '10px';
exportArea.style.border = '1px solid #444';
exportArea.style.display = 'none';
sidebar.appendChild(exportArea);

exportButton.addEventListener('click', () => {
  const text = serializeDesign(design);
  exportArea.value = text;
  exportArea.style.display = 'block';
  exportArea.focus();
  exportArea.select();
  navigator.clipboard?.writeText(text).then(
    () => {
      exportButton.textContent = 'Copied to clipboard!';
      setTimeout(() => (exportButton.textContent = 'Export design'), 1500);
    },
    () => {
      // Clipboard permission denied - the textarea above is already
      // selected, so a manual Ctrl/Cmd+C still works.
    },
  );
});
