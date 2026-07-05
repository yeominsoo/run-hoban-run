import * as THREE from 'three';

export const YUT_PLAYER_COLORS = [0xe8543f, 0x3d6fd6, 0xf6c445, 0x4a8f4f];

/** 캐주얼 마스코트형 저폴리 말(윷놀이 피스) 모델. 절차형 프리미티브만 사용(외부 GLB 없음). */
export function createYutPieceMesh(playerIndex: number): THREE.Group {
  const group = new THREE.Group();
  group.name = 'yut-piece';

  const color = YUT_PLAYER_COLORS[playerIndex % YUT_PLAYER_COLORS.length];
  const bodyMaterial = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.08 });
  const capMaterial = new THREE.MeshStandardMaterial({ color: 0xfff6e0, roughness: 0.35 });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.27, 0.38, 16), bodyMaterial);
  body.position.y = 0.19;
  body.castShadow = true;
  group.add(body);

  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), capMaterial);
  cap.position.y = 0.42;
  cap.castShadow = true;
  group.add(cap);

  return group;
}
