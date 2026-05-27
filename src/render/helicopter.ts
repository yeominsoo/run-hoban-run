import * as THREE from 'three';
import { clearGroup } from './scene-utils';

export type HelicopterVisualStatus = 'generated';

export function installHelicopterFallback(slot: THREE.Group) {
  clearGroup(slot);
  slot.userData.assetStatus = 'generated';
  slot.add(createMilitaryFallbackHelicopter());
}

export function installHelicopterVisual(slot: THREE.Group, shouldApply: () => boolean = () => true): Promise<HelicopterVisualStatus> {
  if (shouldApply() && slot.userData.assetStatus !== 'generated') {
    installHelicopterFallback(slot);
  }

  return Promise.resolve('generated');
}

export function createHelicopterSniperRig() {
  const group = new THREE.Group();
  const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.52 });
  const scopeMaterial = new THREE.MeshStandardMaterial({ color: 0x243447, roughness: 0.42 });

  group.position.set(1.64, -0.46, 0);

  const mount = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.18, 0.26), darkMaterial);
  mount.position.x = -0.1;
  mount.castShadow = true;
  group.add(mount);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 1.05, 10), darkMaterial);
  barrel.name = 'sniper-barrel';
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = 0.56;
  barrel.castShadow = true;
  group.add(barrel);

  const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.36, 10), scopeMaterial);
  scope.rotation.x = Math.PI / 2;
  scope.position.set(0, 0.12, 0.22);
  scope.castShadow = true;
  group.add(scope);

  return group;
}

export function createBulletMesh() {
  const material = new THREE.MeshBasicMaterial({ color: 0xfff1a6 });
  const bullet = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.48, 4, 10), material);
  bullet.visible = false;
  return bullet;
}

export function createMuzzleFlash() {
  const material = new THREE.MeshBasicMaterial({
    color: 0xffd166,
    transparent: true,
    opacity: 0.88,
    depthWrite: false
  });
  const flash = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.58, 12), material);
  flash.visible = false;
  return flash;
}

export function createImpactBurst() {
  const material = new THREE.MeshBasicMaterial({
    color: 0xff4141,
    transparent: true,
    opacity: 0.76,
    depthWrite: false
  });
  const burst = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 10), material);
  burst.visible = false;
  return burst;
}

export function spinHelicopterRotors(root: THREE.Object3D, time: number) {
  root.traverse((child) => {
    if (child.name === 'main-rotor') {
      child.rotation.y = time * 52;
    } else if (child.name === 'tail-rotor') {
      child.rotation.x = time * 68;
    }
  });
}

function createMilitaryFallbackHelicopter() {
  const group = new THREE.Group();
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x33422e, roughness: 0.78, metalness: 0.1 });
  const windowMaterial = new THREE.MeshStandardMaterial({ color: 0x6fa3b8, roughness: 0.28, metalness: 0.05 });
  const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.58, metalness: 0.16 });
  const camoMaterial = new THREE.MeshStandardMaterial({ color: 0x1f2c20, roughness: 0.86 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.58, 2.55, 8, 18), bodyMaterial);
  body.rotation.z = Math.PI / 2;
  body.scale.set(1.08, 0.9, 0.88);
  body.castShadow = true;
  group.add(body);

  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.5, 18, 12), windowMaterial);
  cockpit.position.x = 1.32;
  cockpit.scale.set(1.04, 0.7, 0.76);
  cockpit.castShadow = true;
  group.add(cockpit);

  const tail = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.18, 0.2), bodyMaterial);
  tail.position.x = -2;
  tail.castShadow = true;
  group.add(tail);

  const tailFin = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.82, 0.12), camoMaterial);
  tailFin.position.set(-2.88, 0.32, 0);
  tailFin.rotation.z = -0.18;
  tailFin.castShadow = true;
  group.add(tailFin);

  addRotorAssembly(group, darkMaterial);
  addMilitaryDetails(group, 1);

  return group;
}

function addMilitaryDetails(group: THREE.Group, scale: number) {
  const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.62, metalness: 0.16 });
  const podMaterial = new THREE.MeshStandardMaterial({ color: 0x263426, roughness: 0.74, metalness: 0.1 });
  const markerMaterial = new THREE.MeshBasicMaterial({ color: 0xd7e6ce });

  for (const side of [-1, 1]) {
    const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.13 * scale, 0.13 * scale, 0.88 * scale, 12), podMaterial);
    pod.rotation.z = Math.PI / 2;
    pod.position.set(0.18 * scale, -0.22 * scale, side * 0.72 * scale);
    pod.name = 'rocket-pod';
    pod.castShadow = true;
    group.add(pod);

    for (const offset of [-0.2, 0, 0.2]) {
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.028 * scale, 0.028 * scale, 0.92 * scale, 8), darkMaterial);
      tube.rotation.z = Math.PI / 2;
      tube.position.set(0.18 * scale, -0.22 * scale + offset * 0.12, side * 0.72 * scale + offset * 0.08);
      group.add(tube);
    }

    const skid = new THREE.Mesh(new THREE.CylinderGeometry(0.035 * scale, 0.035 * scale, 2.5 * scale, 8), darkMaterial);
    skid.rotation.z = Math.PI / 2;
    skid.position.set(-0.14 * scale, -0.82 * scale, side * 0.54 * scale);
    skid.name = 'landing-skid';
    skid.castShadow = true;
    group.add(skid);

    for (const x of [-0.92, 0.64]) {
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.022 * scale, 0.022 * scale, 0.72 * scale, 8), darkMaterial);
      strut.position.set(x * scale, -0.52 * scale, side * 0.54 * scale);
      strut.rotation.z = side > 0 ? 0.28 : -0.28;
      strut.castShadow = true;
      group.add(strut);
    }
  }

  const noseMarker = new THREE.Mesh(new THREE.BoxGeometry(0.08 * scale, 0.04 * scale, 0.44 * scale), markerMaterial);
  noseMarker.position.set(1.52 * scale, 0.18 * scale, 0);
  group.add(noseMarker);
}

function addRotorAssembly(group: THREE.Group, material = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.62, metalness: 0.16 })) {
  const bladeMaterial = new THREE.MeshBasicMaterial({
    color: 0x172217,
    transparent: true,
    opacity: 0.56,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const blurMaterial = new THREE.MeshBasicMaterial({
    color: 0x203022,
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const tailBlurMaterial = blurMaterial.clone();
  tailBlurMaterial.opacity = 0.32;

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.72, 10), material);
  mast.name = 'rotor-mast';
  mast.position.y = 0.88;
  mast.castShadow = true;
  group.add(mast);

  const rotorGroup = new THREE.Group();
  rotorGroup.name = 'main-rotor';
  rotorGroup.position.y = 1.24;
  group.add(rotorGroup);

  const rotorBlur = new THREE.Mesh(new THREE.CircleGeometry(1.86, 48), blurMaterial);
  rotorBlur.name = 'main-rotor-blur';
  rotorBlur.rotation.x = -Math.PI / 2;
  rotorGroup.add(rotorBlur);

  for (let index = 0; index < 3; index += 1) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(3.42, 0.018, 0.085), bladeMaterial);
    blade.name = 'main-rotor-blade';
    blade.rotation.y = (Math.PI / 3) * index;
    rotorGroup.add(blade);
  }

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.1, 14), material);
  hub.name = 'main-rotor-hub';
  hub.position.y = 0.02;
  hub.castShadow = true;
  rotorGroup.add(hub);

  const tailRotorGroup = new THREE.Group();
  tailRotorGroup.name = 'tail-rotor';
  tailRotorGroup.position.set(-3.12, 0.18, 0);
  group.add(tailRotorGroup);

  const tailRotorBlur = new THREE.Mesh(new THREE.CircleGeometry(0.44, 36), tailBlurMaterial);
  tailRotorBlur.name = 'tail-rotor-blur';
  tailRotorBlur.rotation.y = Math.PI / 2;
  tailRotorGroup.add(tailRotorBlur);

  for (let index = 0; index < 2; index += 1) {
    const tailBlade = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.82, 0.06), bladeMaterial);
    tailBlade.name = 'tail-rotor-blade';
    tailBlade.rotation.x = (Math.PI / 2) * index;
    tailRotorGroup.add(tailBlade);
  }
}
