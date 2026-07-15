import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { WHEEL_MOUNTS, WHEEL_RADIUS } from './car-mesh';
import type { InputState } from './input';

// --- Tunable constants -----------------------------------------------------
// This phase is expected to need several tuning passes to get the "twitchy,
// powerful, easy to spin" 1990 F1 character right. Everything that affects
// feel lives here.

const MASS_KG = 600;
const COM_HEIGHT = 0.3; // above the wheel-mount reference plane

// Sub-steps per outer physics tick. A stiff suspension needs a fine enough
// integration step to stay numerically stable (see the comment in step()).
const PHYSICS_SUBSTEPS = 4;

// F1 chassis/suspension is very stiff with minimal travel (unlike a road
// car) - low travel + high stiffness keeps body roll/pitch small.
const SUSPENSION_REST_LENGTH = 0.18;
const SUSPENSION_MAX_TRAVEL = 0.035;
const SUSPENSION_STIFFNESS = 160000; // N/m
const SUSPENSION_DAMPING = 7000; // Ns/m

const SUSPENSION_MAX_FORCE = 30000; // N, safety cap against contact-transition spikes

const TIRE_GRIP_FRONT = 1.35; // friction-circle coefficient (mu)
const TIRE_GRIP_REAR = 1.3;
const LATERAL_STIFFNESS = 9000; // N per m/s of lateral slip velocity

const MAX_STEER_ANGLE = 0.5; // radians (~28.6deg), applied at a standstill
// Speed-sensitive steering: available steer angle is scaled down linearly as
// road speed rises, bottoming out at STEER_MIN_FACTOR by STEER_SCALE_KMH.
// Mild driver-aid-style behavior appropriate for keeping a twitchy car
// controllable at speed without removing all bite at low speed.
const STEER_MIN_FACTOR = 0.18;
const STEER_SCALE_KMH = 220;

const MAX_BRAKE_FORCE_PER_WHEEL = 5200; // N

export const IDLE_RPM = 4000;
export const REDLINE_RPM = 13000;

// Effective engine inertia expressed directly in rpm-space: rpm/s of
// acceleration = net torque (Nm) / this value. Small = revs fast, like a
// low-reciprocating-mass F1 engine.
const ENGINE_INERTIA_RPM = 0.028;
// Torque-limited friction coupling: below this capacity the clutch is
// slipping (transmitting a roughly constant, Coulomb-friction-like torque
// regardless of rpm gap); once the rpm gap is small enough that the demanded
// torque fits under the capacity, it locks the engine and driveline together.
const CLUTCH_MAX_TORQUE_NM = 700;
const CLUTCH_SLIP_GAIN = 10; // Nm per rpm of engine/driveline rpm difference
const IDLE_GOVERNOR_GAIN = 0.4; // Nm per rpm below idle, pulls revs back up
const ENGINE_FRICTION_GAIN = 0.03; // Nm per rpm above idle, off-throttle engine braking

const GEAR_RATIOS = [3.8, 2.9, 2.3, 1.9, 1.6, 1.35];
const FINAL_DRIVE = 3.5;

// Honda RA109E 3.5L V10 torque curve (McLaren MP4/5). The 4000rpm point is
// extrapolated - no data was available below 6000rpm - to give idle a sane
// starting torque rather than an undefined value.
const TORQUE_CURVE: [rpm: number, torqueNm: number][] = [
  [IDLE_RPM, 150],
  [6000, 220],
  [7000, 380],
  [8000, 400],
  [9000, 400],
  [10000, 400],
  [11000, 400],
  [12000, 400],
  [13000, 350],
];

function engineTorqueNm(rpm: number): number {
  if (rpm <= TORQUE_CURVE[0][0]) return TORQUE_CURVE[0][1];
  for (let i = 1; i < TORQUE_CURVE.length; i++) {
    const [rpmHi, torqueHi] = TORQUE_CURVE[i];
    if (rpm <= rpmHi) {
      const [rpmLo, torqueLo] = TORQUE_CURVE[i - 1];
      const t = (rpm - rpmLo) / (rpmHi - rpmLo);
      return lerp(torqueLo, torqueHi, t);
    }
  }
  return TORQUE_CURVE[TORQUE_CURVE.length - 1][1];
}

interface WheelDef {
  mount: THREE.Vector3;
  isFront: boolean;
  isDriven: boolean;
  grip: number;
}

interface WheelRuntime {
  suspensionLength: number;
  compression: number;
  wasInContact: boolean;
  inContact: boolean;
  normalLoad: number;
  angularSpeed: number; // rad/s, cosmetic (assumes rolling without slip)
  steerAngle: number;
}

export interface WheelVisualState {
  steerAngle: number;
  angularSpeed: number;
  suspensionLength: number;
}

export interface VehicleTelemetry {
  speedKmh: number;
  engineRpm: number;
  gear: number; // 0 = neutral
  throttle: number;
  brake: number;
  clutch: number;
  wheels: Record<WheelName, WheelVisualState>;
}

export type WheelName = 'frontLeft' | 'frontRight' | 'rearLeft' | 'rearRight';

const WHEEL_NAMES: WheelName[] = ['frontLeft', 'frontRight', 'rearLeft', 'rearRight'];

export class VehicleModel {
  readonly chassis: RAPIER.RigidBody;
  private world: RAPIER.World;
  private wheelDefs: Record<WheelName, WheelDef>;
  private wheelRuntime: Record<WheelName, WheelRuntime>;

  private engineRpm = IDLE_RPM;
  private gear = 0;
  private lastThrottle = 0;
  private lastBrake = 0;
  private lastClutch = 0;

  constructor(world: RAPIER.World, spawnPosition: THREE.Vector3) {
    this.world = world;

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawnPosition.x, spawnPosition.y, spawnPosition.z)
      .setLinearDamping(0.05)
      .setAngularDamping(1.2)
      .setCanSleep(false);
    this.chassis = world.createRigidBody(bodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.cuboid(0.68, 0.28, 1.35)
      .setTranslation(0, COM_HEIGHT, -0.1)
      .setDensity(1)
      .setFriction(0.5);
    world.createCollider(colliderDesc, this.chassis);
    this.chassis.setAdditionalMass(MASS_KG, true);

    this.wheelDefs = {
      frontLeft: { mount: WHEEL_MOUNTS.frontLeft, isFront: true, isDriven: false, grip: TIRE_GRIP_FRONT },
      frontRight: { mount: WHEEL_MOUNTS.frontRight, isFront: true, isDriven: false, grip: TIRE_GRIP_FRONT },
      rearLeft: { mount: WHEEL_MOUNTS.rearLeft, isFront: false, isDriven: true, grip: TIRE_GRIP_REAR },
      rearRight: { mount: WHEEL_MOUNTS.rearRight, isFront: false, isDriven: true, grip: TIRE_GRIP_REAR },
    };
    this.wheelRuntime = {
      frontLeft: emptyWheelRuntime(),
      frontRight: emptyWheelRuntime(),
      rearLeft: emptyWheelRuntime(),
      rearRight: emptyWheelRuntime(),
    };
  }

  applyShifts(shifts: ('up' | 'down')[]) {
    for (const shift of shifts) {
      if (shift === 'up' && this.gear < GEAR_RATIOS.length) this.gear++;
      if (shift === 'down' && this.gear > 0) this.gear--;
    }
  }

  step(dt: number, input: InputState) {
    this.lastThrottle = input.throttle;
    this.lastBrake = input.brake;
    this.lastClutch = input.clutch;

    const overallRatio = this.gear > 0 ? GEAR_RATIOS[this.gear - 1] * FINAL_DRIVE : 0;

    // Wheel-derived "engine-equivalent" rpm: what the engine would be
    // spinning at if perfectly locked to the current wheel speed in this gear.
    const drivenAngSpeed =
      (this.wheelRuntime.rearLeft.angularSpeed + this.wheelRuntime.rearRight.angularSpeed) / 2;
    const wheelEquivRpm =
      this.gear > 0 ? Math.abs(drivenAngSpeed) * overallRatio * (60 / (2 * Math.PI)) : this.engineRpm;

    // Clutch as a torque-limited friction coupling (not an instant
    // lock/unlock): while there's a big rpm gap it transmits its max
    // capacity (like a slipping friction plate), letting a revved engine
    // actually launch the car; once rpm gaps close, it locks solid.
    const clutchCapacity = this.gear > 0 ? CLUTCH_MAX_TORQUE_NM * (1 - input.clutch) : 0;
    const slipRpm = this.engineRpm - wheelEquivRpm;
    const clutchTorque = clamp(CLUTCH_SLIP_GAIN * slipRpm, -clutchCapacity, clutchCapacity);

    const throttleTorque = engineTorqueNm(this.engineRpm) * input.throttle;
    const idleAssist =
      this.engineRpm < IDLE_RPM ? (IDLE_RPM - this.engineRpm) * IDLE_GOVERNOR_GAIN : 0;
    const engineFriction = Math.max(0, this.engineRpm - IDLE_RPM) * ENGINE_FRICTION_GAIN;
    const netEngineTorque = throttleTorque + idleAssist - engineFriction - clutchTorque;

    // Only a nominal safety floor here, not IDLE_RPM: a heavily-lugged engine
    // (e.g. clutch locked to a low wheel speed) should be able to dip below
    // idle, recovering via idleAssist torque rather than being artificially
    // pinned - a hard idle floor would mask that as a misleading flat 4000rpm
    // readout even while the car is clearly still accelerating.
    const rpmAccel = netEngineTorque / ENGINE_INERTIA_RPM;
    this.engineRpm = clamp(this.engineRpm + rpmAccel * dt, 500, REDLINE_RPM);

    const drivingForceTotal = this.gear > 0 ? (clutchTorque * overallRatio) / WHEEL_RADIUS : 0;
    const drivenWheelNames = WHEEL_NAMES.filter((name) => this.wheelDefs[name].isDriven);
    const drivingForcePerWheel = drivingForceTotal / drivenWheelNames.length;

    // The suspension is far stiffer than a single 60Hz tick can stably
    // integrate with a simple explicit spring-damper force (the force is
    // computed from last-frame data and applied for a whole frame-length dt,
    // which rings/overshoots at this stiffness) - sub-step the raycasts,
    // tire/suspension forces, and physics integration to fix that.
    const subDt = dt / PHYSICS_SUBSTEPS;
    this.world.integrationParameters.dt = subDt;
    for (let i = 0; i < PHYSICS_SUBSTEPS; i++) {
      // addForce/addForceAtPoint accumulate into a persistent per-body force
      // that Rapier keeps applying every subsequent step until reset -
      // without this, forces from past (sub)steps never go away and stack
      // without bound.
      this.chassis.resetForces(true);
      this.chassis.resetTorques(true);
      const chassisRot = quatFromRapier(this.chassis.rotation());
      const chassisPos = vecFromRapier(this.chassis.translation());
      const localUp = new THREE.Vector3(0, 1, 0).applyQuaternion(chassisRot);
      const speedKmh = vecFromRapier(this.chassis.linvel()).length() * 3.6;
      const steerScale = clamp(1 - speedKmh / STEER_SCALE_KMH, STEER_MIN_FACTOR, 1);

      for (const name of WHEEL_NAMES) {
        this.stepWheel(name, subDt, input, chassisRot, chassisPos, localUp, drivingForcePerWheel, steerScale);
      }

      this.world.step();
    }
  }

  private stepWheel(
    name: WheelName,
    dt: number,
    input: InputState,
    chassisRot: THREE.Quaternion,
    chassisPos: THREE.Vector3,
    localUp: THREE.Vector3,
    drivingForcePerWheel: number,
    steerScale: number,
  ) {
    const def = this.wheelDefs[name];
    const runtime = this.wheelRuntime[name];

    const hardpoint = def.mount.clone().applyQuaternion(chassisRot).add(chassisPos);
    const rayDir = localUp.clone().negate();
    const maxRayLength = SUSPENSION_REST_LENGTH + SUSPENSION_MAX_TRAVEL + WHEEL_RADIUS;

    const ray = new RAPIER.Ray(hardpoint, rayDir);
    const hit = this.world.castRayAndGetNormal(
      ray,
      maxRayLength,
      true,
      undefined,
      undefined,
      undefined,
      this.chassis,
    );

    if (!hit) {
      runtime.inContact = false;
      runtime.wasInContact = false;
      runtime.normalLoad = 0;
      runtime.compression = -SUSPENSION_MAX_TRAVEL;
      runtime.suspensionLength = SUSPENSION_REST_LENGTH + SUSPENSION_MAX_TRAVEL;
      runtime.steerAngle = def.isFront ? input.steer * MAX_STEER_ANGLE * steerScale : 0;
      return;
    }

    const groundDistance = hit.timeOfImpact;
    const rawSuspensionLength = groundDistance - WHEEL_RADIUS;
    const suspensionLength = clamp(
      rawSuspensionLength,
      SUSPENSION_REST_LENGTH - SUSPENSION_MAX_TRAVEL,
      SUSPENSION_REST_LENGTH + SUSPENSION_MAX_TRAVEL,
    );
    const compression = SUSPENSION_REST_LENGTH - suspensionLength;
    // Suppress the damping term on the very first contact frame: with no
    // continuous compression history to diff against, it would otherwise
    // produce a huge spurious spike and launch the car.
    const compressionVel = runtime.wasInContact ? (compression - runtime.compression) / dt : 0;
    const springForce = Math.min(
      SUSPENSION_MAX_FORCE,
      Math.max(0, SUSPENSION_STIFFNESS * compression + SUSPENSION_DAMPING * compressionVel),
    );

    runtime.compression = compression;
    runtime.suspensionLength = suspensionLength;
    runtime.inContact = true;
    runtime.wasInContact = true;
    runtime.normalLoad = springForce;

    const contactPoint = hardpoint.clone().add(rayDir.clone().multiplyScalar(groundDistance));
    this.chassis.addForceAtPoint(
      localUp.clone().multiplyScalar(springForce),
      contactPoint,
      true,
    );

    const steerAngle = def.isFront ? input.steer * MAX_STEER_ANGLE * steerScale : 0;
    runtime.steerAngle = steerAngle;
    const localForward = new THREE.Vector3(Math.sin(steerAngle), 0, Math.cos(steerAngle));
    const localRight = new THREE.Vector3(Math.cos(steerAngle), 0, -Math.sin(steerAngle));
    const forwardWorld = localForward.applyQuaternion(chassisRot);
    const rightWorld = localRight.applyQuaternion(chassisRot);

    const contactVel = vecFromRapier(this.chassis.velocityAtPoint(contactPoint));
    const longSpeed = contactVel.dot(forwardWorld);
    const latSpeed = contactVel.dot(rightWorld);

    runtime.angularSpeed = longSpeed / WHEEL_RADIUS;

    const brakeMagnitude = input.brake * MAX_BRAKE_FORCE_PER_WHEEL;
    const brakeForce = Math.abs(longSpeed) > 0.15 ? -Math.sign(longSpeed) * brakeMagnitude : 0;
    const engineForce = def.isDriven ? drivingForcePerWheel : 0;
    const longDemand = engineForce + brakeForce;
    const latDemand = -LATERAL_STIFFNESS * latSpeed;

    const demandMag = Math.hypot(longDemand, latDemand);
    const gripLimit = def.grip * springForce;
    const scale = demandMag > gripLimit && demandMag > 0 ? gripLimit / demandMag : 1;

    const longForce = longDemand * scale;
    const latForce = latDemand * scale;

    const tireForce = forwardWorld
      .clone()
      .multiplyScalar(longForce)
      .add(rightWorld.clone().multiplyScalar(latForce));
    this.chassis.addForceAtPoint(tireForce, contactPoint, true);
  }

  getTelemetry(): VehicleTelemetry {
    const linvel = vecFromRapier(this.chassis.linvel());
    const speedKmh = Math.hypot(linvel.x, linvel.y, linvel.z) * 3.6;
    const wheels = {} as Record<WheelName, WheelVisualState>;
    for (const name of WHEEL_NAMES) {
      const runtime = this.wheelRuntime[name];
      wheels[name] = {
        steerAngle: runtime.steerAngle,
        angularSpeed: runtime.angularSpeed,
        suspensionLength: runtime.suspensionLength,
      };
    }
    return {
      speedKmh,
      engineRpm: this.engineRpm,
      gear: this.gear,
      throttle: this.lastThrottle,
      brake: this.lastBrake,
      clutch: this.lastClutch,
      wheels,
    };
  }
}

function emptyWheelRuntime(): WheelRuntime {
  return {
    suspensionLength: SUSPENSION_REST_LENGTH,
    compression: -SUSPENSION_MAX_TRAVEL,
    wasInContact: false,
    inContact: false,
    normalLoad: 0,
    angularSpeed: 0,
    steerAngle: 0,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function vecFromRapier(v: { x: number; y: number; z: number }): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.y, v.z);
}

function quatFromRapier(r: { x: number; y: number; z: number; w: number }): THREE.Quaternion {
  return new THREE.Quaternion(r.x, r.y, r.z, r.w);
}
