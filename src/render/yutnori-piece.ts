import * as THREE from 'three';

export const YUT_PLAYER_COLORS = [0xe8543f, 0x3d6fd6, 0xf6c445, 0x4a8f4f];

/** 캐주얼 마스코트형 저폴리 말(윷놀이 피스) 모델. 절차형 프리미티브만 사용(외부 GLB 없음).
 * 구조: group(위치 lerp 대상)
 *        ├ yut-piece-inner (몸체 — 선택 가능 표시용 bounce를 여기에 적용)
 *        └ yut-piece-halo  (선택 가능할 때만 보이는 강조 링) */
export function createYutPieceMesh(playerIndex: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'yut-piece';

  const color = YUT_PLAYER_COLORS[playerIndex % YUT_PLAYER_COLORS.length];
  const bodyMaterial = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.08 });
  const creamMaterial = new THREE.MeshStandardMaterial({ color: 0xfff6e0, roughness: 0.42 });
  const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x2f2531, roughness: 0.45 });
  const hoofMaterial = new THREE.MeshStandardMaterial({ color: 0x6b4b38, roughness: 0.55 });

  const inner = new THREE.Group();
  inner.name = 'yut-piece-inner';

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.34, 18, 12), bodyMaterial);
  body.scale.set(1.25, 0.72, 0.82);
  body.position.y = 0.34;
  body.castShadow = true;
  inner.add(body);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, 0.34, 10), bodyMaterial);
  neck.position.set(0, 0.56, -0.23);
  neck.rotation.x = -0.42;
  neck.castShadow = true;
  inner.add(neck);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), bodyMaterial);
  head.scale.set(0.86, 1.0, 1.12);
  head.position.set(0, 0.75, -0.39);
  head.castShadow = true;
  inner.add(head);

  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), creamMaterial);
  muzzle.scale.set(0.9, 0.62, 1.1);
  muzzle.position.set(0, 0.71, -0.56);
  muzzle.castShadow = true;
  inner.add(muzzle);

  [-0.08, 0.08].forEach((x) => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), darkMaterial);
    eye.position.set(x, 0.79, -0.59);
    inner.add(eye);

    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.14, 7), bodyMaterial);
    ear.position.set(x * 1.35, 0.93, -0.39);
    ear.rotation.x = x < 0 ? -0.2 : 0.2;
    ear.castShadow = true;
    inner.add(ear);
  });

  const mane = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.25, 0.06), darkMaterial);
  mane.position.set(0, 0.66, -0.25);
  mane.rotation.x = -0.34;
  mane.castShadow = true;
  inner.add(mane);

  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.28, 8), darkMaterial);
  tail.position.set(0, 0.42, 0.42);
  tail.rotation.x = Math.PI / 2.7;
  tail.castShadow = true;
  inner.add(tail);

  [
    [-0.18, -0.2],
    [0.18, -0.2],
    [-0.18, 0.22],
    [0.18, 0.22],
  ].forEach(([x, z]) => {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.052, 0.3, 8), hoofMaterial);
    leg.position.set(x, 0.12, z);
    leg.castShadow = true;
    inner.add(leg);

    const hoof = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 0.08), darkMaterial);
    hoof.position.set(x, -0.04, z - 0.01);
    hoof.castShadow = true;
    inner.add(hoof);
  });

  group.add(inner);

  // 선택 가능할 때만 켜지는 강조 링. 보드 바닥에 눕혀두고 main의 animate()에서 pulse/visible을 제어한다.
  const haloMaterial = new THREE.MeshBasicMaterial({ color: 0xffd257, transparent: true, opacity: 0.92 });
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.055, 10, 28), haloMaterial);
  halo.name = 'yut-piece-halo';
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 0.03;
  halo.visible = false;
  group.add(halo);

  return group;
}
