import * as THREE from 'three';

export interface LapTimerState {
  currentLapSeconds: number;
  lastLapSeconds: number | null;
  bestLapSeconds: number | null;
}

// The car spawns sitting exactly on the start/finish line, and the
// suspension's real settle jitter in the first fraction of a second (seen
// throughout this project - the same "first contact frame" settling that
// needed its own clamps in vehicle.ts) can rock the chassis back and forth
// across the line's threshold before it's even moved, registering a phantom
// sub-second "lap" - caught via a scripted test showing a completed lap
// already logged 700ms after page load, before any real driving happened.
// A minimum lap time - comfortably under any real lap on this ~5.5km track,
// comfortably over any settle-jitter timescale - filters that out without
// needing to special-case "is this spawn-adjacent noise" directly.
const MIN_LAP_SECONDS = 10;

/**
 * A simple time-attack lap timer: detects crossing the start/finish line
 * (a single checkpoint, not a full sector system) and tracks current/last/
 * best lap time. Deliberately minimal otherwise - no wrong-way detection, no
 * persistence across reloads. "Crossing" is a sign flip in the car's signed
 * distance along the line's direction of travel, gated to a lateral
 * `gateHalfWidth` so the same infinite plane doesn't trigger from clear
 * across the infield on the loop's opposite side. That gate spans wall to
 * wall, not just the paved track - a car that's run wide onto the grass at
 * the end of a lap should still trigger the timer; only actually hitting the
 * wall should be able to miss it.
 */
export class LapTimer {
  private readonly linePosition: THREE.Vector3;
  private readonly lineTangent: THREE.Vector3;
  private readonly lineRight: THREE.Vector3;
  private readonly halfWidth: number;

  private previousSignedDistance = -Infinity;
  private hasStartedLap = false;
  private currentLapSeconds = 0;
  private lastLapSeconds: number | null = null;
  private bestLapSeconds: number | null = null;

  constructor(linePosition: THREE.Vector3, lineYaw: number, gateHalfWidth: number) {
    this.linePosition = linePosition.clone().setY(0);
    this.lineTangent = new THREE.Vector3(Math.sin(lineYaw), 0, Math.cos(lineYaw));
    this.lineRight = new THREE.Vector3(Math.cos(lineYaw), 0, -Math.sin(lineYaw));
    this.halfWidth = gateHalfWidth;
  }

  update(dt: number, carPosition: THREE.Vector3) {
    if (this.hasStartedLap) this.currentLapSeconds += dt;

    const relative = carPosition.clone().setY(0).sub(this.linePosition);
    const signedDistance = relative.dot(this.lineTangent);
    const lateralOffset = relative.dot(this.lineRight);

    const crossedForward = this.previousSignedDistance < 0 && signedDistance >= 0;
    if (crossedForward && Math.abs(lateralOffset) <= this.halfWidth) {
      if (!this.hasStartedLap) {
        // The very first crossing (at spawn, right on the line) just starts
        // the clock rather than completing a phantom lap.
        this.currentLapSeconds = 0;
        this.hasStartedLap = true;
      } else if (this.currentLapSeconds >= MIN_LAP_SECONDS) {
        this.lastLapSeconds = this.currentLapSeconds;
        if (this.bestLapSeconds === null || this.currentLapSeconds < this.bestLapSeconds) {
          this.bestLapSeconds = this.currentLapSeconds;
        }
        this.currentLapSeconds = 0;
      }
      // else: too soon to be a real lap (spawn/settle jitter re-crossing the
      // line) - ignore it and keep timing the lap already in progress.
    }

    this.previousSignedDistance = signedDistance;
  }

  getState(): LapTimerState {
    return {
      currentLapSeconds: this.currentLapSeconds,
      lastLapSeconds: this.lastLapSeconds,
      bestLapSeconds: this.bestLapSeconds,
    };
  }
}

export function formatLapTime(seconds: number | null): string {
  if (seconds === null) return '--:--.---';
  const minutes = Math.floor(seconds / 60);
  const secs = seconds - minutes * 60;
  return `${minutes}:${secs.toFixed(3).padStart(6, '0')}`;
}
