import * as THREE from 'three';

const BASE_SPEED = 15; // units/sec
const MIN_SPEED = 2;
const MAX_SPEED = 120;
const MOUSE_SENSITIVITY = 0.0022;
const PITCH_LIMIT = Math.PI / 2 - 0.01;

/** No-clip fly camera: mouse-look (via pointer lock) + WASD/QE movement. */
export class FreeCamera {
  enabled = false;

  private yaw = 0;
  private pitch = 0;
  private speed = BASE_SPEED;
  private held = new Set<string>();
  private camera: THREE.PerspectiveCamera;
  private domElement: HTMLElement;

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement) {
    this.camera = camera;
    this.domElement = domElement;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mousemove', this.onMouseMove);
    domElement.addEventListener('click', this.onClick);
    domElement.addEventListener('wheel', this.onWheel, { passive: false });
  }

  private onKeyDown = (e: KeyboardEvent) => {
    this.held.add(e.key.toLowerCase());
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.held.delete(e.key.toLowerCase());
  };

  private onClick = () => {
    if (!this.enabled) return;
    // requestPointerLock() can reject (permissions, unsupported context) -
    // that's fine, the user just won't get mouse-look until it's granted.
    const result = this.domElement.requestPointerLock();
    if (result instanceof Promise) result.catch(() => {});
  };

  private onMouseMove = (e: MouseEvent) => {
    if (!this.enabled || document.pointerLockElement !== this.domElement) return;
    this.yaw -= e.movementX * MOUSE_SENSITIVITY;
    this.pitch = Math.max(
      -PITCH_LIMIT,
      Math.min(PITCH_LIMIT, this.pitch - e.movementY * MOUSE_SENSITIVITY),
    );
  };

  private onWheel = (e: WheelEvent) => {
    if (!this.enabled) return;
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.001);
    this.speed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, this.speed * factor));
  };

  /** Call right after re-parenting the camera to world space, to seed look angles from its current orientation. */
  syncFromCamera() {
    const euler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.yaw = euler.y;
    this.pitch = euler.x;
  }

  update(dt: number) {
    if (!this.enabled) return;

    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0);

    const move = new THREE.Vector3();
    if (this.held.has('w')) move.add(forward);
    if (this.held.has('s')) move.sub(forward);
    if (this.held.has('d')) move.add(right);
    if (this.held.has('a')) move.sub(right);
    if (this.held.has('e')) move.add(up);
    if (this.held.has('q')) move.sub(up);

    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(this.speed * dt);
      this.camera.position.add(move);
    }
  }
}
