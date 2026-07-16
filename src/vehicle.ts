import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { WHEEL_MOUNTS, WHEEL_RADII } from './car-mesh';
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

const TIRE_GRIP_FRONT = 1.75; // friction-circle coefficient (mu)
const TIRE_GRIP_REAR = 1.7;
const LATERAL_STIFFNESS = 9000; // N per m/s of lateral slip velocity

// --- Aero + weight transfer -------------------------------------------------
// Suspension travel is only 3.5cm (see above), so its spring force alone
// cannot represent ~2000kgf of aero downforce or real weight-transfer loads
// without bottoming out. Instead, the per-wheel normal load used for the
// grip-circle limit is computed algebraically here (static share + weight
// transfer + aero), decoupled from the suspension's springForce (which keeps
// doing its existing job of holding the chassis up / ride height only).
const GRAVITY = 9.81;
const STATIC_WEIGHT_FRONT_FRACTION = 0.45; // rear-engined car: rest-state front/rear split
const AERO_FRONT_FRACTION = 0.35; // front wing is much smaller than rear wing + diffuser

// Calibrated so downforceTotal(150mph = 67.056 m/s) ≈ 19620N (2000kgf).
const AERO_DOWNFORCE_K = 4.364; // N per (m/s)^2
// Calibrated so 6th gear's redline-derived top speed (217mph) is roughly
// where available drive force balances drag - a rough starting point that
// needs empirical iteration from measured top speed (see plan doc).
// (Iterated down from an initial 0.7 guess, which stalled the car at
// ~121mph in 4th gear - well short of even that gear's own 149mph target -
// per the scripted verification pass; 0.15 still asymptotically stalled
// just under 4th gear's redline threshold at ~142mph.)
const AERO_DRAG_K = 0.08; // N per (m/s)^2

const WHEELBASE = WHEEL_MOUNTS.frontLeft.z - WHEEL_MOUNTS.rearLeft.z;
const FRONT_TRACK = WHEEL_MOUNTS.frontRight.x - WHEEL_MOUNTS.frontLeft.x;
const REAR_TRACK = WHEEL_MOUNTS.rearRight.x - WHEEL_MOUNTS.rearLeft.x;

// Explicit anti-roll/anti-pitch corrective torque, axis-isolated from yaw.
// The suspension's natural restoring torque (from independent per-wheel
// raycasts) is weak relative to the lateral forces the new grip/aero numbers
// allow, and it's further weakened by the grip/spring-force decoupling above
// (the spring never "sees" the algebraic aero/lateral load) - so without
// this, hard cornering visibly rolls/pitches the chassis. Global angular
// damping is deliberately left alone since it's a single scalar across all 3
// axes and would also dull the twitchy yaw response.
const ROLL_STIFFNESS_NM_PER_RAD = 150000;
const ROLL_DAMPING_NM_PER_RAD_S = 18000;
const PITCH_STIFFNESS_NM_PER_RAD = 130000;
const PITCH_DAMPING_NM_PER_RAD_S = 16000;
const ROLL_PITCH_TORQUE_MAX_NM = 100000; // safety cap, same pattern as SUSPENSION_MAX_FORCE

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
const ENGINE_INERTIA_RPM = 0.010;
// Torque-limited friction coupling: below this capacity the clutch is
// slipping (transmitting a roughly constant, Coulomb-friction-like torque
// regardless of rpm gap); once the rpm gap is small enough that the demanded
// torque fits under the capacity, it locks the engine and driveline together.
const CLUTCH_MAX_TORQUE_NM = 700;
// Nm per rpm of engine/driveline rpm difference. This is a proportional
// controller pulling slipRpm to 0 each sub-step, explicit-Euler-integrated
// against the engine's tiny inertia (ENGINE_INERTIA_RPM) - stable (no
// oscillation) only while
// CLUTCH_SLIP_GAIN * subDt / ENGINE_INERTIA_RPM < ~1
// (2 is the hard divergence boundary; 1 is where it stops oscillating and
// just decays smoothly). At subDt=1/240s that bound is ~2.4 - a gain much
// below that (e.g. the ~0.25 first tried here) is stable but converges so
// slowly after a gear change that it settles at a fraction of the engine's
// available torque for a long stretch, silently starving mid-gear
// acceleration; a gain far above it (e.g. the original 10) blows straight
// through the boundary and chatters between full-drive and full-engine-
// braking every sub-step. This value sits close to the fast-but-stable edge.
const CLUTCH_SLIP_GAIN = 2;
const IDLE_GOVERNOR_GAIN = 0.4; // Nm per rpm below idle, pulls revs back up
// Nm per rpm above idle, off-throttle engine braking. Applied unconditionally
// (not just off-throttle), so it also acts as a parasitic loss at full
// throttle - kept small so it doesn't eat a large fraction of peak torque at
// high rpm (the old 0.03 ate ~240Nm of the ~400Nm available at 12000rpm,
// which was silently strangling sustained high-speed acceleration once the
// clutch model above was fixed to actually deliver torque).
const ENGINE_FRICTION_GAIN = 0.008;

// Ratios chosen so redline (13000rpm) in each gear lands at the target top
// speed for that gear: 1st 50mph, 2nd 80, 3rd 112, 4th 149, 5th 186, 6th
// 217mph, using the rear (driven) wheel radius. overallRatio = (REDLINE_RPM
// * 2*pi/60 * rearWheelRadius) / targetSpeedMs; gearRatio = overallRatio /
// FINAL_DRIVE.
const GEAR_RATIOS = [5.742, 3.589, 2.564, 1.927, 1.544, 1.323];
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
  radius: number;
  isFront: boolean;
  isLeft: boolean;
  isDriven: boolean;
  grip: number;
}

interface WheelRuntime {
  suspensionLength: number;
  compression: number;
  wasInContact: boolean;
  inContact: boolean;
  normalLoad: number; // suspension spring force - ride height support only
  gripLoad: number; // algebraic normal load used for the grip-circle limit
  angularSpeed: number; // rad/s, cosmetic (assumes rolling without slip)
  steerAngle: number;
}

export interface WheelVisualState {
  steerAngle: number;
  angularSpeed: number;
  suspensionLength: number;
  normalLoad: number;
  gripLoad: number;
}

export interface VehicleTelemetry {
  speedKmh: number;
  engineRpm: number;
  gear: number; // 0 = neutral
  throttle: number;
  brake: number;
  clutch: number;
  rollDeg: number;
  pitchDeg: number;
  aeroDownforceN: number;
  aeroDragN: number;
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
  private previousLinvel = new THREE.Vector3();
  private lastAeroDownforceN = 0;
  private lastAeroDragN = 0;
  private lastRollDeg = 0;
  private lastPitchDeg = 0;

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
      frontLeft: {
        mount: WHEEL_MOUNTS.frontLeft,
        radius: WHEEL_RADII.front,
        isFront: true,
        isLeft: true,
        isDriven: false,
        grip: TIRE_GRIP_FRONT,
      },
      frontRight: {
        mount: WHEEL_MOUNTS.frontRight,
        radius: WHEEL_RADII.front,
        isFront: true,
        isLeft: false,
        isDriven: false,
        grip: TIRE_GRIP_FRONT,
      },
      rearLeft: {
        mount: WHEEL_MOUNTS.rearLeft,
        radius: WHEEL_RADII.rear,
        isFront: false,
        isLeft: true,
        isDriven: true,
        grip: TIRE_GRIP_REAR,
      },
      rearRight: {
        mount: WHEEL_MOUNTS.rearRight,
        radius: WHEEL_RADII.rear,
        isFront: false,
        isLeft: false,
        isDriven: true,
        grip: TIRE_GRIP_REAR,
      },
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

    // Longitudinal/lateral chassis acceleration, estimated once per outer
    // tick from a one-tick-lagged velocity diff (not per substep - substep
    // deltas would alias the stiff suspension's force spikes into a noisy
    // signal). Feeds only the algebraic weight-transfer terms in stepWheel;
    // never applied as a real force/torque.
    const currentLinvel = vecFromRapier(this.chassis.linvel());
    const accelWorld = currentLinvel.clone().sub(this.previousLinvel).divideScalar(dt);
    this.previousLinvel = currentLinvel;
    const tickAxes = this.getChassisAxes(quatFromRapier(this.chassis.rotation()));
    const ax = accelWorld.dot(tickAxes.forward);
    const ay = accelWorld.dot(tickAxes.right);

    const overallRatio = this.gear > 0 ? GEAR_RATIOS[this.gear - 1] * FINAL_DRIVE : 0;

    // The suspension is far stiffer than a single 60Hz tick can stably
    // integrate with a simple explicit spring-damper force (the force is
    // computed from last-frame data and applied for a whole frame-length dt,
    // which rings/overshoots at this stiffness) - sub-step the raycasts,
    // tire/suspension forces, and physics integration to fix that.
    //
    // The engine/clutch coupling is *even stiffer* in effective terms
    // (CLUTCH_MAX_TORQUE_NM=700 over ENGINE_INERTIA_RPM=0.010 means a single
    // outer 1/60s step can swing engine rpm by 1000+rpm from clutch torque
    // alone) - integrating it once per outer tick let engine/wheel rpm
    // repeatedly overshoot past the "locked" point and oscillate between
    // full-drive and full-engine-braking every tick instead of converging,
    // starving average driving force. So the engine/clutch integration is
    // sub-stepped here too, at the same subDt as the suspension.
    const subDt = dt / PHYSICS_SUBSTEPS;
    this.world.integrationParameters.dt = subDt;
    for (let i = 0; i < PHYSICS_SUBSTEPS; i++) {
      // Wheel-derived "engine-equivalent" rpm: what the engine would be
      // spinning at if perfectly locked to the current wheel speed in this
      // gear. Uses last substep's wheel angular speed (available from
      // wheelRuntime), same lagged-state pattern already used for suspension
      // damping.
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

      // Only a nominal safety floor here, not IDLE_RPM: a heavily-lugged
      // engine (e.g. clutch locked to a low wheel speed) should be able to
      // dip below idle, recovering via idleAssist torque rather than being
      // artificially pinned - a hard idle floor would mask that as a
      // misleading flat 4000rpm readout even while the car is clearly still
      // accelerating.
      const rpmAccel = netEngineTorque / ENGINE_INERTIA_RPM;
      this.engineRpm = clamp(this.engineRpm + rpmAccel * subDt, 500, REDLINE_RPM);

      // Only the rear (driven) wheels put power down - use their radius to
      // convert wheel torque to force.
      const drivingForceTotal =
        this.gear > 0 ? (clutchTorque * overallRatio) / this.wheelDefs.rearLeft.radius : 0;
      const drivenWheelCount = 2; // rearLeft + rearRight
      const drivingForcePerWheel = drivingForceTotal / drivenWheelCount;

      // addForce/addForceAtPoint accumulate into a persistent per-body force
      // that Rapier keeps applying every subsequent step until reset -
      // without this, forces from past (sub)steps never go away and stack
      // without bound.
      this.chassis.resetForces(true);
      this.chassis.resetTorques(true);
      const chassisRot = quatFromRapier(this.chassis.rotation());
      const chassisPos = vecFromRapier(this.chassis.translation());
      const axes = this.getChassisAxes(chassisRot);
      const linvel = vecFromRapier(this.chassis.linvel());
      const speedMs = linvel.length();
      const speedKmh = speedMs * 3.6;
      const steerScale = clamp(1 - speedKmh / STEER_SCALE_KMH, STEER_MIN_FACTOR, 1);

      // Aero: downforce feeds the algebraic per-wheel grip load (in
      // stepWheel) rather than being applied as a real force - see the
      // constants comment above for why. Drag IS a real applied force
      // (horizontal, no suspension-capacity conflict).
      const downforceTotal = AERO_DOWNFORCE_K * speedMs * speedMs;
      const dragMag = AERO_DRAG_K * speedMs * speedMs;
      this.lastAeroDownforceN = downforceTotal;
      this.lastAeroDragN = dragMag;
      if (speedMs > 0.01) {
        this.chassis.addForce(linvel.clone().normalize().multiplyScalar(-dragMag), true);
      }

      // Explicit anti-roll/anti-pitch corrective torque, axis-isolated from
      // yaw - see the constants comment above for why this is needed.
      const angvel = vecFromRapier(this.chassis.angvel());
      const rollRate = angvel.dot(axes.forward);
      const pitchRate = angvel.dot(axes.right);
      const rollTorqueMag =
        -axes.rollAngle * ROLL_STIFFNESS_NM_PER_RAD - rollRate * ROLL_DAMPING_NM_PER_RAD_S;
      const pitchTorqueMag =
        -axes.pitchAngle * PITCH_STIFFNESS_NM_PER_RAD - pitchRate * PITCH_DAMPING_NM_PER_RAD_S;
      const correctiveTorque = axes.forward
        .clone()
        .multiplyScalar(rollTorqueMag)
        .add(axes.right.clone().multiplyScalar(pitchTorqueMag));
      if (correctiveTorque.length() > ROLL_PITCH_TORQUE_MAX_NM) {
        correctiveTorque.setLength(ROLL_PITCH_TORQUE_MAX_NM);
      }
      this.chassis.addTorque(correctiveTorque, true);
      this.lastRollDeg = THREE.MathUtils.radToDeg(axes.rollAngle);
      this.lastPitchDeg = THREE.MathUtils.radToDeg(axes.pitchAngle);

      for (const name of WHEEL_NAMES) {
        this.stepWheel(
          name,
          subDt,
          input,
          chassisRot,
          chassisPos,
          axes.up,
          drivingForcePerWheel,
          steerScale,
          ax,
          ay,
          downforceTotal,
        );
      }

      this.world.step();
    }
  }

  /** World-space forward/right/up axes and roll/pitch tilt for the chassis. Shared by the anti-roll torque and telemetry. */
  private getChassisAxes(chassisRot: THREE.Quaternion) {
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(chassisRot);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(chassisRot);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(chassisRot);
    const rollAngle = Math.asin(clamp(up.dot(right), -1, 1));
    const pitchAngle = Math.asin(clamp(-up.dot(forward), -1, 1));
    return { up, forward, right, rollAngle, pitchAngle };
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
    ax: number,
    ay: number,
    downforceTotal: number,
  ) {
    const def = this.wheelDefs[name];
    const runtime = this.wheelRuntime[name];

    const hardpoint = def.mount.clone().applyQuaternion(chassisRot).add(chassisPos);
    const rayDir = localUp.clone().negate();
    const maxRayLength = SUSPENSION_REST_LENGTH + SUSPENSION_MAX_TRAVEL + def.radius;

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
      runtime.gripLoad = 0;
      runtime.compression = -SUSPENSION_MAX_TRAVEL;
      runtime.suspensionLength = SUSPENSION_REST_LENGTH + SUSPENSION_MAX_TRAVEL;
      runtime.steerAngle = def.isFront ? input.steer * MAX_STEER_ANGLE * steerScale : 0;
      return;
    }

    const groundDistance = hit.timeOfImpact;
    const rawSuspensionLength = groundDistance - def.radius;
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

    runtime.angularSpeed = longSpeed / def.radius;

    // Algebraic normal load for the grip-circle limit: static weight share +
    // longitudinal/lateral weight transfer + aero downforce share, decoupled
    // from the suspension's springForce above (see the constants comment at
    // the top of the file for why). ax positive = accelerating forward
    // (weight shifts rearward: front loses, rear gains). ay positive =
    // centripetal accel toward chassis-right (car turning right): outside
    // (left) wheels gain load, inside (right) lose it.
    const axleStaticFraction = def.isFront
      ? STATIC_WEIGHT_FRONT_FRACTION
      : 1 - STATIC_WEIGHT_FRONT_FRACTION;
    const axleAeroFraction = def.isFront ? AERO_FRONT_FRACTION : 1 - AERO_FRONT_FRACTION;
    const axleTrack = def.isFront ? FRONT_TRACK : REAR_TRACK;

    const staticLoad = (MASS_KG * GRAVITY * axleStaticFraction) / 2;
    const longTransferTotal = (MASS_KG * ax * COM_HEIGHT) / WHEELBASE;
    const longTransfer = def.isFront ? -longTransferTotal / 2 : longTransferTotal / 2;
    const latTransferAxle = (MASS_KG * axleStaticFraction * ay * COM_HEIGHT) / axleTrack;
    const latTransfer = def.isLeft ? latTransferAxle : -latTransferAxle;
    const aeroLoad = (downforceTotal * axleAeroFraction) / 2;

    const gripLoad = Math.max(0, staticLoad + longTransfer + latTransfer + aeroLoad);
    runtime.gripLoad = gripLoad;

    const brakeMagnitude = input.brake * MAX_BRAKE_FORCE_PER_WHEEL;
    const brakeForce = Math.abs(longSpeed) > 0.15 ? -Math.sign(longSpeed) * brakeMagnitude : 0;
    const engineForce = def.isDriven ? drivingForcePerWheel : 0;
    const longDemand = engineForce + brakeForce;
    const latDemand = -LATERAL_STIFFNESS * latSpeed;

    const demandMag = Math.hypot(longDemand, latDemand);
    const gripLimit = def.grip * gripLoad;
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
        normalLoad: runtime.normalLoad,
        gripLoad: runtime.gripLoad,
      };
    }
    return {
      speedKmh,
      engineRpm: this.engineRpm,
      gear: this.gear,
      throttle: this.lastThrottle,
      brake: this.lastBrake,
      clutch: this.lastClutch,
      rollDeg: this.lastRollDeg,
      pitchDeg: this.lastPitchDeg,
      aeroDownforceN: this.lastAeroDownforceN,
      aeroDragN: this.lastAeroDragN,
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
    gripLoad: 0,
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
