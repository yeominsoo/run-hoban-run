import * as THREE from 'three';
import type { YutBoardGraph } from '../game/yutnori-board';

/** src/game/yutnori-board.ts의 gridPos(사각 윷판 좌표)를 실제 월드 유닛으로 키우는 배율. */
export const YUTNORI_BOARD_SCALE = 1.6;

export function nodeWorldPosition(gridPos: [number, number]): THREE.Vector3 {
  return new THREE.Vector3(gridPos[0] * YUTNORI_BOARD_SCALE, 0, gridPos[1] * YUTNORI_BOARD_SCALE);
}

/** 보드 판 + 29개 칸 마커를 절차적으로 생성한다(외부 GLB 없음). */
export function buildYutnoriBoardScene(graph: YutBoardGraph): THREE.Group {
  const group = new THREE.Group();
  group.name = 'yutnori-board';

  const plateMaterial = new THREE.MeshStandardMaterial({ color: 0xffefd3, roughness: 0.82 });
  const plateSize = YUTNORI_BOARD_SCALE * 10 + 2.1;
  const plate = new THREE.Mesh(new THREE.BoxGeometry(plateSize, 0.3, plateSize), plateMaterial);
  plate.position.y = -0.16;
  plate.receiveShadow = true;
  group.add(plate);

  const lineMaterial = new THREE.LineBasicMaterial({ color: 0x2d7fb8, transparent: true, opacity: 0.82 });
  const addLine = (fromId: string, toId: string) => {
    const from = graph[fromId];
    const to = graph[toId];
    if (!from || !to) return;
    const a = nodeWorldPosition(from.gridPos);
    const b = nodeWorldPosition(to.gridPos);
    a.y = 0.035;
    b.y = 0.035;
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), lineMaterial);
    line.name = `edge-${fromId}-${toId}`;
    group.add(line);
  };

  for (const node of Object.values(graph)) {
    if (node.kind !== 'center') addLine(node.id, node.next);
    if (node.shortcutNext) addLine(node.id, node.shortcutNext);
  }

  const outerMaterial = new THREE.MeshStandardMaterial({ color: 0x9bc8ea, roughness: 0.55 });
  const cornerMaterial = new THREE.MeshStandardMaterial({ color: 0xff6363, roughness: 0.42 });
  const diagonalMaterial = new THREE.MeshStandardMaterial({ color: 0x9bc8ea, roughness: 0.5 });
  const centerMaterial = new THREE.MeshStandardMaterial({ color: 0xff6363, roughness: 0.42 });

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
