import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { buildCarMesh } from './car-mesh';
import { buildTrack } from './track';
import { buildDashboard } from './dashboard';
import { InputState } from './input';
import { VehicleModel, REDLINE_RPM, type WheelName } from './vehicle';
import { FreeCamera } from './free-camera';
import { createDebugHud } from './debug-hud';
import { LapTimer, formatLapTime } from './lap-timer';

const PHYSICS_DT = 1 / 60;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fd0ff);
scene.fog = new THREE.Fog(0x8fd0ff, 600, 2800);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445544, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(50, 80, 30);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(
  70,
  window.innerWidth / window.innerHeight,
  0.05,
  3000,
);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const carMesh = buildCarMesh();
scene.add(carMesh.group);

// Cockpit camera: fixed in the car's local space, looking toward the nose (+z).
// Lowered 20cm from the original 0.95 - that height read as sitting "on" the
// car rather than "in" it.
const COCKPIT_EYE_POSITION = new THREE.Vector3(0, 0.75, -0.2);
const COCKPIT_EYE_ROTATION = new THREE.Euler(0, Math.PI, 0);
camera.position.copy(COCKPIT_EYE_POSITION);
camera.rotation.copy(COCKPIT_EYE_ROTATION);
carMesh.group.add(camera);

const freeCamera = new FreeCamera(camera, renderer.domElement);
let cameraMode: 'cockpit' | 'free' = 'cockpit';

function setCameraMode(mode: 'cockpit' | 'free') {
  if (mode === cameraMode) return;
  cameraMode = mode;
  if (mode === 'free') {
    scene.attach(camera); // re-parent to world space, preserving world transform
    freeCamera.syncFromCamera();
    freeCamera.enabled = true;
  } else {
    freeCamera.enabled = false;
    if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
    carMesh.group.add(camera);
    camera.position.copy(COCKPIT_EYE_POSITION);
    camera.rotation.copy(COCKPIT_EYE_ROTATION);
  }
}

window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() === 'c') {
    setCameraMode(cameraMode === 'cockpit' ? 'free' : 'cockpit');
  }
});

// Dashboard: mounted in front of the driver, facing back toward the camera.
// Lowered 20cm along with the eye position above, so it stays in the same
// place relative to the driver's view.
const dashboard = buildDashboard();
dashboard.group.position.set(0, 0.38, 0.75);
dashboard.group.rotation.set(0, Math.PI, 0);
dashboard.group.scale.setScalar(0.7);
carMesh.group.add(dashboard.group);

await RAPIER.init();
const world = new RAPIER.World({ x: 0.0, y: -9.81, z: 0.0 });
const track = buildTrack(world, scene);

const vehicle = new VehicleModel(world, track.startPosition, track.startYaw, track.getSurfaceGrip);

const lapTimer = new LapTimer(track.startPosition, track.startYaw, track.startLineHalfWidth);

const input = new InputState();

const wheelAngles: Record<WheelName, number> = {
  frontLeft: 0,
  frontRight: 0,
  rearLeft: 0,
  rearRight: 0,
};

let physicsAccumulator = 0;
let lastFrameTime = performance.now();

function physicsStep() {
  input.update(PHYSICS_DT);
  vehicle.applyShifts(input.takeShiftTriggers());
  // vehicle.step() sub-steps the physics world internally (see vehicle.ts) -
  // it owns calling world.step(), not this function.
  vehicle.step(PHYSICS_DT, input);

  const chassisPos = vehicle.chassis.translation();
  lapTimer.update(PHYSICS_DT, new THREE.Vector3(chassisPos.x, chassisPos.y, chassisPos.z));
}

function syncVisuals() {
  const telemetry = vehicle.getTelemetry();
  const chassisPos = vehicle.chassis.translation();
  const chassisRot = vehicle.chassis.rotation();
  carMesh.group.position.set(chassisPos.x, chassisPos.y, chassisPos.z);
  carMesh.group.quaternion.set(chassisRot.x, chassisRot.y, chassisRot.z, chassisRot.w);

  for (const name of Object.keys(carMesh.wheels) as WheelName[]) {
    const wheelState = telemetry.wheels[name];
    carMesh.wheels[name].rotation.y = wheelState.steerAngle;
    wheelAngles[name] += wheelState.angularSpeed * PHYSICS_DT;
    carMesh.wheelMeshes[name].rotation.x = wheelAngles[name];
  }

  // Absolute 0-redline scale (not idle-relative) so idle visibly sits above
  // the empty peg instead of looking like the engine is off.
  const rpmFraction = telemetry.engineRpm / REDLINE_RPM;
  dashboard.setRpmFraction(rpmFraction);
  dashboard.setGear(telemetry.gear);

  return telemetry;
}

const debugHud = createDebugHud();
let smoothedFps = 60;

function renderLoop() {
  const now = performance.now();
  const frameDt = Math.min((now - lastFrameTime) / 1000, 0.1);
  lastFrameTime = now;

  physicsAccumulator += frameDt;
  while (physicsAccumulator >= PHYSICS_DT) {
    physicsStep();
    physicsAccumulator -= PHYSICS_DT;
  }

  const telemetry = syncVisuals();
  freeCamera.update(frameDt);
  renderer.render(scene, camera);

  if (frameDt > 0) {
    const instantFps = 1 / frameDt;
    smoothedFps += (instantFps - smoothedFps) * 0.1;
  }
  const wheelGrips = Object.values(telemetry.wheels).map((w) => w.surfaceGrip);
  const avgSurfaceGrip = wheelGrips.reduce((a, b) => a + b, 0) / wheelGrips.length;
  const lapState = lapTimer.getState();
  debugHud.update([
    `FPS: ${smoothedFps.toFixed(0)}`,
    `Speed: ${telemetry.speedKmh.toFixed(1)} km/h (${(telemetry.speedKmh * 0.6214).toFixed(1)} mph)`,
    `RPM: ${telemetry.engineRpm.toFixed(0)} / ${REDLINE_RPM}`,
    `Gear: ${telemetry.gear === 0 ? 'N' : telemetry.gear}`,
    `Throttle: ${telemetry.throttle.toFixed(2)}  Brake: ${telemetry.brake.toFixed(2)}  Clutch: ${telemetry.clutch.toFixed(2)}`,
    `Roll: ${telemetry.rollDeg.toFixed(1)}deg  Pitch: ${telemetry.pitchDeg.toFixed(1)}deg`,
    `Downforce: ${(telemetry.aeroDownforceN / 9.81).toFixed(0)}kg  Drag: ${telemetry.aeroDragN.toFixed(0)}N`,
    `Surface grip: ${avgSurfaceGrip.toFixed(2)}x ${avgSurfaceGrip > 0.8 ? '(track)' : '(grass)'}`,
    `Camera: ${cameraMode}`,
    ``,
    `Lap: ${formatLapTime(lapState.currentLapSeconds)}`,
    `Last: ${formatLapTime(lapState.lastLapSeconds)}  Best: ${formatLapTime(lapState.bestLapSeconds)}`,
  ]);

  requestAnimationFrame(renderLoop);
}

renderLoop();

console.log('Rapier initialized:', world.bodies.len(), 'bodies (ground + car)');

// Exposed for scripted/headless verification of the driving-feel PoC.
const debugHandle = window as unknown as {
  __vehicle: VehicleModel;
  __getCameraMode: () => string;
  __flyTo: (pos: [number, number, number], lookAt: [number, number, number]) => void;
  __lapTimer: LapTimer;
};
debugHandle.__vehicle = vehicle;
debugHandle.__getCameraMode = () => cameraMode;
debugHandle.__flyTo = (pos, lookAt) => {
  freeCamera.enabled = false;
  scene.attach(camera);
  camera.position.set(...pos);
  camera.lookAt(...lookAt);
};
debugHandle.__lapTimer = lapTimer;
