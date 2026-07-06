import * as THREE from 'three';
import type { YutBoardGraph } from '../game/yutnori-board';

/** src/game/yutnori-board.ts의 gridPos(반지름 5짜리 단위 좌표)를 실제 월드 유닛으로 키우는 배율. */
export const YUTNORI_BOARD_SCALE = 1.6;

export function nodeWorldPosition(gridPos: [number, number]): THREE.Vector3 {
  return new THREE.Vector3(gridPos[0] * YUTNORI_BOARD_SCALE, 0, gridPos[1] * YUTNORI_BOARD_SCALE);
}

/** 보드 판 + 25개 칸 마커를 절차적으로 생성한다(외부 GLB 없음). */
export function buildYutnoriBoardScene(graph: YutBoardGraph): THREE.Group {
  const group = new THREE.Group();
  group.name = 'yutnori-board';

  const plateMaterial = new THREE.MeshStandardMaterial({ color: 0xffefd3, roughness: 0.82 });
  const plateRadius = YUTNORI_BOARD_SCALE * 5 + 1.3;
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(plateRadius, plateRadius, 0.3, 48), plateMaterial);
  plate.position.y = -0.16;
  plate.receiveShadow = true;
  group.add(plate);

  const outerMaterial = new THREE.MeshStandardMaterial({ color: 0xffc857, roughness: 0.55 });
  const cornerMaterial = new THREE.MeshStandardMaterial({ color: 0xff8faf, roughness: 0.42 });
  const diagonalMaterial = new THREE.MeshStandardMaterial({ color: 0x5ecfbc, roughness: 0.5 });
  const centerMaterial = new THREE.MeshStandardMaterial({ color: 0x9b87f5, roughness: 0.42 });

  for (const node of Object.values(graph)) {
    const material =
      node.kind === 'corner' ? cornerMaterial
      : node.kind === 'diagonal' ? diagonalMaterial
      : node.kind === 'center' ? centerMaterial
      : outerMaterial;
    const radius = node.kind === 'corner' || node.kind === 'center' ? 0.42 : 0.26;
    const marker = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.12, 20), material);
    const pos = nodeWorldPosition(node.gridPos);
    marker.position.set(pos.x, 0.02, pos.z);
    marker.receiveShadow = true;
    marker.name = `node-${node.id}`;
    group.add(marker);
  }

  return group;
}
