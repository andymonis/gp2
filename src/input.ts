const KEY_LEFT = 'z';
const KEY_RIGHT = 'x';
const KEY_ACCELERATE = "'";
const KEY_BRAKE = '/';
const KEY_SHIFT_TRIGGER = ' ';
const KEY_CLUTCH = 'Shift';

/** Per-second rate at which ramped inputs approach their target value. */
const RAMP_RATE = 4;

export type ShiftDirection = 'up' | 'down';

export class InputState {
  /** -1 (full left) .. 1 (full right) */
  steer = 0;
  /** 0 .. 1 */
  throttle = 0;
  /** 0 .. 1 */
  brake = 0;
  /** 0 .. 1 */
  clutch = 0;

  private held = new Set<string>();
  private pendingShifts: ShiftDirection[] = [];

  constructor() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.held.has(e.key)) return;
    this.held.add(e.key);
    if (e.key === KEY_SHIFT_TRIGGER) {
      this.pendingShifts.push(this.throttle > 0 ? 'up' : 'down');
      e.preventDefault();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.held.delete(e.key);
  };

  /** Consumes and returns gear-shift triggers queued since the last call. */
  takeShiftTriggers(): ShiftDirection[] {
    const shifts = this.pendingShifts;
    this.pendingShifts = [];
    return shifts;
  }

  /** Advances ramped values toward their target (held-key) state. */
  update(dt: number) {
    const steerTarget =
      (this.held.has(KEY_RIGHT) ? 1 : 0) - (this.held.has(KEY_LEFT) ? 1 : 0);
    const throttleTarget = this.held.has(KEY_ACCELERATE) ? 1 : 0;
    const brakeTarget = this.held.has(KEY_BRAKE) ? 1 : 0;
    const clutchTarget = this.held.has(KEY_CLUTCH) ? 1 : 0;

    this.steer = rampToward(this.steer, steerTarget, dt);
    this.throttle = rampToward(this.throttle, throttleTarget, dt);
    this.brake = rampToward(this.brake, brakeTarget, dt);
    this.clutch = rampToward(this.clutch, clutchTarget, dt);
  }
}

function rampToward(current: number, target: number, dt: number): number {
  const maxDelta = RAMP_RATE * dt;
  const delta = target - current;
  if (Math.abs(delta) <= maxDelta) return target;
  return current + Math.sign(delta) * maxDelta;
}
