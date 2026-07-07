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
  const capMaterial = new THREE.MeshStandardMaterial({ color: 0xfff6e0, roughness: 0.35 });

  const inner = new THREE.Group();
  inner.name = 'yut-piece-inner';

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.27, 0.38, 16), bodyMaterial);
  body.position.y = 0.19;
  body.castShadow = true;
  inner.add(body);

  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), capMaterial);
  cap.position.y = 0.42;
  cap.castShadow = true;
  inner.add(cap);

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
