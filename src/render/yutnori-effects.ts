import * as THREE from 'three';

interface Particle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  max: number;
  spin: THREE.Vector3;
}

/** 윷놀이/전략윷놀이 공용 3D 이펙트 레이어.
 *  - 잡기/홈인 파티클 버스트
 *  - 분기(코너)에서 외곽/지름길 두 방향 화살표
 *  각 페이지의 animate 루프에서 매 프레임 update(delta)를 호출한다. */
export class YutnoriFx {
  private fxGroup = new THREE.Group();
  private particles: Particle[] = [];
  private branch: THREE.Group | null = null;
  private branchKey: string | null = null;

  constructor(scene: THREE.Scene) {
    this.fxGroup.name = 'yut-fx';
    scene.add(this.fxGroup);
  }

  private burst(pos: THREE.Vector3, colors: number[], count: number, power: number, spread: number) {
    for (let i = 0; i < count; i += 1) {
      const color = colors[i % colors.length];
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(0.16, 0.16),
        new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true }),
      );
      mesh.position.set(pos.x, pos.y + 0.2, pos.z);
      const angle = Math.random() * Math.PI * 2;
      const horiz = spread * (0.4 + Math.random());
      const vel = new THREE.Vector3(
        Math.cos(angle) * horiz,
        power * (0.5 + Math.random() * 0.6),
        Math.sin(angle) * horiz,
      );
      const max = 0.6 + Math.random() * 0.5;
      this.particles.push({
        mesh,
        vel,
        life: max,
        max,
        spin: new THREE.Vector3((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10),
      });
      this.fxGroup.add(mesh);
    }
  }

  /** 잡기: 붉은 파편이 사방으로 튄다. */
  captureBurst(pos: THREE.Vector3) {
    this.burst(pos, [0xff6f6f, 0xffb0a0, 0xffffff], 16, 4.4, 2.2);
  }

  /** 홈인: 알록달록 축하 파티클. */
  homeBurst(pos: THREE.Vector3) {
    this.burst(pos, [0x8ff0b0, 0xffd257, 0xff8faf, 0x9b87f5, 0xffffff], 28, 5.2, 1.8);
  }

  private makeArrow(pos: THREE.Vector3, color: number): THREE.Mesh {
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.3, 0.66, 6),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.92 }),
    );
    cone.position.set(pos.x, 1.15, pos.z);
    cone.rotation.x = Math.PI; // 뾰족한 끝이 칸을 아래로 가리키게
    cone.name = 'branch-arrow';
    return cone;
  }

  /** 분기 화살표: 외곽 방향(금색)과 지름길 방향(민트)을 두 후보 칸 위에 띄운다.
   *  같은 코너(key)면 재생성하지 않는다. */
  showBranch(key: string, straightPos: THREE.Vector3, shortcutPos: THREE.Vector3 | null) {
    if (this.branchKey === key) return;
    this.clearBranch();
    const g = new THREE.Group();
    g.name = 'branch-arrows';
    g.add(this.makeArrow(straightPos, 0xffc857));
    if (shortcutPos) g.add(this.makeArrow(shortcutPos, 0x5ecfbc));
    this.branch = g;
    this.branchKey = key;
    this.fxGroup.add(g);
  }

  clearBranch() {
    if (!this.branch) return;
    this.branch.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) (m.material as THREE.Material).dispose();
    });
    this.fxGroup.remove(this.branch);
    this.branch = null;
    this.branchKey = null;
  }

  update(delta: number) {
    const gravity = 8.5;
    for (let i = this.particles.length - 1; i >= 0; i -= 1) {
      const p = this.particles[i];
      p.life -= delta;
      if (p.life <= 0) {
        this.fxGroup.remove(p.mesh);
        p.mesh.geometry.dispose();
        (p.mesh.material as THREE.Material).dispose();
        this.particles.splice(i, 1);
        continue;
      }
      p.vel.y -= gravity * delta;
      p.mesh.position.addScaledVector(p.vel, delta);
      p.mesh.rotation.x += p.spin.x * delta;
      p.mesh.rotation.y += p.spin.y * delta;
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.min(1, p.life / (p.max * 0.55));
    }
    if (this.branch) {
      const now = performance.now();
      const s = 1 + Math.sin(now * 0.006) * 0.16;
      const y = 1.15 + Math.sin(now * 0.005) * 0.12;
      for (const c of this.branch.children) {
        c.scale.setScalar(s);
        c.position.y = y;
      }
    }
  }
}
