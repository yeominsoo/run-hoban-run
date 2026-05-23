import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  createSampleParticipants,
  runTournament,
  type HazardEvent,
  type HorseProfile,
  type RaceOptions,
  type RacePlacement,
  type RaceResult,
  type SkillPose,
  type SpeedSegment,
  type TournamentResult
} from './game/rules';
import './style.css';

type RiderParts = {
  root: THREE.Group;
  torso: THREE.Mesh;
  head: THREE.Mesh;
  leftArm: THREE.Mesh;
  rightArm: THREE.Mesh;
  leftLeg: THREE.Mesh;
  rightLeg: THREE.Mesh;
};

type VisualRunner = {
  placement: RacePlacement;
  mesh: THREE.Group;
  label: HTMLDivElement;
  lane: number;
  phase: number;
  baseScale: number;
  skillActive: boolean;
  eliminated: boolean;
};

type LeaderboardItemParts = {
  item: HTMLLIElement;
  rank: HTMLSpanElement;
  name: HTMLElement;
  detail: HTMLElement;
};

type HorseMotionStyle = 'rush' | 'run' | 'walk' | 'stroll';

type HorseLegParts = {
  hip: THREE.Group;
  knee: THREE.Group;
  hoof: THREE.Group;
  upperBaseRotation: number;
  lowerBaseRotation: number;
  hoofBaseRotation: number;
  hipBaseX: number;
  hipBaseY: number;
  phase: number;
};

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('앱 루트를 찾을 수 없습니다.');
}

app.innerHTML = `
  <main class="shell">
    <section class="race-stage" id="race-stage">
      <canvas id="race-canvas"></canvas>
      <div class="hud hud-top">
        <div class="title-block">
          <p class="eyebrow" id="race-meta">룰 기반 3D 경주</p>
          <h1>달려라 호반</h1>
        </div>
        <div class="top-actions">
          <button class="icon-button" id="toggle-panels" type="button" aria-label="패널 열고 닫기">
            <span aria-hidden="true">☰</span>
          </button>
          <button class="icon-button" id="replay-race" type="button" aria-label="경기 다시 보기">
            <span aria-hidden="true">↻</span>
          </button>
          <button class="icon-button" id="next-race" type="button" aria-label="다음 경기">
            <span aria-hidden="true">›</span>
          </button>
        </div>
      </div>

      <aside class="control-panel">
        <div class="panel-section">
          <div class="section-title">참가자</div>
          <textarea id="participants" spellcheck="false"></textarea>
          <div class="button-row">
            <button id="sample-18" type="button">18</button>
            <button id="sample-64" type="button">64</button>
            <button id="start-tournament" type="button">시작</button>
          </div>
        </div>

        <div class="panel-section option-grid">
          <div class="seed-control">
            <label>
              <span>시드</span>
              <input id="seed-input" value="호반-2026" />
            </label>
            <button id="random-seed" type="button">랜덤</button>
          </div>
          <label>
            <span>출전</span>
            <input id="field-size" type="number" min="2" max="18" value="18" />
          </label>
          <label>
            <span>진출</span>
            <input id="qualifiers" type="number" min="1" max="17" value="2" />
          </label>
          <label>
            <span>우승</span>
            <input id="winner-count" type="number" min="1" max="18" value="1" />
          </label>
          <label>
            <span>주로</span>
            <select id="surface-select">
              <option value="turf">잔디</option>
              <option value="dirt">더트</option>
            </select>
          </label>
          <label>
            <span>거리</span>
            <select id="distance-select">
              <option value="sprint">단거리</option>
              <option value="mile" selected>마일</option>
              <option value="medium">중거리</option>
              <option value="long">장거리</option>
            </select>
          </label>
          <label>
            <span>상태</span>
            <select id="condition-select">
              <option value="firm">양호</option>
              <option value="damp">다습</option>
              <option value="muddy">불량</option>
            </select>
          </label>
        </div>
      </aside>

      <aside class="race-panel">
        <div class="panel-section">
          <div class="section-title" id="race-title">경기</div>
          <div id="race-summary" class="race-summary"></div>
        </div>
        <div class="panel-section">
          <div class="section-title">결과</div>
          <ol id="result-list" class="result-list"></ol>
        </div>
      </aside>

      <div class="hud hud-bottom">
        <ol id="leaderboard" class="leaderboard"></ol>
      </div>
    </section>
  </main>
`;

function query<T extends Element>(selector: string) {
  const element = document.querySelector<T>(selector);

  if (!element) {
    throw new Error(`화면 요소를 찾을 수 없습니다: ${selector}`);
  }

  return element;
}

const raceCanvas = query<HTMLCanvasElement>('#race-canvas');
const raceStage = query<HTMLElement>('#race-stage');
const leaderboardList = query<HTMLOListElement>('#leaderboard');
const participantInput = query<HTMLTextAreaElement>('#participants');
const seedInput = query<HTMLInputElement>('#seed-input');
const fieldSizeInput = query<HTMLInputElement>('#field-size');
const qualifiersInput = query<HTMLInputElement>('#qualifiers');
const winnerCountInput = query<HTMLInputElement>('#winner-count');
const surfaceSelect = query<HTMLSelectElement>('#surface-select');
const distanceSelect = query<HTMLSelectElement>('#distance-select');
const conditionSelect = query<HTMLSelectElement>('#condition-select');
const sample18Button = query<HTMLButtonElement>('#sample-18');
const sample64Button = query<HTMLButtonElement>('#sample-64');
const startButton = query<HTMLButtonElement>('#start-tournament');
const randomSeedButton = query<HTMLButtonElement>('#random-seed');
const togglePanelsButton = query<HTMLButtonElement>('#toggle-panels');
const replayButton = query<HTMLButtonElement>('#replay-race');
const nextButton = query<HTMLButtonElement>('#next-race');
const raceMeta = query<HTMLParagraphElement>('#race-meta');
const raceTitle = query<HTMLDivElement>('#race-title');
const raceSummary = query<HTMLDivElement>('#race-summary');
const resultList = query<HTMLOListElement>('#result-list');
const SURFACE_LABELS: Record<RaceOptions['surface'], string> = {
  turf: '잔디',
  dirt: '더트'
};
const DISTANCE_LABELS: Record<RaceOptions['distance'], string> = {
  sprint: '단거리',
  mile: '마일',
  medium: '중거리',
  long: '장거리'
};
const CONDITION_LABELS: Record<RaceOptions['condition'], string> = {
  firm: '양호',
  damp: '다습',
  muddy: '불량'
};

participantInput.value = createSampleParticipants(18).join('\n');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb8d9ff);
scene.fog = new THREE.Fog(0xb8d9ff, 95, 360);

const renderer = new THREE.WebGLRenderer({
  canvas: raceCanvas,
  antialias: true,
  preserveDrawingBuffer: true
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 520);
camera.position.set(0, 18, 32);
camera.lookAt(0, 0, 0);

const ambientLight = new THREE.HemisphereLight(0xffffff, 0x6d7768, 2.2);
scene.add(ambientLight);

const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.position.set(-20, 30, 16);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);

const clock = new THREE.Clock();
const raceLength = 276;
const raceWidth = 18.4;
const trackVisualLength = raceLength + 60;
const trackVisualWidth = raceWidth + 1.8;
const groundLength = trackVisualLength + 80;
const groundWidth = trackVisualWidth + 30;
const startX = -raceLength / 2 + 8;
const finishX = raceLength / 2 - 7;
const horseBaseY = 1.45;
const helicopterEntranceSeconds = 3;
let raceElapsed = 0;
let raceFinished = false;
let raceStarted = false;
let tournament: TournamentResult | null = null;
let currentRaceIndex = 0;
let visualRunners: VisualRunner[] = [];
let helicopterAsset: THREE.Group | null = null;
let helicopterAssetLoadStarted = false;
let selectedCameraEntryId = 'leader';
let cameraSelectionLocked = false;
const cameraLookTarget = new THREE.Vector3();
const leaderboardItems = new Map<string, LeaderboardItemParts>();

const runnerLabels = document.createElement('div');
runnerLabels.className = 'runner-labels';
app.appendChild(runnerLabels);

const laneGuideGroup = new THREE.Group();
scene.add(laneGuideGroup);

const helicopterGroup = new THREE.Group();
const helicopterAssetSlot = new THREE.Group();
const helicopterSniperRig = createHelicopterSniperRig();
const bulletMesh = createBulletMesh();
const muzzleFlash = createMuzzleFlash();
const impactBurst = createImpactBurst();
helicopterGroup.visible = false;
helicopterGroup.add(helicopterAssetSlot, helicopterSniperRig);
scene.add(helicopterGroup);
scene.add(bulletMesh, muzzleFlash, impactBurst);

const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x4d9d55, roughness: 0.9 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(groundLength, groundWidth), groundMaterial);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const track = new THREE.Mesh(
  new THREE.BoxGeometry(trackVisualLength, 0.18, trackVisualWidth),
  new THREE.MeshStandardMaterial({ color: 0xc77443, roughness: 0.82 })
);
track.position.y = 0.03;
track.receiveShadow = true;
scene.add(track);

const finishLine = new THREE.Mesh(
  new THREE.BoxGeometry(0.5, 0.1, trackVisualWidth + 0.8),
  new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 })
);
finishLine.position.set(finishX, 0.22, 0);
scene.add(finishLine);

makeRail(-(trackVisualWidth / 2 + 1.1));
makeRail(trackVisualWidth / 2 + 1.1);

function makeRail(z: number) {
  const group = new THREE.Group();
  const start = -trackVisualLength / 2;
  const end = trackVisualLength / 2;

  for (let x = start; x <= end; x += 4.5) {
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.08, 1.4, 8),
      new THREE.MeshStandardMaterial({ color: 0x2f4753, roughness: 0.6 })
    );
    post.position.set(x, 0.72, z);
    post.castShadow = true;
    group.add(post);
  }

  const rail = new THREE.Mesh(
    new THREE.BoxGeometry(trackVisualLength, 0.14, 0.14),
    new THREE.MeshStandardMaterial({ color: 0x2f4753, roughness: 0.6 })
  );
  rail.position.set(0, 1.35, z);
  rail.castShadow = true;
  group.add(rail);
  scene.add(group);
}

function loadHelicopterAsset() {
  if (helicopterAssetLoadStarted) {
    return;
  }

  helicopterAssetLoadStarted = true;

  const loader = new GLTFLoader();
  loader.load(
    '/models/helicopter.glb',
    (gltf) => {
      helicopterAsset = normalizeHelicopterModel(gltf.scene);
      installHelicopterVisual();
    },
    undefined,
    () => {
      installHelicopterVisual();
    }
  );
}

function scheduleHelicopterAssetLoad() {
  installHelicopterVisual();

  const startLoad = () => {
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(() => loadHelicopterAsset(), { timeout: 2500 });
      return;
    }

    globalThis.setTimeout(loadHelicopterAsset, 1000);
  };

  if (document.readyState === 'complete') {
    startLoad();
    return;
  }

  window.addEventListener('load', startLoad, { once: true });
}

function installHelicopterVisual() {
  clearGroup(helicopterAssetSlot);
  const model = helicopterAsset ? helicopterAsset.clone(true) : createFallbackHelicopter();
  helicopterAssetSlot.add(model);
}

function normalizeHelicopterModel(model: THREE.Group) {
  const normalized = model.clone(true);
  const box = new THREE.Box3().setFromObject(normalized);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z) || 1;
  normalized.position.sub(center);
  normalized.scale.setScalar(4.4 / maxDimension);
  normalized.rotation.y = Math.PI / 2;
  normalized.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  return normalized;
}

function createFallbackHelicopter() {
  const group = new THREE.Group();
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xc2413a, roughness: 0.55 });
  const windowMaterial = new THREE.MeshStandardMaterial({ color: 0x9ed8ff, roughness: 0.25 });
  const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.5 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 2.3, 8, 16), bodyMaterial);
  body.rotation.z = Math.PI / 2;
  body.castShadow = true;
  group.add(body);

  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.48, 16, 10), windowMaterial);
  cockpit.position.x = 1.18;
  cockpit.scale.set(1.1, 0.72, 0.72);
  cockpit.castShadow = true;
  group.add(cockpit);

  const tail = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.16, 0.16), bodyMaterial);
  tail.position.x = -1.85;
  tail.castShadow = true;
  group.add(tail);

  const rotor = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.04, 0.18), darkMaterial);
  rotor.name = 'main-rotor';
  rotor.position.y = 0.72;
  group.add(rotor);

  const tailRotor = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.92, 0.12), darkMaterial);
  tailRotor.name = 'tail-rotor';
  tailRotor.position.x = -2.78;
  group.add(tailRotor);

  return group;
}

function createHelicopterSniperRig() {
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

function createBulletMesh() {
  const material = new THREE.MeshBasicMaterial({ color: 0xfff1a6 });
  const bullet = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.48, 4, 10), material);
  bullet.visible = false;
  return bullet;
}

function createMuzzleFlash() {
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

function createImpactBurst() {
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

function createHorse(profile: HorseProfile) {
  const group = new THREE.Group();
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: profile.color, roughness: 0.58 });
  const accentMaterial = new THREE.MeshStandardMaterial({ color: profile.secondaryColor, roughness: 0.68 });
  const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x2d2020, roughness: 0.7 });
  const saddleMaterial = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.5 });
  const effectMaterial = new THREE.MeshBasicMaterial({
    color: profile.secondaryColor,
    transparent: true,
    opacity: 0.62,
    side: THREE.DoubleSide
  });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.7, 1.95, 8, 16), bodyMaterial);
  body.rotation.z = Math.PI / 2;
  body.scale.set(1.32, 0.98, 0.9);
  body.castShadow = true;
  group.add(body);

  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.66, 18, 12), bodyMaterial);
  chest.position.set(0.78, 0.18, 0);
  chest.scale.set(1.04, 1.12, 0.95);
  chest.castShadow = true;
  group.add(chest);

  const haunch = new THREE.Mesh(new THREE.SphereGeometry(0.72, 18, 12), bodyMaterial);
  haunch.position.set(-0.82, 0.14, 0);
  haunch.scale.set(1.12, 1.02, 0.98);
  haunch.castShadow = true;
  group.add(haunch);

  const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 10), accentMaterial);
  shoulder.position.set(0.58, 0.2, 0.52);
  shoulder.scale.set(0.72, 1.1, 0.32);
  shoulder.castShadow = true;
  group.add(shoulder);

  const hip = shoulder.clone();
  hip.position.set(-0.86, 0.18, -0.52);
  hip.castShadow = true;
  group.add(hip);

  const neck = new THREE.Mesh(new THREE.CapsuleGeometry(0.31, 1.02, 6, 12), bodyMaterial);
  neck.rotation.z = -0.48;
  neck.position.set(1.08, 0.82, 0);
  neck.castShadow = true;
  group.add(neck);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.46, 18, 12), bodyMaterial);
  head.scale.set(1.34, 0.82, 0.78);
  head.position.set(1.58, 1.18, 0);
  head.castShadow = true;
  group.add(head);

  addPattern(group, profile.pattern, accentMaterial);

  const mane = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.92, 0.18), darkMaterial);
  mane.rotation.z = -0.5;
  mane.position.set(0.88, 1.14, 0);
  mane.castShadow = true;
  group.add(mane);

  const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.16, 0.86), saddleMaterial);
  saddle.position.set(-0.1, 0.9, 0);
  saddle.castShadow = true;
  group.add(saddle);

  const rider = createRider(profile.secondaryColor);
  group.add(rider.root);

  const legParts: HorseLegParts[] = [];
  const motionStyles: HorseMotionStyle[] = ['rush', 'run', 'walk', 'stroll'];
  const motionStyle = motionStyles[getStableIndex(profile.id, motionStyles.length)] ?? 'run';

  for (const x of [-0.78, 0.58]) {
    for (const z of [-0.38, 0.38]) {
      const upperBaseRotation = x < 0 ? -0.08 : 0.08;
      const lowerBaseRotation = x < 0 ? 0.12 : -0.12;
      const hoofBaseRotation = x < 0 ? -0.03 : 0.03;
      const hipJoint = new THREE.Group();
      hipJoint.position.set(x, 0.02, z);
      hipJoint.rotation.z = upperBaseRotation;
      group.add(hipJoint);

      const upperLeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.66, 5, 10), bodyMaterial);
      upperLeg.position.set(0, -0.34, 0);
      upperLeg.castShadow = true;
      hipJoint.add(upperLeg);

      const kneeJoint = new THREE.Group();
      kneeJoint.position.set(x < 0 ? -0.05 : 0.05, -0.7, 0);
      kneeJoint.rotation.z = lowerBaseRotation;
      hipJoint.add(kneeJoint);

      const knee = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), bodyMaterial);
      knee.scale.set(0.85, 0.72, 0.85);
      knee.castShadow = true;
      kneeJoint.add(knee);

      const lowerLeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.62, 4, 8), darkMaterial);
      lowerLeg.position.set(x < 0 ? -0.02 : 0.02, -0.35, 0);
      lowerLeg.castShadow = true;
      kneeJoint.add(lowerLeg);

      const hoofJoint = new THREE.Group();
      hoofJoint.position.set(x < 0 ? -0.04 : 0.04, -0.69, 0);
      hoofJoint.rotation.z = hoofBaseRotation;
      kneeJoint.add(hoofJoint);

      const hoof = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, 0.18), darkMaterial);
      hoof.position.set(0.08, -0.02, 0);
      hoof.castShadow = true;
      hoofJoint.add(hoof);
      legParts.push({
        hip: hipJoint,
        knee: kneeJoint,
        hoof: hoofJoint,
        upperBaseRotation,
        lowerBaseRotation,
        hoofBaseRotation,
        hipBaseX: hipJoint.position.x,
        hipBaseY: hipJoint.position.y,
        phase: (x > 0 ? 0 : Math.PI) + (z > 0 ? Math.PI * 0.46 : 0)
      });

      if (profile.pattern === 'socks') {
        const sock = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), accentMaterial);
        sock.position.set(0.01, -0.52, 0);
        sock.scale.set(0.86, 0.5, 0.86);
        sock.castShadow = true;
        kneeJoint.add(sock);
      }
    }
  }

  const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.98, 4, 8), darkMaterial);
  tail.rotation.z = 0.92;
  tail.position.set(-1.62, 0.28, 0);
  tail.castShadow = true;
  group.add(tail);

  const effect = new THREE.Mesh(new THREE.TorusGeometry(1.28, 0.05, 8, 44), effectMaterial);
  effect.rotation.x = Math.PI / 2;
  effect.position.y = 0.08;
  effect.visible = false;
  group.add(effect);

  group.userData.rider = rider;
  group.userData.effect = effect;
  group.userData.legs = legParts;
  group.userData.motionStyle = motionStyle;

  return group;
}

function createRider(accentColor: number): RiderParts {
  const root = new THREE.Group();
  const skinMaterial = new THREE.MeshStandardMaterial({ color: 0xf4d6b0, roughness: 0.52 });
  const suitMaterial = new THREE.MeshStandardMaterial({ color: 0x234155, roughness: 0.62 });
  const accentMaterial = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.48 });
  const bootMaterial = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.68 });

  root.position.set(-0.08, 1.2, 0);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.54, 5, 12), suitMaterial);
  torso.position.y = 0.28;
  torso.scale.set(0.9, 1, 0.72);
  torso.castShadow = true;
  root.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 16, 12), skinMaterial);
  head.position.y = 0.78;
  head.scale.set(0.92, 1.05, 0.92);
  head.castShadow = true;
  root.add(head);

  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.205, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), accentMaterial);
  helmet.position.set(0, 0.86, 0);
  helmet.castShadow = true;
  root.add(helmet);

  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.055, 0.3), bootMaterial);
  visor.position.set(0.16, 0.8, 0);
  visor.castShadow = true;
  root.add(visor);

  const leftArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.48, 4, 8), skinMaterial);
  leftArm.position.set(0.08, 0.32, 0.28);
  leftArm.rotation.z = 0.72;
  leftArm.castShadow = true;
  root.add(leftArm);

  const rightArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.48, 4, 8), skinMaterial);
  rightArm.position.set(0.08, 0.32, -0.28);
  rightArm.rotation.z = 0.72;
  rightArm.castShadow = true;
  root.add(rightArm);

  const leftLeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.58, 4, 8), bootMaterial);
  leftLeg.position.set(-0.1, -0.18, 0.22);
  leftLeg.rotation.z = -0.72;
  leftLeg.castShadow = true;
  root.add(leftLeg);

  const rightLeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 0.58, 4, 8), bootMaterial);
  rightLeg.position.set(-0.1, -0.18, -0.22);
  rightLeg.rotation.z = -0.72;
  rightLeg.castShadow = true;
  root.add(rightLeg);

  return {
    root,
    torso,
    head,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg
  };
}

function addPattern(group: THREE.Group, pattern: HorseProfile['pattern'], material: THREE.Material) {
  if (pattern === 'solid' || pattern === 'socks') {
    return;
  }

  if (pattern === 'spots') {
    for (const [x, y, z, scale] of [
      [-0.35, 0.22, 0.53, 0.28],
      [0.22, 0.18, -0.54, 0.22],
      [0.64, 0.34, 0.45, 0.18]
    ] as const) {
      const spot = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), material);
      spot.position.set(x, y, z);
      spot.scale.set(scale * 1.2, scale * 0.7, scale * 0.2);
      group.add(spot);
    }
    return;
  }

  for (const x of [-0.42, 0.02, 0.46]) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.74, 1.08), material);
    stripe.position.set(x, 0.12, 0);
    stripe.rotation.z = -0.25;
    stripe.castShadow = true;
    group.add(stripe);
  }
}

function updateLaneGuides(count: number) {
  clearGroup(laneGuideGroup);
  const lines = Math.max(2, count);

  for (let index = 1; index < lines; index += 1) {
    const z = -raceWidth / 2 + (raceWidth / lines) * index;
    const divider = new THREE.Mesh(
      new THREE.BoxGeometry(trackVisualLength - 1, 0.08, 0.035),
      new THREE.MeshStandardMaterial({ color: 0xf9f1d1, roughness: 0.75 })
    );
    divider.position.set(0, 0.18, z);
    laneGuideGroup.add(divider);
  }
}

function updateCameraTargetSelection(race: RaceResult) {
  const previousValue = selectedCameraEntryId;
  const hasPreviousEntry = race.placements.some((placement) => placement.entry.id === previousValue);

  selectedCameraEntryId = hasPreviousEntry ? previousValue : 'leader';
}

function setCurrentRace(index: number) {
  if (!tournament) {
    return;
  }

  currentRaceIndex = Math.max(0, Math.min(index, tournament.races.length - 1));
  const race = getCurrentRace();

  if (!race) {
    return;
  }

  raceElapsed = 0;
  raceFinished = false;
  clearVisualRunners();
  updateLaneGuides(race.placements.length);
  updateCameraTargetSelection(race);

  const lanePlacements = [...race.placements].sort((left, right) => left.entry.id.localeCompare(right.entry.id));
  lanePlacements.forEach((placement, indexInLane) => {
    const count = lanePlacements.length;
    const mesh = createHorse(placement.entry.profile);
    const baseScale = count > 14 ? 0.58 : count > 10 ? 0.68 : count > 6 ? 0.82 : 1;
    mesh.position.set(startX, horseBaseY, laneZ(indexInLane, count));
    mesh.rotation.y = 0;
    mesh.scale.setScalar(baseScale);
    scene.add(mesh);

    visualRunners.push({
      placement,
      mesh,
      label: makeLabel(placement.entry.name),
      lane: indexInLane,
      phase: indexInLane * 0.7,
      baseScale,
      skillActive: false,
      eliminated: false
    });
  });

  updateHelicopterState(race.hazardEvents);
  renderRaceStaticState();
  renderLeaderboard();
  snapCameraToLeader();
}

function getCurrentRace() {
  return tournament?.races[currentRaceIndex] ?? null;
}

function makeLabel(name: string) {
  const label = document.createElement('div');
  label.className = 'runner-tag';
  label.textContent = name;
  runnerLabels.appendChild(label);
  return label;
}

function clearVisualRunners() {
  visualRunners.forEach((runner) => {
    scene.remove(runner.mesh);
    disposeObject(runner.mesh);
  });
  visualRunners = [];
  runnerLabels.replaceChildren();
}

function updateRace(delta: number) {
  const race = getCurrentRace();

  if (!race) {
    updateCamera(null);
    return;
  }

  if (!raceStarted) {
    visualRunners.forEach((runner) => {
      runner.mesh.position.set(startX, horseBaseY, laneZ(runner.lane, visualRunners.length));
      runner.mesh.rotation.set(0, 0, 0);
      runner.mesh.scale.setScalar(runner.baseScale);
      runner.skillActive = false;
      runner.eliminated = false;
      animateHorseStride(runner, 0, false, 1);
      applySkillPose(runner, false);
      updateRunnerLabel(runner, false);
    });
    updateHelicopterAnimation([]);
    updateCamera(null);
    positionRunnerLabels();
    return;
  }

  raceElapsed += delta * getRaceTimeScale(race.hazardEvents);
  const maxFinish = Math.max(...race.placements.map((placement) => placement.finishSeconds));

  visualRunners.forEach((runner) => {
    const runnerHazard = getHazardForPlacement(race.hazardEvents, runner.placement);
    const eliminatedNow = isHelicopterTargetEliminated(race.hazardEvents, runner.placement);
    const fallProgress = getFallProgress(race.hazardEvents, runner.placement);
    const raceProgress = getSegmentedRaceProgress(
      eliminatedNow && runnerHazard ? runnerHazard.triggerSeconds : raceElapsed,
      runner.placement,
      runner.placement.speedSegments
    );
    const progress = raceProgress.progress;
    const bob = Math.sin(raceElapsed * 5.4 * raceProgress.multiplier + runner.phase) * 0.14;
    const laneSway = Math.sin(raceElapsed * 1.6 * raceProgress.multiplier + runner.phase) * 0.1;
    const activeSkill = !eliminatedNow && isSkillActive(runner.placement);
    const skillPulse = activeSkill ? 1 + Math.sin(raceElapsed * 9) * 0.035 : 1;

    runner.mesh.position.x = startX + progress * (finishX - startX);
    runner.mesh.position.z = laneZ(runner.lane, visualRunners.length) + (eliminatedNow ? 0 : laneSway);
    runner.mesh.position.y = eliminatedNow ? lerpNumber(horseBaseY, 0.42, fallProgress) : horseBaseY + Math.abs(bob) * 0.24;
    runner.mesh.rotation.x = eliminatedNow ? lerpNumber(0, Math.PI / 2, fallProgress) : 0;
    runner.mesh.rotation.z = eliminatedNow ? lerpNumber(bob * 0.055, -0.18, fallProgress) : bob * 0.055;
    runner.mesh.scale.setScalar(runner.baseScale * skillPulse);
    runner.skillActive = activeSkill;
    runner.eliminated = eliminatedNow;

    animateHorseStride(runner, progress, eliminatedNow, raceProgress.multiplier);
    applySkillPose(runner, activeSkill);
    updateRunnerLabel(runner, activeSkill);
  });

  updateHelicopterAnimation(race.hazardEvents);
  updateCamera(getActiveHazardEvent(race.hazardEvents));
  positionRunnerLabels();

  if (!raceFinished && raceElapsed >= maxFinish + 0.8) {
    raceFinished = true;
    renderRaceStaticState();
  }
}

function updateHelicopterState(hazardEvents: HazardEvent[]) {
  helicopterGroup.visible = false;
  bulletMesh.visible = false;
  muzzleFlash.visible = false;
  impactBurst.visible = false;
  raceStage.dataset.cinematic = 'idle';

  const firstEvent = hazardEvents[0];

  if (!firstEvent) {
    return;
  }

  helicopterGroup.position.set(finishX + 22, 11.8, -(trackVisualWidth / 2 + 18));
  helicopterGroup.rotation.set(0, Math.PI / 2, 0);
}

function updateHelicopterAnimation(hazardEvents: HazardEvent[]) {
  const hazardEvent = getActiveHazardEvent(hazardEvents);

  if (!hazardEvent) {
    helicopterGroup.visible = false;
    bulletMesh.visible = false;
    muzzleFlash.visible = false;
    impactBurst.visible = false;
    raceStage.dataset.cinematic = 'idle';
    setCameraControlLocked(false);
    return;
  }

  const target = visualRunners.find((runner) => runner.placement.entry.id === hazardEvent.targetEntryId);
  const sequenceStart = getHazardSequenceStart(hazardEvents);
  const sequenceEnd = getHazardSequenceEnd(hazardEvents);
  const visible = raceElapsed >= sequenceStart && raceElapsed <= sequenceEnd;
  helicopterGroup.visible = visible;

  if (!target || !visible) {
    bulletMesh.visible = false;
    muzzleFlash.visible = false;
    impactBurst.visible = false;
    raceStage.dataset.cinematic = 'idle';
    setCameraControlLocked(false);
    return;
  }

  setCameraControlLocked(true);

  const targetPosition = getRunnerAimPoint(target);
  const orbit = Math.sin(raceElapsed * 1.8) * 1.2;
  const arrivalProgress = smoothStep(clampNumber((raceElapsed - sequenceStart) / helicopterEntranceSeconds, 0, 1));
  const hoverPosition = getFinishHelicopterHoverPosition(orbit);
  const entryPosition = new THREE.Vector3(finishX + 26, 13.4, -(trackVisualWidth / 2 + 20));
  helicopterGroup.position.copy(entryPosition.lerp(hoverPosition, arrivalProgress));
  helicopterGroup.rotation.y = Math.PI / 2 + Math.sin(raceElapsed * 1.6) * 0.16;
  spinHelicopterRotors(helicopterGroup, raceElapsed);
  aimSniperRigAt(targetPosition);

  const muzzlePosition = getMuzzleWorldPosition();
  const shotTiming = getShotTiming(hazardEvent);
  const bulletProgress = clampNumber((raceElapsed - shotTiming.shotStart) / (hazardEvent.triggerSeconds - shotTiming.shotStart), 0, 1);
  const bulletActive = raceElapsed >= shotTiming.shotStart && raceElapsed <= shotTiming.shotEnd;
  const flashActive = raceElapsed >= shotTiming.flashStart && raceElapsed <= shotTiming.flashEnd;
  const impactActive = raceElapsed >= shotTiming.impactStart && raceElapsed <= shotTiming.impactEnd;

  bulletMesh.visible = bulletActive;
  muzzleFlash.visible = flashActive;
  impactBurst.visible = impactActive;

  if (bulletActive) {
    positionBullet(muzzlePosition, targetPosition, bulletProgress);
  }

  if (flashActive) {
    positionMuzzleFlash(muzzlePosition, targetPosition, raceElapsed);
  }

  if (impactActive) {
    positionImpactBurst(targetPosition, raceElapsed - hazardEvent.triggerSeconds);
  }

  raceStage.dataset.cinematic = impactActive ? 'hit' : bulletActive || flashActive ? 'shot' : 'approach';
}

function setCameraControlLocked(locked: boolean) {
  cameraSelectionLocked = locked;
  leaderboardList.classList.toggle('camera-locked', locked);
  leaderboardList.dataset.cameraLocked = locked ? 'true' : 'false';
}

function getFinishHelicopterHoverPosition(orbit: number) {
  return new THREE.Vector3(
    finishX - 3.8 + orbit * 0.45,
    8.8 + Math.sin(raceElapsed * 3) * 0.22,
    -(trackVisualWidth / 2 + 8.5)
  );
}

function getActiveHazardEvent(hazardEvents: HazardEvent[]) {
  const sortedEvents = getSortedHazardEvents(hazardEvents);
  const sequenceStart = getHazardSequenceStart(sortedEvents);
  const sequenceEnd = getHazardSequenceEnd(sortedEvents);

  if (raceElapsed < sequenceStart || raceElapsed > sequenceEnd) {
    return null;
  }

  const firingEvent = sortedEvents.find((hazardEvent) => {
    const shotTiming = getShotTiming(hazardEvent);
    return raceElapsed >= shotTiming.shotStart - 0.08 && raceElapsed <= shotTiming.impactEnd + 0.35;
  });

  if (firingEvent) {
    return firingEvent;
  }

  return sortedEvents.find((hazardEvent) => raceElapsed < getShotTiming(hazardEvent).shotStart - 0.08) ?? sortedEvents[sortedEvents.length - 1] ?? null;
}

function getRaceTimeScale(hazardEvents: HazardEvent[]) {
  const activeShot = hazardEvents.find((hazardEvent) => {
    const shotTiming = getShotTiming(hazardEvent);
    return raceElapsed >= shotTiming.shotStart - 0.08 && raceElapsed <= shotTiming.impactEnd;
  });

  if (!activeShot) {
    return 1;
  }

  return raceElapsed < activeShot.triggerSeconds ? 0.28 : 0.44;
}

function getShotTiming(hazardEvent: HazardEvent) {
  const flightSeconds = 0.9;

  return {
    shotStart: hazardEvent.triggerSeconds - flightSeconds,
    shotEnd: hazardEvent.triggerSeconds + 0.08,
    flashStart: hazardEvent.triggerSeconds - flightSeconds - 0.1,
    flashEnd: hazardEvent.triggerSeconds - flightSeconds + 0.22,
    impactStart: hazardEvent.triggerSeconds - 0.035,
    impactEnd: hazardEvent.triggerSeconds + 0.72
  };
}

function getHazardForPlacement(hazardEvents: HazardEvent[], placement: RacePlacement) {
  return hazardEvents.find((hazardEvent) => hazardEvent.targetEntryId === placement.entry.id) ?? null;
}

function isHelicopterTargetEliminated(hazardEvents: HazardEvent[], placement: RacePlacement) {
  const hazardEvent = getHazardForPlacement(hazardEvents, placement);

  return Boolean(
    hazardEvent &&
      placement.eliminatedByHelicopter &&
      placement.entry.id === hazardEvent.targetEntryId &&
      raceElapsed >= hazardEvent.triggerSeconds
  );
}

function getFallProgress(hazardEvents: HazardEvent[], placement: RacePlacement) {
  const hazardEvent = getHazardForPlacement(hazardEvents, placement);

  if (!hazardEvent || !placement.eliminatedByHelicopter) {
    return 0;
  }

  return smoothStep(clampNumber((raceElapsed - hazardEvent.triggerSeconds) / 0.85, 0, 1));
}

function getHazardApproachStart(hazardEvent: HazardEvent) {
  return Math.max(0, hazardEvent.approachSeconds);
}

function getHazardDepartEnd(hazardEvent: HazardEvent) {
  return hazardEvent.triggerSeconds + 2.2;
}

function getHazardSequenceStart(hazardEvents: HazardEvent[]) {
  const firstEvent = getSortedHazardEvents(hazardEvents)[0];

  return firstEvent ? getHazardApproachStart(firstEvent) : 0;
}

function getHazardSequenceEnd(hazardEvents: HazardEvent[]) {
  const sortedEvents = getSortedHazardEvents(hazardEvents);
  const lastEvent = sortedEvents[sortedEvents.length - 1];

  return lastEvent ? getHazardDepartEnd(lastEvent) : 0;
}

function getSortedHazardEvents(hazardEvents: HazardEvent[]) {
  return [...hazardEvents].sort((left, right) => left.triggerSeconds - right.triggerSeconds);
}

function getRunnerAimPoint(runner: VisualRunner) {
  const rider = runner.mesh.userData.rider as RiderParts | undefined;

  if (rider) {
    return rider.head.getWorldPosition(new THREE.Vector3());
  }

  return runner.mesh.localToWorld(new THREE.Vector3(0.3, 1.68, 0));
}

function getMuzzleWorldPosition() {
  return helicopterSniperRig.localToWorld(new THREE.Vector3(0, 0, -1.4));
}

function aimSniperRigAt(targetWorldPosition: THREE.Vector3) {
  const localTarget = helicopterGroup.worldToLocal(targetWorldPosition.clone());
  helicopterSniperRig.lookAt(localTarget);
}

function positionBullet(start: THREE.Vector3, end: THREE.Vector3, progress: number) {
  const easedProgress = smoothStep(clampNumber(progress, 0, 1));
  bulletMesh.position.copy(start).lerp(end, easedProgress);
  bulletMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(start).normalize());
}

function positionMuzzleFlash(start: THREE.Vector3, end: THREE.Vector3, time: number) {
  muzzleFlash.position.copy(start);
  muzzleFlash.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(start).normalize());
  const pulse = 1 + Math.sin(time * 42) * 0.22;
  muzzleFlash.scale.setScalar(pulse);
}

function positionImpactBurst(position: THREE.Vector3, elapsedSinceImpact: number) {
  const progress = clampNumber((elapsedSinceImpact + 0.04) / 0.6, 0, 1);
  impactBurst.position.copy(position);
  impactBurst.scale.setScalar(0.6 + progress * 1.9);

  const material = impactBurst.material;
  if (material instanceof THREE.MeshBasicMaterial) {
    material.opacity = Math.max(0, 0.82 - progress * 0.7);
  }
}

function spinHelicopterRotors(root: THREE.Object3D, time: number) {
  root.traverse((child) => {
    if (!/rotor|blade|prop/i.test(child.name)) {
      return;
    }

    child.rotation.y = time * 22;
  });
}

function isSkillActive(placement: RacePlacement) {
  if (!placement.skillEvent) {
    return false;
  }

  const start = placement.finishSeconds * placement.skillEvent.triggerProgress;
  const end = Math.min(placement.finishSeconds, start + placement.skillEvent.durationSeconds);
  return raceElapsed >= start && raceElapsed <= end;
}

function getSegmentedRaceProgress(elapsedSeconds: number, placement: RacePlacement, speedSegments: SpeedSegment[]) {
  if (speedSegments.length === 0) {
    return {
      progress: Math.min(1, elapsedSeconds / placement.finishSeconds),
      multiplier: 1,
      segmentIndex: 0
    };
  }

  const segmentWeights = speedSegments.map((segment) => 1 / Math.max(0.1, segment.multiplier));
  const totalWeight = segmentWeights.reduce((sum, value) => sum + value, 0);
  let elapsedCursor = 0;

  for (let index = 0; index < speedSegments.length; index += 1) {
    const segment = speedSegments[index];
    const segmentWeight = segmentWeights[index] ?? 1;
    const segmentDuration = placement.finishSeconds * (segmentWeight / totalWeight);

    if (elapsedSeconds <= elapsedCursor + segmentDuration) {
      const localProgress = clampNumber((elapsedSeconds - elapsedCursor) / segmentDuration, 0, 1);

      return {
        progress: (index + localProgress) / speedSegments.length,
        multiplier: segment?.multiplier ?? 1,
        segmentIndex: index
      };
    }

    elapsedCursor += segmentDuration;
  }

  const lastSegment = speedSegments[speedSegments.length - 1];

  return {
    progress: 1,
    multiplier: lastSegment?.multiplier ?? 1,
    segmentIndex: Math.max(0, speedSegments.length - 1)
  };
}

function animateHorseStride(runner: VisualRunner, progress: number, eliminated: boolean, speedMultiplier: number) {
  const legs = runner.mesh.userData.legs as HorseLegParts[] | undefined;
  const motionStyle = runner.mesh.userData.motionStyle as HorseMotionStyle | undefined;

  if (!legs) {
    return;
  }

  const motion = getHorseMotionConfig(motionStyle ?? 'run');
  const moving = raceStarted && !eliminated && progress > 0.01 && progress < 0.995;
  const pace = moving ? motion.speed * speedMultiplier : 1.8;
  const swing = moving ? motion.swing * clampNumber(speedMultiplier, 0.75, 1.35) : 0.07;
  const lift = moving ? motion.lift * clampNumber(speedMultiplier, 0.8, 1.28) : 0.018;
  const time = raceElapsed * pace + runner.phase;

  legs.forEach((leg) => {
    const cycle = Math.sin(time + leg.phase);
    const reach = Math.cos(time + leg.phase);
    const forward = Math.max(0, cycle);
    const planted = Math.max(0, -cycle);
    leg.hip.position.x = leg.hipBaseX + reach * swing * 0.08;
    leg.hip.position.y = leg.hipBaseY + forward * lift * 0.22;
    leg.hip.rotation.z = leg.upperBaseRotation + cycle * swing * 0.86;
    leg.knee.rotation.z = leg.lowerBaseRotation - cycle * swing * 0.34 + forward * 0.08;
    leg.hoof.rotation.z = leg.hoofBaseRotation + planted * swing * 0.08 - forward * swing * 0.05;
    leg.hoof.position.y = forward * lift * 0.62;
  });
}

function getHorseMotionConfig(style: HorseMotionStyle) {
  if (style === 'rush') {
    return { speed: 15.5, swing: 0.72, lift: 0.18 };
  }

  if (style === 'walk') {
    return { speed: 5.8, swing: 0.28, lift: 0.08 };
  }

  if (style === 'stroll') {
    return { speed: 3.6, swing: 0.18, lift: 0.05 };
  }

  return { speed: 9.4, swing: 0.48, lift: 0.12 };
}

function applySkillPose(runner: VisualRunner, active: boolean) {
  const rider = runner.mesh.userData.rider as RiderParts | undefined;
  const effect = runner.mesh.userData.effect as THREE.Mesh | undefined;
  const pose = runner.placement.skillEvent?.skill.pose;

  if (effect) {
    effect.visible = active;
    effect.rotation.z += active ? 0.12 : 0;
  }

  if (!rider) {
    return;
  }

  resetRiderPose(rider);
  const fallProgress = getFallProgress(getCurrentRace()?.hazardEvents ?? [], runner.placement);

  if (runner.eliminated) {
    const hitShake = fallProgress < 0.55 ? Math.sin(raceElapsed * 32) * (1 - fallProgress) * 0.18 : 0;
    rider.root.rotation.z = lerpNumber(0, -1.24, fallProgress) + hitShake;
    rider.root.position.y = lerpNumber(1.2, 0.55, fallProgress);
    rider.leftArm.rotation.z = lerpNumber(0.72, 2.1, fallProgress);
    rider.rightArm.rotation.z = lerpNumber(0.72, -1.7, fallProgress);
    rider.leftLeg.rotation.z = lerpNumber(-0.72, 0.8, fallProgress);
    rider.rightLeg.rotation.z = lerpNumber(-0.72, -0.2, fallProgress);
    return;
  }

  if (!active || !pose) {
    return;
  }

  poseRider(pose, rider, raceElapsed);
}

function resetRiderPose(rider: RiderParts) {
  rider.root.position.set(-0.08, 1.2, 0);
  rider.root.rotation.set(0, 0, 0);
  rider.torso.rotation.set(0, 0, 0);
  rider.head.position.set(0, 0.78, 0);
  rider.head.rotation.set(0, 0, 0);
  rider.leftArm.position.set(0.08, 0.32, 0.28);
  rider.leftArm.rotation.set(0, 0, 0.72);
  rider.rightArm.position.set(0.08, 0.32, -0.28);
  rider.rightArm.rotation.set(0, 0, 0.72);
  rider.leftLeg.position.set(-0.1, -0.18, 0.22);
  rider.leftLeg.rotation.set(0, 0, -0.72);
  rider.rightLeg.position.set(-0.1, -0.18, -0.22);
  rider.rightLeg.rotation.set(0, 0, -0.72);
}

function poseRider(pose: SkillPose, rider: RiderParts, time: number) {
  if (pose === 'handstand') {
    rider.root.rotation.z = Math.PI;
    rider.root.position.y = 1.55;
    rider.leftArm.rotation.z = 2.45;
    rider.rightArm.rotation.z = 2.45;
    rider.leftLeg.rotation.z = -1.15;
    rider.rightLeg.rotation.z = -1.15;
    return;
  }

  if (pose === 'dance') {
    rider.root.rotation.z = Math.sin(time * 11) * 0.42;
    rider.leftArm.rotation.z = 1.6 + Math.sin(time * 12) * 0.6;
    rider.rightArm.rotation.z = -1.2 + Math.cos(time * 12) * 0.6;
    rider.head.position.x = Math.sin(time * 10) * 0.1;
    return;
  }

  if (pose === 'lie-flat') {
    rider.root.rotation.z = Math.PI / 2;
    rider.root.position.y = 1.05;
    rider.head.position.set(0.22, 0.78, 0);
    rider.leftLeg.rotation.z = -0.15;
    rider.rightLeg.rotation.z = -0.15;
    return;
  }

  rider.torso.rotation.x = -0.35;
  rider.head.position.y = 0.86 + Math.sin(time * 12) * 0.08;
  rider.leftArm.rotation.z = 2.2;
  rider.rightArm.rotation.z = -2.2;
}

function updateRunnerLabel(runner: VisualRunner, activeSkill: boolean) {
  const skill = runner.placement.skillEvent?.skill;
  const liveRank = getLiveRunnerRank(runner);
  runner.label.textContent = runner.eliminated
    ? `${runner.placement.entry.name} - 탈락`
    : activeSkill && skill
      ? `${runner.placement.entry.name} - ${skill.name}`
      : runner.placement.entry.name;
  runner.label.classList.toggle('skill', activeSkill);
  runner.label.classList.toggle('eliminated', runner.eliminated);
  runner.label.classList.toggle('hit', runner.eliminated && getFallProgress(getCurrentRace()?.hazardEvents ?? [], runner.placement) < 0.7);
  runner.label.classList.toggle('winner', raceFinished && runner.placement.rank === 1);
  runner.label.classList.toggle('qualified', raceFinished && runner.placement.qualified && runner.placement.rank !== 1);
  runner.label.classList.toggle('rank-first', liveRank === 1 && !runner.eliminated);
  runner.label.classList.toggle('rank-second', liveRank === 2 && !runner.eliminated);
  runner.label.classList.toggle('rank-third', liveRank === 3 && !runner.eliminated);
}

function getLiveRunnerRank(runner: VisualRunner) {
  const ranked = visualRunners
    .filter((candidate) => !candidate.eliminated)
    .sort((left, right) => right.mesh.position.x - left.mesh.position.x);

  return ranked.findIndex((candidate) => candidate === runner) + 1;
}

function positionRunnerLabels() {
  const rect = raceCanvas.getBoundingClientRect();
  const minX = rect.left + 44;
  const maxX = rect.right - 44;
  const minY = rect.top + 26;
  const maxY = rect.bottom - 32;

  visualRunners.forEach((runner) => {
    const labelHeight = runner.eliminated ? 0.9 : 2.35;
    const anchor = runner.mesh.localToWorld(new THREE.Vector3(0, labelHeight, 0));
    const projected = anchor.project(camera);
    const screenX = rect.left + (projected.x * 0.5 + 0.5) * rect.width;
    const screenY = rect.top + (-projected.y * 0.5 + 0.5) * rect.height;
    const screenVisible =
      screenX >= rect.left + 18 && screenX <= rect.right - 18 && screenY >= rect.top + 16 && screenY <= rect.bottom - 16;
    const important = runner.eliminated || runner.skillActive || (raceFinished && (runner.placement.rank === 1 || runner.placement.qualified));
    const clampedX = important ? clampNumber(screenX, minX, maxX) : screenX;
    const clampedY = important ? clampNumber(screenY, minY, maxY) : screenY;
    const onCameraSide = projected.z < 1;
    const edgeOpacity = screenVisible ? 1 : 0.64;

    runner.label.style.opacity = String(onCameraSide && (important || screenVisible) ? edgeOpacity : 0);
    runner.label.style.transform = `translate(${clampedX}px, ${clampedY}px) translate(-50%, -120%)`;
  });
}

function renderRaceStaticState() {
  const race = getCurrentRace();

  if (!race || !tournament) {
    return;
  }

  const raceNumber = currentRaceIndex + 1;
  const totalRaces = tournament.races.length;
  const finalText = !raceStarted ? '대기 중' : race.isFinal ? '결승' : `${race.round}라운드`;
  raceMeta.textContent = `${finalText} - 경기 ${raceNumber}/${totalRaces}`;
  raceTitle.textContent = !raceStarted ? '출발 대기' : race.isFinal ? '결승전' : `${race.round}라운드 / ${race.group}조`;
  raceSummary.replaceChildren(
    summaryRow('출전', `${race.placements.length}명`),
    summaryRow('주로', SURFACE_LABELS[race.options.surface]),
    summaryRow('거리', DISTANCE_LABELS[race.options.distance]),
    summaryRow('상태', CONDITION_LABELS[race.options.condition]),
    summaryRow('말별속도', `${race.speedSegmentCount}구간`),
    summaryRow('헬기', race.hazardEvents.length > 0 ? `출격 x${race.hazardEvents.length}` : '없음'),
    summaryRow('시드', race.options.seed),
    summaryRow('전체', `${tournament.participantCount}명`)
  );

  resultList.replaceChildren(...buildResultItems(race, raceFinished));
  replayButton.disabled = false;
  nextButton.disabled = currentRaceIndex >= totalRaces - 1;
}

function buildResultItems(race: RaceResult, reveal: boolean) {
  const topPlacements = reveal ? race.placements : race.placements.slice(0, Math.min(6, race.placements.length));

  return topPlacements.map((placement) => {
    const item = document.createElement('li');
    const rank = document.createElement('span');
    const body = document.createElement('div');
    const name = document.createElement('strong');
    const detail = document.createElement('small');

    rank.textContent = reveal ? String(placement.rank) : '-';
    name.textContent = placement.entry.name;
    detail.textContent = reveal ? resultDetail(placement, race) : '동일 출발 / 20구간 랜덤 배속';
    body.append(name, detail);
    item.append(rank, body);
    item.classList.toggle('qualified', reveal && placement.qualified);
    item.classList.toggle('eliminated', reveal && placement.eliminatedByHelicopter);
    return item;
  });
}

function resultDetail(placement: RacePlacement, race: RaceResult) {
  if (placement.eliminatedByHelicopter) {
    return '헬기 탈락 / 탈락';
  }

  const skillText = placement.skillEvent ? ` / ${placement.skillEvent.skill.name}` : '';
  const advanceText = placement.qualified ? (race.isFinal ? '우승' : '진출') : '탈락';
  return `${placement.finishSeconds.toFixed(2)}초 / ${advanceText}${skillText}`;
}

function speedSegmentLine(placement: RacePlacement) {
  if (!raceStarted) {
    return '출발 대기';
  }

  const raceProgress = getSegmentedRaceProgress(raceElapsed, placement, placement.speedSegments);
  const segment = placement.speedSegments[raceProgress.segmentIndex];

  return segment ? `${segment.index + 1}구간 ${segment.label} x${segment.multiplier.toFixed(2)}` : '속도 유지';
}

function renderLeaderboard() {
  const race = getCurrentRace();

  if (!race) {
    return;
  }

  const ranked = raceFinished
    ? race.placements
    : [...visualRunners]
        .sort((left, right) => right.mesh.position.x - left.mesh.position.x)
        .map((runner) => runner.placement);

  const visibleIds = new Set<string>();

  ranked.slice(0, 8).forEach((placement, index) => {
    const runner = visualRunners.find((candidate) => candidate.placement === placement);
    const activeSkill = runner?.skillActive && placement.skillEvent ? placement.skillEvent.skill.name : null;
    const eliminated = runner?.eliminated || (raceFinished && placement.eliminatedByHelicopter);
    const selected = selectedCameraEntryId === placement.entry.id;
    const parts = getLeaderboardItemParts(placement.entry.id);
    const currentChild = leaderboardList.children[index] ?? null;

    visibleIds.add(placement.entry.id);
    parts.rank.textContent = String(raceFinished ? placement.rank : index + 1);
    parts.name.textContent = placement.entry.name;
    parts.detail.textContent = eliminated
      ? '헬기 탈락'
      : activeSkill ?? (raceFinished ? resultDetail(placement, race) : speedSegmentLine(placement));
    parts.item.dataset.entryId = placement.entry.id;
    parts.item.setAttribute('role', 'button');
    parts.item.setAttribute('tabindex', cameraSelectionLocked ? '-1' : '0');
    parts.item.setAttribute('aria-pressed', String(selected));
    parts.item.classList.toggle('qualified', raceFinished && placement.qualified);
    parts.item.classList.toggle('eliminated', Boolean(eliminated));
    parts.item.classList.toggle('selected', selected);

    if (currentChild !== parts.item) {
      leaderboardList.insertBefore(parts.item, currentChild);
    }
  });

  [...leaderboardItems.entries()].forEach(([entryId, parts]) => {
    if (visibleIds.has(entryId)) {
      return;
    }

    parts.item.remove();
    leaderboardItems.delete(entryId);
  });
}

function selectCameraEntry(entryId: string) {
  if (cameraSelectionLocked || !entryId) {
    return;
  }

  selectedCameraEntryId = selectedCameraEntryId === entryId ? 'leader' : entryId;
  renderLeaderboard();
}

function getLeaderboardItemParts(entryId: string) {
  const existing = leaderboardItems.get(entryId);

  if (existing) {
    return existing;
  }

  const item = document.createElement('li');
  const rank = document.createElement('span');
  const name = document.createElement('strong');
  const detail = document.createElement('small');
  const parts = { item, rank, name, detail };

  item.append(rank, name, detail);
  leaderboardItems.set(entryId, parts);

  return parts;
}

function startTournament() {
  const names = participantInput.value.split(/\r?\n/);
  const options = readOptions();
  tournament = runTournament(names, options);
  currentRaceIndex = 0;
  raceStarted = true;
  setCurrentRace(0);
  setPanelsHidden(true);
}

function prepareTournament() {
  const names = participantInput.value.split(/\r?\n/);
  const options = readOptions();
  tournament = runTournament(names, options);
  currentRaceIndex = 0;
  raceStarted = false;
  setCurrentRace(0);
  setPanelsHidden(false);
}

function setPanelsHidden(hidden: boolean) {
  raceStage.classList.toggle('panels-hidden', hidden);
  togglePanelsButton.setAttribute('aria-pressed', String(hidden));
}

function rollSeed() {
  const timestamp = String(Date.now());
  const entropy = String(Math.floor(Math.random() * 100_000)).padStart(5, '0');
  seedInput.value = `호반-${timestamp}-${entropy}`;
  prepareTournament();
}

function readOptions(): Partial<RaceOptions> {
  return {
    seed: seedInput.value,
    fieldSize: Number(fieldSizeInput.value),
    qualifiersPerGroup: Number(qualifiersInput.value),
    winnerCount: Number(winnerCountInput.value),
    surface: surfaceSelect.value as RaceOptions['surface'],
    distance: distanceSelect.value as RaceOptions['distance'],
    condition: conditionSelect.value as RaceOptions['condition']
  };
}

function summaryRow(label: string, value: string) {
  const row = document.createElement('div');
  const key = document.createElement('span');
  const text = document.createElement('strong');
  key.textContent = label;
  text.textContent = value;
  row.append(key, text);
  return row;
}

function laneZ(index: number, count: number) {
  if (count <= 1) {
    return 0;
  }

  return -raceWidth / 2 + (raceWidth / (count - 1)) * index;
}

function clearGroup(group: THREE.Group) {
  while (group.children.length > 0) {
    const child = group.children[0];
    group.remove(child);
    disposeObject(child);
  }
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }

    child.geometry.dispose();

    if (Array.isArray(child.material)) {
      child.material.forEach((material) => material.dispose());
    } else {
      child.material.dispose();
    }
  });
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function lerpNumber(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
}

function smoothStep(progress: number) {
  return progress * progress * (3 - 2 * progress);
}

function getStableIndex(value: string, modulo: number) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return modulo > 0 ? hash % modulo : 0;
}

function resize() {
  const width = raceCanvas.clientWidth;
  const height = raceCanvas.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function updateCamera(hazardEvent: HazardEvent | null) {
  const width = raceCanvas.clientWidth;
  const leaderView = getLeaderCameraView(width);
  const defaultPosition = leaderView.position;
  const defaultTarget = leaderView.target;

  if (!hazardEvent) {
    moveCamera(defaultPosition, defaultTarget, 0.13);
    return;
  }

  const target = visualRunners.find((runner) => runner.placement.entry.id === hazardEvent.targetEntryId);
  const currentHazardEvents = getCurrentRace()?.hazardEvents ?? [];

  if (!target || raceElapsed < getHazardSequenceStart(currentHazardEvents) || raceElapsed > getHazardSequenceEnd(currentHazardEvents)) {
    moveCamera(defaultPosition, defaultTarget, 0.12);
    return;
  }

  const targetPoint = getRunnerAimPoint(target);
  const helicopterPoint = helicopterGroup.getWorldPosition(new THREE.Vector3());
  const shotTiming = getShotTiming(hazardEvent);
  let desiredPosition: THREE.Vector3;
  let desiredTarget: THREE.Vector3;
  let cameraAlpha = 0.14;

  if (raceElapsed < shotTiming.shotStart) {
    const finishRouteCenter = targetPoint.clone().lerp(helicopterPoint, 0.62);
    desiredPosition = finishRouteCenter.clone().add(new THREE.Vector3(-24, 13.5, 32));
    desiredTarget = finishRouteCenter.clone().lerp(helicopterPoint, 0.22);
    cameraAlpha = 0.07;
  } else if (raceElapsed < hazardEvent.triggerSeconds) {
    const muzzlePoint = getMuzzleWorldPosition();
    const bulletProgress = clampNumber((raceElapsed - shotTiming.shotStart) / (hazardEvent.triggerSeconds - shotTiming.shotStart), 0, 1);
    const bulletPosition = bulletMesh.visible ? bulletMesh.position.clone() : muzzlePoint.clone().lerp(targetPoint, smoothStep(bulletProgress));
    const bulletDirection = targetPoint.clone().sub(muzzlePoint).normalize();
    const side = new THREE.Vector3(-bulletDirection.z, 0, bulletDirection.x).normalize();
    const cameraSide = side.lengthSq() > 0 ? side : new THREE.Vector3(0, 0, 1);
    desiredPosition = bulletPosition
      .clone()
      .add(bulletDirection.clone().multiplyScalar(-1.6))
      .add(cameraSide.multiplyScalar(2.35))
      .add(new THREE.Vector3(0, 0.82, 0));
    desiredTarget = bulletPosition.clone().add(bulletDirection.clone().multiplyScalar(5.2)).lerp(targetPoint, 0.4);
    cameraAlpha = 0.42;
  } else if (raceElapsed < shotTiming.impactEnd) {
    desiredPosition = target.mesh.position.clone().add(new THREE.Vector3(-3.9, 2.45, 4.9));
    desiredTarget = targetPoint.clone().add(new THREE.Vector3(0.2, 0.18, 0));
    cameraAlpha = 0.32;
  } else {
    desiredPosition = target.mesh.position.clone().add(new THREE.Vector3(-4.8, 2.7, 5.4));
    desiredTarget = target.mesh.position.clone().add(new THREE.Vector3(0.25, 0.82, 0));
    cameraAlpha = 0.15;
  }

  moveCamera(desiredPosition, desiredTarget, cameraAlpha);
}

function getLeaderCameraView(width: number) {
  const leadRunner = getCameraFocusRunner();

  if (!leadRunner) {
    return {
      position: width < 760 ? new THREE.Vector3(0, 24, 42) : new THREE.Vector3(0, 18, 32),
      target: new THREE.Vector3(0, 0, 0)
    };
  }

  const leadPoint = leadRunner.mesh.position.clone();
  const clampedX = clampNumber(leadPoint.x, startX + 4, finishX - 5);
  const focusPoint = new THREE.Vector3(clampedX, leadPoint.y, leadPoint.z);
  const positionOffset = width < 760 ? new THREE.Vector3(-11.5, 10.5, 19.5) : new THREE.Vector3(-9.5, 6.6, 12.6);
  const targetOffset = width < 760 ? new THREE.Vector3(3.5, 0.95, 0) : new THREE.Vector3(4.5, 0.95, 0);

  return {
    position: focusPoint.clone().add(positionOffset),
    target: focusPoint.clone().add(targetOffset)
  };
}

function getCameraFocusRunner() {
  if (selectedCameraEntryId !== 'leader') {
    const selectedRunner = visualRunners.find((runner) => runner.placement.entry.id === selectedCameraEntryId);

    if (selectedRunner) {
      return selectedRunner;
    }
  }

  return getLeadRunner();
}

function snapCameraToLeader() {
  const leaderView = getLeaderCameraView(raceCanvas.clientWidth);
  camera.position.copy(leaderView.position);
  cameraLookTarget.copy(leaderView.target);
  camera.lookAt(cameraLookTarget);
}

function getLeadRunner() {
  const activeRunners = visualRunners.filter((runner) => !runner.eliminated);
  const candidates = activeRunners.length > 0 ? activeRunners : visualRunners;

  return (
    candidates.reduce<VisualRunner | null>((leadRunner, runner) => {
      if (!leadRunner || runner.mesh.position.x > leadRunner.mesh.position.x) {
        return runner;
      }

      return leadRunner;
    }, null)
  );
}

function moveCamera(position: THREE.Vector3, target: THREE.Vector3, alpha: number) {
  camera.position.lerp(position, alpha);
  cameraLookTarget.lerp(target, alpha);
  camera.lookAt(cameraLookTarget);
}

function animate() {
  const delta = clock.getDelta();
  resize();
  updateRace(delta);
  renderLeaderboard();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

sample18Button.addEventListener('click', () => {
  participantInput.value = createSampleParticipants(18).join('\n');
  prepareTournament();
});

sample64Button.addEventListener('click', () => {
  participantInput.value = createSampleParticipants(64).join('\n');
  prepareTournament();
});

startButton.addEventListener('click', startTournament);
randomSeedButton.addEventListener('click', rollSeed);
leaderboardList.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target.closest<HTMLLIElement>('li[data-entry-id]') : null;

  if (target) {
    selectCameraEntry(target.dataset.entryId ?? '');
  }
});
leaderboardList.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') {
    return;
  }

  const target = event.target instanceof Element ? event.target.closest<HTMLLIElement>('li[data-entry-id]') : null;

  if (!target) {
    return;
  }

  event.preventDefault();
  selectCameraEntry(target.dataset.entryId ?? '');
});
togglePanelsButton.addEventListener('click', () => setPanelsHidden(!raceStage.classList.contains('panels-hidden')));
replayButton.addEventListener('click', () => {
  raceStarted = true;
  setCurrentRace(currentRaceIndex);
});
nextButton.addEventListener('click', () => {
  raceStarted = true;
  setCurrentRace(currentRaceIndex + 1);
});
window.addEventListener('resize', resize);

scheduleHelicopterAssetLoad();
prepareTournament();
animate();
