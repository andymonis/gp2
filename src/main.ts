import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { buildCarMesh } from './car-mesh';
import { buildGroundMesh, createGroundCollider } from './ground';
import { buildDashboard } from './dashboard';
import { InputState } from './input';
import { VehicleModel, REDLINE_RPM, type WheelName } from './vehicle';
import { FreeCamera } from './free-camera';
import { createDebugHud } from './debug-hud';

const PHYSICS_DT = 1 / 60;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fd0ff);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445544, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(50, 80, 30);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(
  70,
  window.innerWidth / window.innerHeight,
  0.05,
  1000,
);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

scene.add(buildGroundMesh());

const carMesh = buildCarMesh();
scene.add(carMesh.group);

// Cockpit camera: fixed in the car's local space, looking toward the nose (+z).
// Eye height sits well above the tub top (0.575) so the driver looks over the
// bodywork rather than grazing along its surface.
const COCKPIT_EYE_POSITION = new THREE.Vector3(0, 0.95, -0.2);
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
const dashboard = buildDashboard();
dashboard.group.position.set(0, 0.58, 0.75);
dashboard.group.rotation.set(0, Math.PI, 0);
dashboard.group.scale.setScalar(0.7);
carMesh.group.add(dashboard.group);

await RAPIER.init();
const world = new RAPIER.World({ x: 0.0, y: -9.81, z: 0.0 });
createGroundCollider(world);

const vehicle = new VehicleModel(world, new THREE.Vector3(0, 1, 0));

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
  debugHud.update([
    `FPS: ${smoothedFps.toFixed(0)}`,
    `Speed: ${telemetry.speedKmh.toFixed(1)} km/h (${(telemetry.speedKmh * 0.6214).toFixed(1)} mph)`,
    `RPM: ${telemetry.engineRpm.toFixed(0)} / ${REDLINE_RPM}`,
    `Gear: ${telemetry.gear === 0 ? 'N' : telemetry.gear}`,
    `Throttle: ${telemetry.throttle.toFixed(2)}  Brake: ${telemetry.brake.toFixed(2)}  Clutch: ${telemetry.clutch.toFixed(2)}`,
    `Roll: ${telemetry.rollDeg.toFixed(1)}deg  Pitch: ${telemetry.pitchDeg.toFixed(1)}deg`,
    `Downforce: ${(telemetry.aeroDownforceN / 9.81).toFixed(0)}kg  Drag: ${telemetry.aeroDragN.toFixed(0)}N`,
    `Camera: ${cameraMode}`,
  ]);

  requestAnimationFrame(renderLoop);
}

renderLoop();

console.log('Rapier initialized:', world.bodies.len(), 'bodies (ground + car)');

// Exposed for scripted/headless verification of the driving-feel PoC.
const debugHandle = window as unknown as {
  __vehicle: VehicleModel;
  __getCameraMode: () => string;
};
debugHandle.__vehicle = vehicle;
debugHandle.__getCameraMode = () => cameraMode;
