import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

export const GROUND_SIZE = 6000;

export function createGroundCollider(world: RAPIER.World) {
  const groundBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const groundCollider = RAPIER.ColliderDesc.cuboid(GROUND_SIZE / 2, 0.5, GROUND_SIZE / 2)
    .setTranslation(0, -0.5, 0)
    .setFriction(1);
  world.createCollider(groundCollider, groundBody);
}

export function buildGroundMesh(): THREE.Group {
  const group = new THREE.Group();

  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
    new THREE.MeshStandardMaterial({ color: 0x2f6b2f, flatShading: true }),
  );
  plane.rotation.x = -Math.PI / 2;
  group.add(plane);

  const grid = new THREE.GridHelper(GROUND_SIZE, GROUND_SIZE / 10, 0xffffff, 0xffffff);
  const gridMaterial = grid.material as THREE.Material;
  gridMaterial.transparent = true;
  gridMaterial.opacity = 0.15;
  group.add(grid);

  // Scale-reference markers every 50 units along both axes.
  const markerMat = new THREE.MeshStandardMaterial({ color: 0xffcc00, flatShading: true });
  const markerGeometry = new THREE.BoxGeometry(0.4, 1.2, 0.4);
  for (let x = -GROUND_SIZE / 2; x <= GROUND_SIZE / 2; x += 50) {
    for (let z = -GROUND_SIZE / 2; z <= GROUND_SIZE / 2; z += 50) {
      if (x === 0 && z === 0) continue;
      const marker = new THREE.Mesh(markerGeometry, markerMat);
      marker.position.set(x, 0.6, z);
      group.add(marker);
    }
  }

  return group;
}
