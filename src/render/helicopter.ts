import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MILITARY_HELICOPTER_ASSET_URL } from '../assets/helicopter';
import { clearGroup } from './scene-utils';

const loader = new GLTFLoader();

export function installHelicopterVisual(slot: THREE.Group): Promise<'loaded' | 'fallback'> {
  clearGroup(slot);
  slot.userData.assetStatus = 'fallback';
  slot.add(createMilitaryFallbackHelicopter());

  return new Promise((resolve) => {
    loader.load(
      MILITARY_HELICOPTER_ASSET_URL,
      (gltf) => {
        const model = createLoadedMilitaryHelicopter(gltf.scene);
        clearGroup(slot);
        slot.add(model);
        slot.userData.assetStatus = 'loaded';
        resolve('loaded');
      },
      undefined,
      (error) => {
        console.warn('Military helicopter asset failed to load. Keeping generated fallback.', error);
        resolve('fallback');
      }
    );
  });
}

export function createHelicopterSniperRig() {
  const group = new THREE.Group();
  const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.52 });
  const scopeMaterial = new THREE.MeshStandardMaterial({ color: 0x243447, roughness: 0.42 });

  group.position.set(0.25, -0.48, 0.15);

  const mount = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.18, 0.22), darkMaterial);
  mount.castShadow = true;
  group.add(mount);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 1.35, 10), darkMaterial);
  barrel.name = 'sniper-barrel';
  barrel.rotation.x = -Math.PI / 2;
  barrel.position.z = -0.72;
  barrel.castShadow = true;
  group.add(barrel);

  const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.36, 10), scopeMaterial);
  scope.rotation.x = Math.PI / 2;
  scope.position.set(0, 0.12, -0.2);
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

function createLoadedMilitaryHelicopter(source: THREE.Group) {
  const group = new THREE.Group();
  const model = source.clone(true);

  removeStaticRotorGeometry(model);
  normalizeModel(model);
  model.rotation.y = -Math.PI / 2;
  model.traverse((child) => {
    child.castShadow = true;
    child.receiveShadow = true;

    if (child instanceof THREE.Mesh) {
      child.material = toMilitaryMaterial(child.material);
    }
  });

  group.add(model);
  addRotorAssembly(group);
  addMilitaryDetails(group, 1);
  return group;
}

type GeometryComponentStats = {
  min: THREE.Vector3;
  max: THREE.Vector3;
  triangleCount: number;
};

function removeStaticRotorGeometry(model: THREE.Object3D) {
  model.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }

    const cleanedGeometry = createGeometryWithoutStaticRotors(child.geometry);

    if (cleanedGeometry) {
      child.geometry.dispose();
      child.geometry = cleanedGeometry;
    }
  });
}

function createGeometryWithoutStaticRotors(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute('position');

  if (!(position instanceof THREE.BufferAttribute) || position.count < 3) {
    return null;
  }

  const componentRemoval = geometry.index ? createRotorComponentRemoval(geometry.index, position) : null;
  const copiedAttributes = new Map<string, number[]>();
  const attributeNames = Object.keys(geometry.attributes);
  const index = geometry.index;
  const triangleVertexCount = index?.count ?? position.count;
  let removedFaceCount = 0;

  attributeNames.forEach((name) => copiedAttributes.set(name, []));

  for (let vertexOffset = 0; vertexOffset < triangleVertexCount; vertexOffset += 3) {
    const vertexIndices = [
      index ? index.getX(vertexOffset) : vertexOffset,
      index ? index.getX(vertexOffset + 1) : vertexOffset + 1,
      index ? index.getX(vertexOffset + 2) : vertexOffset + 2
    ];
    const points = vertexIndices.map((vertexIndex) => readPosition(position, vertexIndex));
    const isStaticRotor = componentRemoval
      ? componentRemoval.removedRoots.has(componentRemoval.rootByVertex[vertexIndices[0]])
      : isStaticRotorTriangle(points);

    if (isStaticRotor) {
      removedFaceCount += 1;
      continue;
    }

    for (const name of attributeNames) {
      const attribute = geometry.getAttribute(name);
      const values = copiedAttributes.get(name);

      if (!values) {
        continue;
      }

      for (let triangleVertexOffset = 0; triangleVertexOffset < 3; triangleVertexOffset += 1) {
        for (let itemOffset = 0; itemOffset < attribute.itemSize; itemOffset += 1) {
          values.push(attribute.getComponent(vertexIndices[triangleVertexOffset], itemOffset));
        }
      }
    }
  }

  if (removedFaceCount === 0) {
    return null;
  }

  const cleanedGeometry = new THREE.BufferGeometry();

  for (const name of attributeNames) {
    const sourceAttribute = geometry.getAttribute(name);
    const values = copiedAttributes.get(name) ?? [];
    cleanedGeometry.setAttribute(name, new THREE.BufferAttribute(new Float32Array(values), sourceAttribute.itemSize, sourceAttribute.normalized));
  }

  cleanedGeometry.computeBoundingBox();
  cleanedGeometry.computeBoundingSphere();

  return cleanedGeometry;
}

function createRotorComponentRemoval(index: THREE.BufferAttribute, position: THREE.BufferAttribute) {
  const parent = new Int32Array(position.count);

  for (let vertexIndex = 0; vertexIndex < parent.length; vertexIndex += 1) {
    parent[vertexIndex] = vertexIndex;
  }

  const find = (vertexIndex: number) => {
    let root = vertexIndex;

    while (parent[root] !== root) {
      root = parent[root];
    }

    while (parent[vertexIndex] !== vertexIndex) {
      const next = parent[vertexIndex];
      parent[vertexIndex] = root;
      vertexIndex = next;
    }

    return root;
  };

  const union = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);

    if (leftRoot !== rightRoot) {
      parent[rightRoot] = leftRoot;
    }
  };

  for (let indexOffset = 0; indexOffset < index.count; indexOffset += 3) {
    const first = index.getX(indexOffset);
    const second = index.getX(indexOffset + 1);
    const third = index.getX(indexOffset + 2);

    union(first, second);
    union(first, third);
  }

  const rootByVertex = new Int32Array(position.count);
  const statsByRoot = new Map<number, GeometryComponentStats>();

  for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex += 1) {
    const root = find(vertexIndex);
    rootByVertex[vertexIndex] = root;

    let stats = statsByRoot.get(root);

    if (!stats) {
      stats = {
        min: new THREE.Vector3(Infinity, Infinity, Infinity),
        max: new THREE.Vector3(-Infinity, -Infinity, -Infinity),
        triangleCount: 0
      };
      statsByRoot.set(root, stats);
    }

    const point = readPosition(position, vertexIndex);
    stats.min.min(point);
    stats.max.max(point);
  }

  for (let indexOffset = 0; indexOffset < index.count; indexOffset += 3) {
    const root = rootByVertex[index.getX(indexOffset)];
    const stats = statsByRoot.get(root);

    if (stats) {
      stats.triangleCount += 1;
    }
  }

  const removedRoots = new Set<number>();

  statsByRoot.forEach((stats, root) => {
    if (isStaticRotorComponent(stats)) {
      removedRoots.add(root);
    }
  });

  return { rootByVertex, removedRoots };
}

function isStaticRotorComponent(stats: GeometryComponentStats) {
  const size = new THREE.Vector3().subVectors(stats.max, stats.min);
  const isMainRotorBlade =
    stats.min.y > 0.165 &&
    size.y < 0.05 &&
    (size.x > 0.035 || size.z > 0.035);
  const isTailRotorBlade =
    stats.min.z < -0.36 &&
    stats.max.z < -0.33 &&
    size.x < 0.07 &&
    size.y > 0.07 &&
    size.z < 0.17 &&
    stats.min.y < 0.09;
  const isUpperRotorFragment = stats.max.y > 0.175 && stats.min.y > 0.11 && size.y < 0.08;

  return isMainRotorBlade || isTailRotorBlade || isUpperRotorFragment;
}

function isStaticRotorTriangle(points: ReturnType<typeof readPosition>[]) {
  const min = new THREE.Vector3(
    Math.min(...points.map((point) => point.x)),
    Math.min(...points.map((point) => point.y)),
    Math.min(...points.map((point) => point.z))
  );
  const max = new THREE.Vector3(
    Math.max(...points.map((point) => point.x)),
    Math.max(...points.map((point) => point.y)),
    Math.max(...points.map((point) => point.z))
  );
  const stats = {
    min,
    max,
    triangleCount: 1
  };

  return isStaticRotorComponent(stats);
}

function readPosition(position: THREE.BufferAttribute, index: number) {
  return {
    x: position.getX(index),
    y: position.getY(index),
    z: position.getZ(index)
  };
}

function normalizeModel(model: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const horizontalSize = Math.max(size.x, size.z, 0.001);
  const scale = 4.55 / horizontalSize;

  model.scale.setScalar(scale);
  model.position.sub(center.multiplyScalar(scale));
  model.position.y += 0.08;
}

function toMilitaryMaterial(material: THREE.Material | THREE.Material[]): THREE.Material | THREE.Material[] {
  if (Array.isArray(material)) {
    return material.map((item) => toMilitaryMaterial(item)) as THREE.Material[];
  }

  material.dispose();

  return new THREE.MeshStandardMaterial({
    color: 0x2f3d2f,
    roughness: 0.82,
    metalness: 0.08
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

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.46, 10), material);
  mast.name = 'rotor-mast';
  mast.position.y = 0.7;
  mast.castShadow = true;
  group.add(mast);

  const rotorGroup = new THREE.Group();
  rotorGroup.name = 'main-rotor';
  rotorGroup.position.y = 0.94;
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
  tailRotorGroup.position.set(-2.98, 0.22, 0);
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
