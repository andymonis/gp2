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

const SUSPENSION_REST_LENGTH = 0.28;
const SUSPENSION_MAX_TRAVEL = 0.12;
const SUSPENSION_STIFFNESS = 45000; // N/m
const SUSPENSION_DAMPING = 3800; // Ns/m

const SUSPENSION_MAX_FORCE = 16000; // N, safety cap against contact-transition spikes

const TIRE_GRIP_FRONT = 1.35; // friction-circle coefficient (mu)
const TIRE_GRIP_REAR = 1.3;
const LATERAL_STIFFNESS = 9000; // N per m/s of lateral slip velocity

const MAX_STEER_ANGLE = 0.5; // radians (~28.6deg)
const MAX_BRAKE_FORCE_PER_WHEEL = 5200; // N

const IDLE_RPM = 4000;
const REDLINE_RPM = 12500;
const PEAK_TORQUE_RPM = 9500;
const MAX_TORQUE_NM = 430;
const ENGINE_RESPONSE_RATE = 9000; // rpm/s, first-order lag toward target

const GEAR_RATIOS = [3.8, 2.9, 2.3, 1.9, 1.6, 1.35];
const FINAL_DRIVE = 3.5;

function engineTorqueNm(rpm: number): number {
  const span = (REDLINE_RPM - IDLE_RPM) / 2;
  const x = (rpm - PEAK_TORQUE_RPM) / span;
  const shape = Math.max(0.2, 1 - x * x);
  return MAX_TORQUE_NM * shape;
}

function rampToward(current: number, target: number, maxDelta: number): number {
  const delta = target - current;
  if (Math.abs(delta) <= maxDelta) return target;
  return current + Math.sign(delta) * maxDelta;
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

    const colliderDesc = RAPIER.ColliderDesc.cuboid(0.6, 0.28, 1.4)
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
    // addForce/addForceAtPoint accumulate into a persistent per-body force
    // that Rapier keeps applying every subsequent step until reset - without
    // this, suspension/tire forces from past frames never go away and stack
    // without bound.
    this.chassis.resetForces(true);
    this.chassis.resetTorques(true);
    const chassisRot = quatFromRapier(this.chassis.rotation());
    const chassisPos = vecFromRapier(this.chassis.translation());
    const localUp = new THREE.Vector3(0, 1, 0).applyQuaternion(chassisRot);

    const gearRatio = this.gear > 0 ? GEAR_RATIOS[this.gear - 1] : 0;
    const coupling = this.gear > 0 ? 1 - input.clutch : 0;

    // Wheel-derived rpm target (used when the drivetrain is coupled).
    const drivenAngSpeed =
      (this.wheelRuntime.rearLeft.angularSpeed + this.wheelRuntime.rearRight.angularSpeed) / 2;
    const slavedRpm = Math.abs(drivenAngSpeed) * gearRatio * FINAL_DRIVE * (60 / (2 * Math.PI));
    const freeRpmTarget = IDLE_RPM + input.throttle * (REDLINE_RPM - IDLE_RPM);
    const targetRpm = this.gear > 0 ? lerp(freeRpmTarget, slavedRpm, coupling) : freeRpmTarget;
    const clampedTarget = clamp(targetRpm, IDLE_RPM, REDLINE_RPM);
    this.engineRpm = rampToward(this.engineRpm, clampedTarget, ENGINE_RESPONSE_RATE * dt);

    const torque = engineTorqueNm(this.engineRpm) * input.throttle;
    const drivingForceTotal =
      this.gear > 0 ? (torque * gearRatio * FINAL_DRIVE * coupling) / WHEEL_RADIUS : 0;
    const drivenWheelNames = WHEEL_NAMES.filter((name) => this.wheelDefs[name].isDriven);
    const drivingForcePerWheel = drivingForceTotal / drivenWheelNames.length;

    for (const name of WHEEL_NAMES) {
      this.stepWheel(name, dt, input, chassisRot, chassisPos, localUp, drivingForcePerWheel);
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
      runtime.steerAngle = def.isFront ? input.steer * MAX_STEER_ANGLE : 0;
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

    const steerAngle = def.isFront ? input.steer * MAX_STEER_ANGLE : 0;
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
