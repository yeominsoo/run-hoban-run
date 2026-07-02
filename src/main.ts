import * as THREE from 'three';
import {
  createSampleParticipants,
  getRaceOptionBounds,
  normalizeParticipants,
  runTournament,
  type HazardEvent,
  type HorseProfile,
  type RaceOptions,
  type RacePlacement,
  type RaceResult,
  type SkillEvent,
  type SkillPose,
  type SpeedSegment,
  type TournamentResult
} from './game/rules';
import { FRENZY_PARTICLE_TEXTURES } from './assets/frenzy';
import {
  createBulletMesh,
  createHelicopterSniperRig,
  createImpactBurst,
  createMuzzleFlash,
  installHelicopterFallback,
  installHelicopterVisual,
  spinHelicopterRotors
} from './render/helicopter';
import { disposeObject } from './render/scene-utils';
import { query, renderAppShell } from './ui/app-shell';
import './style.css';

type RiderParts = {
  root: THREE.Group;
  torso: THREE.Object3D;
  head: THREE.Object3D;
  leftArm: THREE.Object3D;
  rightArm: THREE.Object3D;
  leftLeg: THREE.Object3D;
  rightLeg: THREE.Object3D;
};

type VisualRunner = {
  placement: RacePlacement;
  mesh: THREE.Group;
  label: HTMLDivElement;
  identityLabel: HTMLDivElement;
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

type RaceCameraSequencePhase = 'pre-race' | 'early' | 'mid' | 'final-stretch' | 'finish' | 'winner' | 'tracking' | 'cinematic';

type CameraView = {
  position: THREE.Vector3;
  target: THREE.Vector3;
  phase: RaceCameraSequencePhase;
  alpha?: number;
};

type SpeedSkillEvent = SkillEvent & { triggerSeconds: number; speedMultiplier: number };

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

type HorseRigParts = {
  root: THREE.Group;
  body: THREE.Mesh;
  chest: THREE.Mesh;
  haunch: THREE.Mesh;
  neck: THREE.Mesh;
  head: THREE.Mesh;
  tail: THREE.Mesh;
  shadow: THREE.Mesh;
  dust: THREE.Mesh[];
  dustMaterials: THREE.MeshBasicMaterial[];
};

type FrenzyVortexParts = {
  root: THREE.Group;
  rings: THREE.Mesh[];
  dust: THREE.Mesh[];
  smokeSprites: THREE.Sprite[];
  smokeMaterials: THREE.SpriteMaterial[];
};

type FrenzyFireParts = {
  root: THREE.Group;
  flames: THREE.Mesh[];
  materials: THREE.MeshBasicMaterial[];
};

type DanceMirrorBallParts = {
  root: THREE.Group;
  ball: THREE.Mesh;
  beams: THREE.Mesh[];
  sparkles: THREE.Mesh[];
  materials: THREE.MeshBasicMaterial[];
};

type FlatGlideParts = {
  root: THREE.Group;
  streaks: THREE.Mesh[];
  ripples: THREE.Mesh[];
  dust: THREE.Mesh[];
  materials: THREE.MeshBasicMaterial[];
};

type RocketFartParts = {
  root: THREE.Group;
  puffs: THREE.Mesh[];
  materials: THREE.MeshBasicMaterial[];
};

type VictoryEffectParts = {
  root: THREE.Group;
  crown: THREE.Group;
  spotlight: THREE.Mesh;
  rings: THREE.Mesh[];
  beams: THREE.Mesh[];
  sparks: THREE.Mesh[];
  materials: THREE.MeshBasicMaterial[];
};

type SnortPuffParts = {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  burstIndex: number;
  nostrilSide: number;
};

type RaceRenderer = {
  shadowMap: {
    enabled: boolean;
    type: number;
  };
  setPixelRatio: (ratio: number) => void;
  setSize: (width: number, height: number, updateStyle?: boolean) => void;
  render: (scene: THREE.Scene, camera: THREE.Camera) => void;
};

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('앱 루트를 찾을 수 없습니다.');
}

const bootLoader = document.querySelector<HTMLElement>('#boot-loader');
const bootStatus = document.querySelector<HTMLElement>('#boot-status');
let bootCompleted = false;

function setBootStatus(message: string) {
  if (bootStatus) {
    bootStatus.textContent = message;
  }
}

function completeBootLoader() {
  if (bootCompleted) {
    return;
  }

  bootCompleted = true;
  document.documentElement.classList.add('app-ready');
  window.setTimeout(() => bootLoader?.remove(), 420);
}

setBootStatus('경기장 준비 중');

renderAppShell(app);

const raceCanvas = query<HTMLCanvasElement>('#race-canvas');
const raceStage = query<HTMLElement>('#race-stage');
const leaderboardList = query<HTMLOListElement>('#leaderboard');
const minimapDotsLayer = query<HTMLDivElement>('#minimap-dots');
const participantInput = query<HTMLTextAreaElement>('#participants');
const seedInput = query<HTMLInputElement>('#seed-input');
const fieldSizeInput = query<HTMLInputElement>('#field-size');
const qualifiersInput = query<HTMLInputElement>('#qualifiers');
const winnerCountInput = query<HTMLInputElement>('#winner-count');
const sample20Button = query<HTMLButtonElement>('#sample-20');
const sample64Button = query<HTMLButtonElement>('#sample-64');
const startButton = query<HTMLButtonElement>('#start-tournament');
const randomSeedButton = query<HTMLButtonElement>('#random-seed');
const togglePanelsButton = query<HTMLButtonElement>('#toggle-panels');
const toggleFullscreenButton = query<HTMLButtonElement>('#toggle-fullscreen');
const toggleRecordingButton = query<HTMLButtonElement>('#toggle-recording');
const downloadResultShotButton = query<HTMLButtonElement>('#download-result-shot');
const replayButton = query<HTMLButtonElement>('#replay-race');
const nextButton = query<HTMLButtonElement>('#next-race');
const raceMeta = query<HTMLParagraphElement>('#race-meta');
const raceTitle = query<HTMLDivElement>('#race-title');
const raceSummary = query<HTMLDivElement>('#race-summary');
const winnerBanner = query<HTMLDivElement>('#winner-banner');
const winnerName = query<HTMLElement>('#winner-name');
const winnerDetail = query<HTMLElement>('#winner-detail');
const recentParticipantsStorageKey = 'run-hoban-run:recent-participants';
const racerModelStrategy = 'procedural-stylized';
const horseAssetId = 'procedural-stylized-horse';
const riderAssetId = 'procedural-stylized-jockey';
const defaultRacePaceMultiplier = 1.25;
const fastFinishRacePaceMultiplier = 3;

participantInput.value = loadRecentParticipants() ?? createSampleParticipants(20).join('\n');
let lastFieldSizeMax = getRaceOptionBounds(normalizeParticipants(participantInput.value.split(/\r?\n/)).length).fieldSize.max;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb8d9ff);
scene.fog = new THREE.Fog(0xb8d9ff, 95, 360);

const renderer = createRaceRenderer(raceCanvas);
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
const trackVisualWidth = raceWidth + 5.2;
const groundLength = trackVisualLength + 80;
const groundWidth = trackVisualWidth + 30;
const startX = -raceLength / 2 + 8;
const finishX = raceLength / 2 - 7;
const horseBaseY = 1.45;
const riderMountX = -0.08;
const riderMountY = 1.36;
const riderScale = 1.14;
const riderLegZ = 0.38;
const frenzyCutsceneLeadSeconds = 0.72;
const frenzyCutsceneHoldSeconds = 2.25;
const frenzyCutsceneReturnSeconds = 0.9;
const winnerPresentationDelaySeconds = 1.15;
const helicopterEntranceSeconds = 3;
const helicopterForwardRotationY = -Math.PI / 2;
const helicopterNoseLocalX = 1.72;
const helicopterTailLocalX = -3.16;
const helicopterTailBoomEndX = -3.08;
const helicopterTailRotorHubX = -3.12;
const helicopterBodyTopY = 0.58;
const helicopterMainRotorY = 1.24;
const helicopterMuzzleLocalZ = 1.12;
let raceElapsed = 0;
let raceFinished = false;
let raceStarted = false;
let tournament: TournamentResult | null = null;
let currentRaceIndex = 0;
let visualRunners: VisualRunner[] = [];
let selectedCameraEntryId = 'overview';
let currentCameraSequencePhase: RaceCameraSequencePhase = 'pre-race';
let overviewCameraZoom = 1;
let activePinchDistance: number | null = null;
let leaderboardDragPointerId: number | null = null;
let leaderboardDragStartX = 0;
let leaderboardDragStartScrollLeft = 0;
let leaderboardDragMoved = false;
let suppressLeaderboardClick = false;
let mediaRecorder: MediaRecorder | null = null;
let recordedVideoChunks: Blob[] = [];
let recordingMimeType = '';
let recordingStartTime = 0;
let recordingCanvas: HTMLCanvasElement | null = null;
let recordingContext: CanvasRenderingContext2D | null = null;
let recordingFrameRequest = 0;
const crowdBannerGroup = new THREE.Group();
const crowdBannerColors = ['#f2c94c', '#56ccf2', '#6fcf97', '#eb5757'];
let crowdBannerStandLength = 0;
let crowdBannerFrontZ = 0;
const crowdBannerBandHeight = 1.05;
const crowdBannerBandTopY = 2.55;
const overviewCameraZoomMin = 0.72;
const overviewCameraZoomMax = 1.65;
const frenzyTextureLoader = new THREE.TextureLoader();
let frenzyParticleTextures: THREE.Texture[] | null = null;
let helicopterVisualPromise: Promise<'generated'> | null = null;
let helicopterVisualLoadToken = 0;
let racerAssetPromise: Promise<void> | null = null;
const horseAssetStatus = 'procedural';
const riderAssetStatus = 'procedural';

function getFrenzyParticleTextures() {
  if (!frenzyParticleTextures) {
    frenzyParticleTextures = FRENZY_PARTICLE_TEXTURES.map((url) => {
      const texture = frenzyTextureLoader.load(url);
      texture.colorSpace = THREE.SRGBColorSpace;
      return texture;
    });
  }

  return frenzyParticleTextures;
}

function ensureRacerAssetLoading() {
  if (!racerAssetPromise) {
    syncVisualStyleState();
    racerAssetPromise = Promise.resolve();
  }

  return racerAssetPromise;
}

function createRaceRenderer(canvas: HTMLCanvasElement): RaceRenderer {
  try {
    return new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true
    });
  } catch (error) {
    console.warn('WebGL renderer unavailable. Falling back to 2D canvas rendering.', error);
    return createFallbackRaceRenderer(canvas);
  }
}

function createFallbackRaceRenderer(canvas: HTMLCanvasElement): RaceRenderer {
  const context = canvas.getContext('2d');
  let pixelRatio = 1;

  return {
    shadowMap: {
      enabled: false,
      type: THREE.PCFSoftShadowMap
    },
    setPixelRatio(ratio: number) {
      pixelRatio = Math.max(1, ratio);
    },
    setSize(width: number, height: number, updateStyle = true) {
      const scaledWidth = Math.max(1, Math.floor(width * pixelRatio));
      const scaledHeight = Math.max(1, Math.floor(height * pixelRatio));

      if (canvas.width !== scaledWidth || canvas.height !== scaledHeight) {
        canvas.width = scaledWidth;
        canvas.height = scaledHeight;
      }

      if (updateStyle) {
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      }
    },
    render() {
      drawFallbackRaceScene(canvas, context, pixelRatio);
    }
  };
}

function drawFallbackRaceScene(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D | null, pixelRatio: number) {
  if (!context) {
    return;
  }

  const width = canvas.width / pixelRatio;
  const height = canvas.height / pixelRatio;
  const trackTop = height * 0.5;
  const trackHeight = Math.max(160, height * 0.34);
  const trackLeft = width * 0.08;
  const trackWidth = width * 0.84;
  const laneCount = Math.max(visualRunners.length, 8);

  context.save();
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, width, height);

  const skyGradient = context.createLinearGradient(0, 0, 0, height);
  skyGradient.addColorStop(0, '#b8d9ff');
  skyGradient.addColorStop(0.54, '#e8f6ff');
  skyGradient.addColorStop(0.55, '#d9bb86');
  skyGradient.addColorStop(1, '#b98452');
  context.fillStyle = skyGradient;
  context.fillRect(0, 0, width, height);

  const sandGradient = context.createLinearGradient(0, trackTop, 0, trackTop + trackHeight);
  sandGradient.addColorStop(0, '#d9a166');
  sandGradient.addColorStop(0.5, '#c88952');
  sandGradient.addColorStop(1, '#b97443');
  context.fillStyle = sandGradient;
  context.fillRect(trackLeft, trackTop, trackWidth, trackHeight);
  context.fillStyle = 'rgba(116, 76, 43, 0.18)';
  for (let index = 0; index < 70; index += 1) {
    const x = trackLeft + ((index * 53) % Math.max(1, trackWidth));
    const y = trackTop + ((index * 31) % Math.max(1, trackHeight));
    context.fillRect(x, y, 2 + (index % 3), 1 + (index % 2));
  }

  context.fillStyle = 'rgba(255, 255, 255, 0.78)';
  context.fillRect(trackLeft + trackWidth - 12, trackTop, 6, trackHeight);

  const runners = visualRunners.length > 0 ? visualRunners : [];

  if (runners.length === 0) {
    context.fillStyle = '#273443';
    context.fillRect(trackLeft + 16, trackTop + trackHeight * 0.48, 56, 20);
  }

  runners.forEach((runner) => {
    const progress = clampNumber((runner.mesh.position.x - startX) / (finishX - startX), 0, 1);
    const x = trackLeft + 28 + progress * (trackWidth - 64);
    const y = trackTop + (trackHeight / laneCount) * (runner.lane + 0.5);
    const color = `#${runner.placement.entry.profile.color.toString(16).padStart(6, '0')}`;
    const accent = `#${runner.placement.entry.profile.secondaryColor.toString(16).padStart(6, '0')}`;

    context.fillStyle = runner.eliminated ? '#667085' : color;
    context.beginPath();
    context.ellipse(x, y, 18, 8, 0, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = accent;
    context.beginPath();
    context.arc(x + 15, y - 6, 6, 0, Math.PI * 2);
    context.fill();

    if (isFrenzySkillActive(runner.placement)) {
      context.strokeStyle = '#ff3030';
      context.lineWidth = 3;
      context.beginPath();
      context.arc(x, y, 28 + Math.sin(raceElapsed * 9) * 4, 0, Math.PI * 2);
      context.stroke();

      context.fillStyle = '#ff8a00';
      for (const offset of [-14, 0, 14]) {
        context.beginPath();
        context.moveTo(x + offset, y - 18 - Math.sin(raceElapsed * 18 + offset) * 4);
        context.lineTo(x + offset - 6, y - 3);
        context.lineTo(x + offset + 6, y - 3);
        context.closePath();
        context.fill();
      }
    }
  });

  drawFallbackHelicopter(context, width, height, trackTop, trackHeight, trackLeft, trackWidth, laneCount);
  context.restore();
}

function drawFallbackHelicopter(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  trackTop: number,
  trackHeight: number,
  trackLeft: number,
  trackWidth: number,
  laneCount: number
) {
  const race = getCurrentRace();
  const hazardEvent = race ? getActiveHazardEvent(race.hazardEvents) : null;

  if (!hazardEvent) {
    return;
  }

  const target = visualRunners.find((runner) => runner.placement.entry.id === hazardEvent.targetEntryId);

  if (!target) {
    return;
  }

  const sequenceStart = getHazardSequenceStart(race?.hazardEvents ?? []);
  const arrivalProgress = smoothStep(clampNumber((raceElapsed - sequenceStart) / helicopterEntranceSeconds, 0, 1));
  const targetProgress = clampNumber((target.mesh.position.x - startX) / (finishX - startX), 0, 1);
  const targetX = trackLeft + 28 + targetProgress * (trackWidth - 64);
  const targetY = trackTop + (trackHeight / Math.max(laneCount, 1)) * (target.lane + 0.5);
  const mobilePortrait = width < 760 && height > width;
  const helicopterScale = mobilePortrait ? 1.38 : 1;
  const entryX = mobilePortrait ? width * 0.52 : width * 0.9;
  const hoverX = mobilePortrait ? width * 0.5 : width * 0.72;
  const entryY = mobilePortrait ? Math.max(130, trackTop - 116) : Math.max(108, trackTop - 92);
  const hoverY = mobilePortrait ? Math.max(138, trackTop - 146) : Math.max(116, trackTop - 128);
  const helicopterX = lerpNumber(entryX, hoverX, arrivalProgress);
  const helicopterY = lerpNumber(entryY, hoverY, arrivalProgress) + Math.sin(raceElapsed * 3) * 5;
  const shotTiming = getShotTiming(hazardEvent);
  const shotActive = raceElapsed >= shotTiming.shotStart && raceElapsed <= shotTiming.impactEnd;
  const visualBounds = {
    left: (helicopterX - 82 * helicopterScale) / width,
    right: (helicopterX + 66 * helicopterScale) / width,
    top: (helicopterY - 26 * helicopterScale) / height,
    bottom: (helicopterY + 42 * helicopterScale) / height
  };

  context.save();
  context.translate(helicopterX, helicopterY);
  context.scale(helicopterScale, helicopterScale);
  context.rotate(Math.sin(raceElapsed * 2) * 0.08);

  context.strokeStyle = 'rgba(17, 24, 39, 0.74)';
  context.lineWidth = 4;
  context.beginPath();
  context.moveTo(-62, -18);
  context.lineTo(62, -18);
  context.stroke();

  context.strokeStyle = 'rgba(17, 24, 39, 0.72)';
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(0, -16);
  context.lineTo(0, 4);
  context.stroke();

  context.fillStyle = '#c2413a';
  context.fillRect(-60, 15, 48, 7);
  context.fillRect(-68, 11, 10, 14);
  context.strokeStyle = 'rgba(17, 24, 39, 0.8)';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(-70, 18);
  context.lineTo(-82, 18);
  context.moveTo(-78, 8);
  context.lineTo(-78, 28);
  context.moveTo(-86, 18);
  context.lineTo(-70, 18);
  context.stroke();

  context.fillStyle = '#c2413a';
  context.beginPath();
  context.ellipse(0, 20, 34, 15, 0, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#9ed8ff';
  context.beginPath();
  context.ellipse(24, 17, 14, 10, 0, 0, Math.PI * 2);
  context.fill();

  context.strokeStyle = 'rgba(17, 24, 39, 0.8)';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(18, 33);
  context.lineTo(36, 39);
  context.stroke();

  context.strokeStyle = 'rgba(255, 255, 255, 0.72)';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(-34, 37);
  context.lineTo(24, 37);
  context.stroke();
  context.restore();

  raceStage.dataset.helicopterInFrame = String(
    visualBounds.left > 0.04 &&
      visualBounds.right < 0.96 &&
      visualBounds.top > 0.08 &&
      visualBounds.bottom < 0.78
  );
  raceStage.dataset.helicopterScreenX = (helicopterX / width).toFixed(3);
  raceStage.dataset.helicopterScreenY = (helicopterY / height).toFixed(3);
  raceStage.dataset.helicopterBoxLeft = visualBounds.left.toFixed(3);
  raceStage.dataset.helicopterBoxRight = visualBounds.right.toFixed(3);
  raceStage.dataset.helicopterBoxTop = visualBounds.top.toFixed(3);
  raceStage.dataset.helicopterBoxBottom = visualBounds.bottom.toFixed(3);
  raceStage.dataset.helicopterBoxWidth = (visualBounds.right - visualBounds.left).toFixed(3);
  raceStage.dataset.helicopterBoxHeight = (visualBounds.bottom - visualBounds.top).toFixed(3);
  raceStage.dataset.helicopterCameraDistance = mobilePortrait ? '9.80' : '14.00';

  if (!shotActive) {
    return;
  }

  const muzzleX = helicopterX + 36 * helicopterScale;
  const muzzleY = helicopterY + 39 * helicopterScale;
  const bulletProgress = clampNumber((raceElapsed - shotTiming.shotStart) / (hazardEvent.triggerSeconds - shotTiming.shotStart), 0, 1);
  const bulletX = lerpNumber(muzzleX, targetX, smoothStep(bulletProgress));
  const bulletY = lerpNumber(muzzleY, targetY, smoothStep(bulletProgress));

  context.strokeStyle = 'rgba(255, 241, 166, 0.9)';
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(muzzleX, muzzleY);
  context.lineTo(bulletX, bulletY);
  context.stroke();
}
let cameraSelectionLocked = false;
const cameraLookTarget = new THREE.Vector3();
const leaderboardItems = new Map<string, LeaderboardItemParts>();
const minimapDots = new Map<string, HTMLSpanElement>();

const runnerLabels = document.createElement('div');
runnerLabels.className = 'runner-labels';
app.appendChild(runnerLabels);

const helicopterGroup = new THREE.Group();
const helicopterAssetSlot = new THREE.Group();
const helicopterSniperRig = createHelicopterSniperRig();
const bulletMesh = createBulletMesh();
const muzzleFlash = createMuzzleFlash();
const impactBurst = createImpactBurst();
const frenzySnortGroup = createFrenzySnortGroup();
const victoryEffect = createVictoryEffectGroup();
helicopterGroup.visible = false;
helicopterGroup.add(helicopterAssetSlot, helicopterSniperRig);
scene.add(helicopterGroup);
scene.add(bulletMesh, muzzleFlash, impactBurst, frenzySnortGroup, victoryEffect.root);

const groundMaterial = makeSandMaterial(0xd1a368, 0xb7844f, 9, 5, 0.16);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(groundLength, groundWidth), groundMaterial);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const track = new THREE.Mesh(
  new THREE.BoxGeometry(trackVisualLength, 0.18, trackVisualWidth),
  makeSandMaterial(0xc98651, 0x9f6338, 18, 3, 0.22)
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
addRacecourseProps();

function makeSandMaterial(baseColor: number, speckleColor: number, repeatX: number, repeatY: number, bumpScale: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');

  if (context) {
    context.fillStyle = `#${baseColor.toString(16).padStart(6, '0')}`;
    context.fillRect(0, 0, canvas.width, canvas.height);

    for (let index = 0; index < 1400; index += 1) {
      const x = (index * 47 + index * index * 3) % canvas.width;
      const y = (index * 89 + index * 17) % canvas.height;
      const alpha = 0.08 + (index % 7) * 0.018;
      context.fillStyle = `rgba(${(speckleColor >> 16) & 255}, ${(speckleColor >> 8) & 255}, ${speckleColor & 255}, ${alpha})`;
      context.fillRect(x, y, 1 + (index % 3), 1 + (index % 2));
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.anisotropy = 4;

  return new THREE.MeshStandardMaterial({
    color: baseColor,
    map: texture,
    roughness: 0.94,
    metalness: 0,
    bumpMap: texture,
    bumpScale
  });
}

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

function addRacecourseProps() {
  const group = new THREE.Group();
  addStartGate(group);
  addFinishPosts(group);
  addDistanceBoards(group);
  addCrowdStrip(group);
  scene.add(group);
}

function addStartGate(group: THREE.Group) {
  const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x35525b, roughness: 0.62 });
  const panelMaterial = new THREE.MeshStandardMaterial({ color: 0xf2c94c, roughness: 0.5 });
  const x = startX - 2.8;
  const laneCount = 9;
  const zMin = -trackVisualWidth / 2 + 0.6;
  const zStep = (trackVisualWidth - 1.2) / laneCount;

  for (let index = 0; index <= laneCount; index += 1) {
    const z = zMin + zStep * index;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.15, 0.16), frameMaterial);
    post.position.set(x, 1.1, z);
    post.castShadow = true;
    group.add(post);
  }

  const topRail = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.2, trackVisualWidth - 0.3), frameMaterial);
  topRail.position.set(x, 2.15, 0);
  topRail.castShadow = true;
  group.add(topRail);

  const gateSign = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.58, trackVisualWidth * 0.42), panelMaterial);
  gateSign.position.set(x - 0.04, 2.58, 0);
  gateSign.castShadow = true;
  group.add(gateSign);
}

function addFinishPosts(group: THREE.Group) {
  const postMaterial = new THREE.MeshStandardMaterial({ color: 0xf8fbff, roughness: 0.36 });
  const capMaterial = new THREE.MeshStandardMaterial({ color: 0xf2c94c, roughness: 0.42 });
  const postZ = trackVisualWidth / 2 + 1.55;

  for (const z of [-postZ, postZ]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 4.2, 10), postMaterial);
    post.position.set(finishX, 2.14, z);
    post.castShadow = true;
    group.add(post);

    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.28, 14, 10), capMaterial);
    cap.position.set(finishX, 4.36, z);
    cap.castShadow = true;
    group.add(cap);
  }

  const finishArch = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18, trackVisualWidth + 3.6), postMaterial);
  finishArch.position.set(finishX, 4.12, 0);
  finishArch.castShadow = true;
  group.add(finishArch);
}

function addDistanceBoards(group: THREE.Group) {
  [
    { offset: 40, label: '400' },
    { offset: 80, label: '800' },
    { offset: 120, label: '1200' }
  ].forEach(({ offset, label }) => {
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(label.length > 3 ? 3.3 : 2.7, 1.08),
      makeDistanceBoardMaterial(label)
    );
    board.position.set(finishX - offset, 1.65, -(trackVisualWidth / 2 + 2.25));
    board.castShadow = true;
    group.add(board);

    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 1.45, 8),
      new THREE.MeshStandardMaterial({ color: 0x2f4753, roughness: 0.62 })
    );
    pole.position.set(finishX - offset, 0.78, -(trackVisualWidth / 2 + 2.25));
    pole.castShadow = true;
    group.add(pole);
  });
}

function makeDistanceBoardMaterial(label: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext('2d');

  if (context) {
    context.fillStyle = '#f8fbff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = '#2f4753';
    context.lineWidth = 12;
    context.strokeRect(6, 6, canvas.width - 12, canvas.height - 12);
    context.fillStyle = '#1f2f34';
    context.font = '900 58px system-ui, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(label, canvas.width / 2, canvas.height / 2 + 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
}

function addCrowdStrip(group: THREE.Group) {
  const standMaterial = new THREE.MeshStandardMaterial({ color: 0x27444c, roughness: 0.72 });
  const stepMaterial = new THREE.MeshStandardMaterial({ color: 0x365b64, roughness: 0.74 });
  const canopyMaterial = new THREE.MeshStandardMaterial({ color: 0x1d333a, roughness: 0.7 });
  const trackEdgeZ = -(trackVisualWidth / 2);
  const z = trackEdgeZ - 5.15;
  const frontZ = trackEdgeZ - 1.72;
  const standLength = trackVisualLength * 0.8;
  const standRows = 3;
  const frontPanelCount = 5;
  const spectatorCount = 720;

  const backWall = new THREE.Mesh(new THREE.BoxGeometry(standLength, 2.55, 0.22), standMaterial);
  backWall.position.set(8, 1.54, z - 2.18);
  backWall.castShadow = true;
  group.add(backWall);

  for (let row = 0; row < standRows; row += 1) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(standLength, 0.18, 2.35), stepMaterial);
    step.position.set(8, 0.34 + row * 0.36, z - 1.14 + row * 0.64);
    step.castShadow = true;
    group.add(step);
  }

  const frontRail = new THREE.Mesh(new THREE.BoxGeometry(standLength, 0.12, 0.1), canopyMaterial);
  frontRail.position.set(8, 1.22, z + 1.1);
  frontRail.castShadow = true;
  group.add(frontRail);

  const canopy = new THREE.Mesh(new THREE.BoxGeometry(standLength * 0.86, 0.18, 3.7), canopyMaterial);
  canopy.position.set(8, 3.05, z - 0.78);
  canopy.castShadow = true;
  group.add(canopy);

  const crowdMesh = new THREE.Mesh(new THREE.PlaneGeometry(standLength * 0.76, 2.12), makeCrowdMassMaterial(spectatorCount));
  crowdMesh.position.set(8, 1.95, z - 1.02);
  crowdMesh.renderOrder = 1;
  group.add(crowdMesh);

  for (let index = 0; index < frontPanelCount; index += 1) {
    const crowdSection = new THREE.Mesh(
      new THREE.PlaneGeometry(standLength * 0.13, 1.18),
      makeCrowdSectionMaterial(index)
    );
    crowdSection.position.set(8 - standLength * 0.32 + index * ((standLength * 0.64) / (frontPanelCount - 1)), 1.98, frontZ - 0.12);
    crowdSection.renderOrder = 3;
    group.add(crowdSection);
  }

  crowdBannerStandLength = standLength;
  crowdBannerFrontZ = frontZ;
  group.add(crowdBannerGroup);
  refreshCrowdBanners();

  const pennantStrip = new THREE.Mesh(new THREE.PlaneGeometry(standLength * 0.78, 0.52), makePennantStripMaterial());
  pennantStrip.position.set(8, 3.02, frontZ + 0.02);
  pennantStrip.renderOrder = 2;
  group.add(pennantStrip);

  raceStage.dataset.crowdQuality = 'procedural-crowd-wall';
  raceStage.dataset.crowdSpectators = String(spectatorCount);
  raceStage.dataset.crowdDrawGroups = '12';
}

function getCrowdBannerMessages() {
  const suffixes = ['!', ' 가자!', ' 우승!', ' 파이팅!'];
  return normalizeParticipants(participantInput.value.split(/\r?\n/)).map(
    (name, index) => `${name}${suffixes[index % suffixes.length]}`
  );
}

function getCrowdBannerLayout(count: number) {
  const rows = 1;
  const columns = Math.max(1, count);
  const usableWidth = crowdBannerStandLength * 0.76;
  const columnGap = Math.max(0.035, Math.min(0.55, usableWidth / (columns * 24)));
  const rowGap = 0;
  const width = (usableWidth - columnGap * (columns - 1)) / columns;
  const height = crowdBannerBandHeight;
  const left = 8 - usableWidth / 2;

  return {
    rows,
    columns,
    usableWidth,
    columnGap,
    rowGap,
    width,
    height,
    left
  };
}

function refreshCrowdBanners() {
  const messages = getCrowdBannerMessages();
  const layout = getCrowdBannerLayout(messages.length);

  crowdBannerGroup.children.forEach((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      const material = Array.isArray(child.material) ? child.material : [child.material];
      material.forEach((item) => {
        if (item instanceof THREE.MeshBasicMaterial && item.map) {
          item.map.dispose();
        }
        item.dispose();
      });
    }
  });
  crowdBannerGroup.clear();

  messages.forEach((message, index) => {
    const row = Math.floor(index / layout.columns);
    const column = index % layout.columns;
    const bannerMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(layout.width, layout.height),
      makeCrowdBannerMaterial(message, crowdBannerColors[index % crowdBannerColors.length])
    );
    bannerMesh.position.set(
      layout.left + layout.width / 2 + column * (layout.width + layout.columnGap),
      crowdBannerBandTopY - layout.height / 2 - row * (layout.height + layout.rowGap),
      crowdBannerFrontZ + 0.12
    );
    bannerMesh.renderOrder = 8;
    crowdBannerGroup.add(bannerMesh);
  });

  raceStage.dataset.crowdBannerMessages = messages.join('|');
  raceStage.dataset.crowdBannerCount = String(messages.length);
  raceStage.dataset.crowdBannerRows = String(layout.rows);
  raceStage.dataset.crowdBannerColumns = String(layout.columns);
  raceStage.dataset.crowdBannerWidth = layout.width.toFixed(2);
  raceStage.dataset.crowdBannerHeight = layout.height.toFixed(2);
}

function makeCrowdMassMaterial(spectatorCount: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  const shirtColors = ['#f2c94c', '#56ccf2', '#eb5757', '#6fcf97', '#bb6bd9', '#f2994a', '#f8fbff'];
  const skinColors = ['#ffd6a3', '#f2b880', '#d9965f', '#ffe0ba'];

  if (context) {
    const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, 'rgba(17, 34, 40, 0.94)');
    gradient.addColorStop(1, 'rgba(13, 27, 31, 0.72)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);

    for (let row = 0; row < 8; row += 1) {
      const rowY = 56 + row * 52;
      const rowCount = Math.floor(spectatorCount / 8);

      for (let index = 0; index < rowCount; index += 1) {
        const x = 22 + index * (canvas.width - 44) / (rowCount - 1) + (((index * 13 + row * 7) % 13) - 6);
        const y = rowY + (((index * 17 + row) % 9) - 4);
        const shirt = shirtColors[(index + row * 2) % shirtColors.length];
        const skin = skinColors[(index * 3 + row) % skinColors.length];
        const cheering = (index + row) % 6 === 0;

        context.strokeStyle = 'rgba(255, 255, 255, 0.72)';
        context.lineWidth = 2.4;
        context.beginPath();
        context.moveTo(x - 6, y + 16);
        context.lineTo(x - 14, y + (cheering ? -2 : 13));
        context.moveTo(x + 6, y + 16);
        context.lineTo(x + 14, y + (cheering ? -2 : 13));
        context.stroke();

        context.fillStyle = shirt;
        roundedCanvasRect(context, x - 10, y + 10, 20, 24, 6);
        context.fill();

        context.fillStyle = skin;
        context.beginPath();
        context.arc(x, y + 4, 7, 0, Math.PI * 2);
        context.fill();

        context.fillStyle = 'rgba(13, 24, 27, 0.44)';
        context.beginPath();
        context.arc(x - 2.4, y + 3, 0.95, 0, Math.PI * 2);
        context.arc(x + 2.4, y + 3, 0.95, 0, Math.PI * 2);
        context.fill();

        if ((index + row) % 23 === 0) {
          context.fillStyle = shirtColors[(index + 3) % shirtColors.length];
          context.fillRect(x + 10, y - 18, 18, 12);
          context.strokeStyle = 'rgba(248, 251, 255, 0.78)';
          context.lineWidth = 1.6;
          context.beginPath();
          context.moveTo(x + 9, y - 19);
          context.lineTo(x + 9, y + 16);
          context.stroke();
        }
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  return new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide
  });
}

function makeCrowdSectionMaterial(sectionIndex: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  const shirtColors = ['#e2b84a', '#4fb9db', '#d95d55', '#62b979', '#9d6bc4', '#d88643', '#e7edf2'];
  const skinColors = ['#e7c192', '#d9a06d', '#b97748', '#f1d1a8'];

  if (context) {
    const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, 'rgba(45, 78, 86, 0.56)');
    gradient.addColorStop(1, 'rgba(12, 25, 29, 0.76)');
    context.fillStyle = gradient;
    roundedCanvasRect(context, 0, 12, canvas.width, canvas.height - 16, 22);
    context.fill();

    for (let row = 0; row < 5; row += 1) {
      const y = 42 + row * 40;
      const count = row % 2 === 0 ? 30 : 34;

      for (let index = 0; index < count; index += 1) {
        const x = 24 + index * ((canvas.width - 48) / (count - 1)) + (((index * 19 + row * 11 + sectionIndex * 7) % 11) - 5);
        const bob = (((index * 13 + row * 5 + sectionIndex) % 7) - 3);
        const shirt = shirtColors[(index + row + sectionIndex) % shirtColors.length];
        const skin = skinColors[(index * 2 + row + sectionIndex) % skinColors.length];

        context.fillStyle = shirt;
        roundedCanvasRect(context, x - 10, y + 14 + bob, 20, 18, 6);
        context.fill();

        context.fillStyle = skin;
        context.beginPath();
        context.arc(x, y + 8 + bob, 7, 0, Math.PI * 2);
        context.fill();

        if ((index + row + sectionIndex) % 4 === 0) {
          context.strokeStyle = 'rgba(248, 251, 255, 0.48)';
          context.lineWidth = 2.2;
          context.lineCap = 'round';
          context.beginPath();
          context.moveTo(x - 8, y + 18 + bob);
          context.lineTo(x - 16, y + 5 + bob);
          context.moveTo(x + 8, y + 18 + bob);
          context.lineTo(x + 16, y + 5 + bob);
          context.stroke();
        }

        if ((index + row + sectionIndex) % 9 === 0) {
          context.fillStyle = 'rgba(248, 251, 255, 0.36)';
          context.fillRect(x - 9, y - 5 + bob, 18, 4);
        }
      }
    }

    for (let index = 0; index < 7; index += 1) {
      const x = 72 + index * 140 + ((sectionIndex + index) % 2) * 20;
      const y = 30 + (index % 2) * 56;
      context.fillStyle = shirtColors[(index + sectionIndex + 3) % shirtColors.length];
      context.fillRect(x, y, 32, 20);
      context.strokeStyle = 'rgba(248, 251, 255, 0.58)';
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(x - 3, y - 3);
      context.lineTo(x - 3, y + 58);
      context.stroke();
    }

    context.fillStyle = 'rgba(8, 18, 20, 0.24)';
    for (let row = 0; row < 4; row += 1) {
      context.fillRect(0, 62 + row * 40, canvas.width, 3);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  return new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide
  });
}

function makeCrowdBannerMaterial(message: string, color: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 896;
  canvas.height = 320;
  const context = canvas.getContext('2d');

  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = 'rgba(8, 18, 20, 0.72)';
    roundedCanvasRect(context, 6, 18, canvas.width - 12, 248, 28);
    context.fill();
    context.fillStyle = color;
    roundedCanvasRect(context, 22, 34, canvas.width - 44, 218, 26);
    context.fill();
    context.strokeStyle = 'rgba(17, 31, 34, 0.82)';
    context.lineWidth = 14;
    roundedCanvasRect(context, 22, 34, canvas.width - 44, 218, 26);
    context.stroke();
    context.shadowColor = 'rgba(255, 255, 255, 0.62)';
    context.shadowBlur = 8;
    context.shadowOffsetY = 2;
    context.fillStyle = '#102019';
    context.font = '900 128px system-ui, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(fitCanvasText(context, message, canvas.width - 112), canvas.width / 2, 143);
    context.shadowColor = 'transparent';
    context.shadowBlur = 0;
    context.shadowOffsetY = 0;
    context.fillStyle = 'rgba(255, 255, 255, 0.62)';
    context.fillRect(84, 236, canvas.width - 168, 9);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  return new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide
  });
}

function makePennantStripMaterial() {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  const colors = ['#f2c94c', '#56ccf2', '#eb5757', '#6fcf97', '#bb6bd9'];

  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = 'rgba(248, 251, 255, 0.82)';
    context.lineWidth = 5;
    context.beginPath();
    context.moveTo(0, 26);
    context.lineTo(canvas.width, 26);
    context.stroke();

    for (let index = 0; index < 58; index += 1) {
      const x = index * (canvas.width / 57);
      context.fillStyle = colors[index % colors.length];
      context.beginPath();
      context.moveTo(x, 29);
      context.lineTo(x + 24, 96);
      context.lineTo(x + 48, 29);
      context.closePath();
      context.fill();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  return new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide
  });
}

function roundedCanvasRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function createFrenzySnortGroup() {
  const group = new THREE.Group();
  const puffs: SnortPuffParts[] = [];

  for (let burstIndex = 0; burstIndex < 2; burstIndex += 1) {
    for (const nostrilSide of [-1, 1]) {
      const material = new THREE.MeshBasicMaterial({
        color: 0xf4fbff,
        transparent: true,
        opacity: 0,
        depthWrite: false
      });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 10), material);
      mesh.visible = false;
      group.add(mesh);
      puffs.push({ mesh, material, burstIndex, nostrilSide });
    }
  }

  group.visible = false;
  group.userData.puffs = puffs;
  return group;
}

function createVictoryEffectGroup(): VictoryEffectParts {
  const root = new THREE.Group();
  const crown = new THREE.Group();
  const rings: THREE.Mesh[] = [];
  const beams: THREE.Mesh[] = [];
  const sparks: THREE.Mesh[] = [];
  const materials: THREE.MeshBasicMaterial[] = [];
  const spotlightMaterial = new THREE.MeshBasicMaterial({
    color: 0xf2c94c,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide
  });
  const goldMaterial = new THREE.MeshBasicMaterial({
    color: 0xf2c94c,
    transparent: true,
    opacity: 0,
    depthWrite: false
  });

  root.visible = false;
  root.renderOrder = 20;
  crown.position.y = 3.55;
  crown.renderOrder = 22;
  materials.push(goldMaterial);

  const spotlight = new THREE.Mesh(new THREE.CircleGeometry(3.25, 64), spotlightMaterial);
  spotlight.rotation.x = -Math.PI / 2;
  spotlight.position.y = -horseBaseY + 0.08;
  spotlight.renderOrder = 16;
  root.add(spotlight);

  const crownBand = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.055, 8, 48), goldMaterial);
  crownBand.rotation.x = Math.PI / 2;
  crown.add(crownBand);

  for (let index = 0; index < 5; index += 1) {
    const angle = (Math.PI * 2 * index) / 5;
    const point = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.5, 5), goldMaterial);
    point.position.set(Math.cos(angle) * 0.43, 0.28, Math.sin(angle) * 0.43);
    point.rotation.z = Math.sin(angle) * 0.18;
    point.rotation.x = -Math.cos(angle) * 0.18;
    point.renderOrder = 22;
    crown.add(point);
  }

  root.add(crown);

  for (let index = 0; index < 3; index += 1) {
    const material = new THREE.MeshBasicMaterial({
      color: index === 1 ? 0xffffff : 0xf2c94c,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.45 + index * 0.42, 0.035, 8, 80), material);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.2 + index * 0.44;
    ring.renderOrder = 21;
    rings.push(ring);
    materials.push(material);
    root.add(ring);
  }

  for (let index = 0; index < 4; index += 1) {
    const material = new THREE.MeshBasicMaterial({
      color: index % 2 === 0 ? 0xffffff : 0x56ccf2,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide
    });
    const beam = new THREE.Mesh(new THREE.ConeGeometry(0.2, 4.6, 5, 1, true), material);
    const angle = (Math.PI * 2 * index) / 4 + Math.PI / 4;
    beam.position.set(Math.cos(angle) * 1.15, 2.25, Math.sin(angle) * 1.15);
    beam.rotation.x = Math.PI + 0.42;
    beam.rotation.z = angle;
    beam.userData.phase = index * 0.7;
    beam.renderOrder = 18;
    beams.push(beam);
    materials.push(material);
    root.add(beam);
  }

  for (let index = 0; index < 24; index += 1) {
    const material = new THREE.MeshBasicMaterial({
      color: index % 3 === 0 ? 0xff4d8d : index % 3 === 1 ? 0xf2c94c : 0x6fcf97,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false
    });
    const spark = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07 + (index % 4) * 0.018, 0), material);
    spark.userData.phase = index * 0.53;
    spark.userData.radius = 1.35 + (index % 6) * 0.24;
    spark.renderOrder = 23;
    sparks.push(spark);
    materials.push(material);
    root.add(spark);
  }

  return {
    root,
    crown,
    spotlight,
    rings,
    beams,
    sparks,
    materials
  };
}

function createCapsuleBetween(start: THREE.Vector3, end: THREE.Vector3, radius: number, material: THREE.Material, radialSegments = 8) {
  const direction = end.clone().sub(start);
  const length = Math.max(radius * 2.2, direction.length());
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, Math.max(0.01, length - radius * 2), 5, radialSegments), material);

  mesh.position.copy(start).lerp(end, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  mesh.castShadow = true;
  return mesh;
}

function createHorse(profile: HorseProfile, runnerName: string) {
  const group = new THREE.Group();
  const fallbackHorse = createFallbackHorseBody(profile, runnerName);
  const rider = createRider(profile.color, profile.secondaryColor);
  const effect = createRunnerSkillEffect(profile.secondaryColor);

  group.add(fallbackHorse.root);
  group.add(rider.root);
  group.add(effect);
  group.userData.legs = fallbackHorse.legs;
  group.userData.motionStyle = fallbackHorse.motionStyle;
  group.userData.horseRig = fallbackHorse.rig;
  group.userData.rider = rider;
  group.userData.effect = effect;

  return group;
}

function createFallbackHorseBody(profile: HorseProfile, runnerName: string) {
  const root = new THREE.Group();
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: profile.color, roughness: 0.58, metalness: 0.02 });
  const accentMaterial = new THREE.MeshStandardMaterial({ color: profile.secondaryColor, roughness: 0.55, metalness: 0.02 });
  const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x2d2020, roughness: 0.76 });
  const eyeMaterial = new THREE.MeshStandardMaterial({ color: 0x090909, roughness: 0.38 });
  const saddleMaterial = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.58 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.54, 2.24, 8, 18), bodyMaterial);
  body.rotation.z = Math.PI / 2;
  body.position.y = 0.25;
  body.scale.set(1.42, 0.78, 0.66);
  body.castShadow = true;
  root.add(body);

  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.5, 18, 12), bodyMaterial);
  chest.position.set(0.78, 0.36, 0);
  chest.scale.set(0.86, 1.16, 0.76);
  chest.castShadow = true;
  root.add(chest);

  const haunch = new THREE.Mesh(new THREE.SphereGeometry(0.56, 18, 12), bodyMaterial);
  haunch.position.set(-0.88, 0.32, 0);
  haunch.scale.set(1.12, 1, 0.82);
  haunch.castShadow = true;
  root.add(haunch);

  const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 10), accentMaterial);
  shoulder.position.set(0.58, 0.32, 0.42);
  shoulder.scale.set(0.65, 1.02, 0.28);
  shoulder.castShadow = true;
  root.add(shoulder);

  const hip = shoulder.clone();
  hip.position.set(-0.86, 0.3, -0.42);
  hip.castShadow = true;
  root.add(hip);

  const neck = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 1.06, 6, 12), bodyMaterial);
  neck.rotation.z = -0.66;
  neck.position.set(1.12, 0.9, 0);
  neck.scale.set(0.86, 1, 0.82);
  neck.castShadow = true;
  root.add(neck);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.36, 18, 12), bodyMaterial);
  head.scale.set(1.24, 0.72, 0.62);
  head.position.set(1.62, 1.18, 0);
  head.castShadow = true;
  root.add(head);

  const muzzle = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 10), bodyMaterial);
  muzzle.position.set(1.94, 1.09, 0);
  muzzle.scale.set(1.12, 0.58, 0.52);
  muzzle.castShadow = true;
  root.add(muzzle);

  for (const z of [-0.16, 0.16]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.28, 8), bodyMaterial);
    ear.position.set(1.4, 1.48, z);
    ear.rotation.z = z > 0 ? -0.28 : -0.12;
    ear.castShadow = true;
    root.add(ear);

    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), eyeMaterial);
    eye.position.set(1.86, 1.2, z * 0.78);
    eye.castShadow = true;
    root.add(eye);
  }

  addPattern(root, profile.pattern, accentMaterial);

  for (let index = 0; index < 6; index += 1) {
    const maneTuft = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.34, 7), darkMaterial);
    maneTuft.position.set(0.72 + index * 0.11, 1.48 - index * 0.07, 0);
    maneTuft.rotation.z = -0.72;
    maneTuft.scale.set(0.8, 1, 0.62);
    maneTuft.castShadow = true;
    root.add(maneTuft);
  }

  const saddle = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.14, 0.72), saddleMaterial);
  saddle.position.set(-0.06, 0.96, 0);
  saddle.castShadow = true;
  root.add(saddle);

  addFlankNameplate(root, profile.secondaryColor, runnerName);

  const legParts: HorseLegParts[] = [];
  const motionStyles: HorseMotionStyle[] = ['rush', 'run', 'walk', 'stroll'];
  const motionStyle = motionStyles[getStableIndex(profile.id, motionStyles.length)] ?? 'run';

  for (const x of [-0.86, 0.62]) {
    for (const z of [-0.32, 0.32]) {
      const upperBaseRotation = x < 0 ? -0.08 : 0.08;
      const lowerBaseRotation = x < 0 ? 0.12 : -0.12;
      const hoofBaseRotation = x < 0 ? -0.03 : 0.03;
      const hipJoint = new THREE.Group();
      hipJoint.position.set(x, 0.1, z);
      hipJoint.rotation.z = upperBaseRotation;
      root.add(hipJoint);

      const upperLeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.105, 0.7, 5, 10), bodyMaterial);
      upperLeg.position.set(0, -0.36, 0);
      upperLeg.castShadow = true;
      hipJoint.add(upperLeg);

      const kneeJoint = new THREE.Group();
      kneeJoint.position.set(x < 0 ? -0.06 : 0.06, -0.76, 0);
      kneeJoint.rotation.z = lowerBaseRotation;
      hipJoint.add(kneeJoint);

      const knee = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), bodyMaterial);
      knee.scale.set(0.85, 0.8, 0.85);
      knee.castShadow = true;
      kneeJoint.add(knee);

      const lowerLeg = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.66, 4, 8), darkMaterial);
      lowerLeg.position.set(x < 0 ? -0.02 : 0.02, -0.37, 0);
      lowerLeg.castShadow = true;
      kneeJoint.add(lowerLeg);

      const hoofJoint = new THREE.Group();
      hoofJoint.position.set(x < 0 ? -0.03 : 0.03, -0.74, 0);
      hoofJoint.rotation.z = hoofBaseRotation;
      kneeJoint.add(hoofJoint);

      const hoof = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.1, 0.16), darkMaterial);
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

  const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.105, 1.05, 4, 8), darkMaterial);
  tail.rotation.z = 1.08;
  tail.position.set(-1.62, 0.52, 0);
  tail.castShadow = true;
  root.add(tail);

  const shadow = createHorseGroundShadow();
  root.add(shadow);

  const { dust, materials: dustMaterials } = createHorseDustPuffs(profile.secondaryColor);
  dust.forEach((puff) => root.add(puff));

  return {
    root,
    legs: legParts,
    motionStyle,
    rig: {
      root,
      body,
      chest,
      haunch,
      neck,
      head,
      tail,
      shadow,
      dust,
      dustMaterials
    }
  };
}

function createHorseGroundShadow() {
  const material = new THREE.MeshBasicMaterial({
    color: 0x24301f,
    transparent: true,
    opacity: 0.18,
    depthWrite: false
  });
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(1.72, 32), material);
  shadow.name = 'procedural-horse-contact-shadow';
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(-0.1, -1.38, 0);
  shadow.scale.set(1.18, 0.32, 1);
  shadow.renderOrder = 2;
  return shadow;
}

function createHorseDustPuffs(accentColor: number) {
  const dust: THREE.Mesh[] = [];
  const materials: THREE.MeshBasicMaterial[] = [];
  const color = new THREE.Color(0xd7c1a1).lerp(new THREE.Color(accentColor), 0.12);

  for (let index = 0; index < 10; index += 1) {
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false
    });
    const puff = new THREE.Mesh(new THREE.SphereGeometry(0.08 + (index % 3) * 0.018, 8, 6), material);
    puff.name = 'procedural-horse-dust';
    puff.position.set(-0.86 + (index % 5) * 0.36, -1.28, (index % 2 === 0 ? -1 : 1) * (0.42 + (index % 3) * 0.04));
    puff.userData.phase = index * 0.67;
    puff.userData.side = index % 2 === 0 ? -1 : 1;
    puff.renderOrder = 7;
    dust.push(puff);
    materials.push(material);
  }

  return { dust, materials };
}

function addFlankNameplate(root: THREE.Group, accentColor: number, runnerName: string) {
  const numberMaterial = makeFlankNameplateMaterial(accentColor, runnerName);

  for (const side of [-1, 1]) {
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.82, 0.72), numberMaterial);
    cloth.position.set(-0.16, 0.64, side * 0.574);
    cloth.rotation.y = side > 0 ? 0 : Math.PI;
    cloth.castShadow = true;
    cloth.renderOrder = 9;
    root.add(cloth);
  }
}

function makeFlankNameplateMaterial(accentColor: number, runnerName: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 192;
  const context = canvas.getContext('2d');

  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.shadowColor = 'rgba(8, 18, 20, 0.28)';
    context.shadowBlur = 16;
    context.shadowOffsetY = 6;
    context.fillStyle = '#1f2937';
    fillRoundedRect(context, 8, 8, canvas.width - 16, canvas.height - 16, 34);
    context.shadowColor = 'transparent';
    context.fillStyle = `#${accentColor.toString(16).padStart(6, '0')}`;
    fillRoundedRect(context, 18, 18, canvas.width - 36, canvas.height - 36, 28);
    context.fillStyle = 'rgba(255, 255, 255, 0.92)';
    fillRoundedRect(context, 34, 30, canvas.width - 68, canvas.height - 60, 24);
    context.strokeStyle = '#1f2937';
    context.lineWidth = 8;
    strokeRoundedRect(context, 34, 30, canvas.width - 68, canvas.height - 60, 24);
    context.fillStyle = '#111827';
    context.font = '900 86px system-ui, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(fitCanvasText(context, runnerName, 408), canvas.width / 2, canvas.height / 2 + 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false
  });
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -1;
  return material;
}

function createRunnerSkillEffect(color: number) {
  const effectMaterial = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.62,
    side: THREE.DoubleSide
  });

  const effect = new THREE.Mesh(new THREE.TorusGeometry(1.28, 0.05, 8, 44), effectMaterial);
  effect.rotation.x = Math.PI / 2;
  effect.position.y = 0.08;
  effect.visible = false;
  return effect;
}

function createFrenzyFire(): FrenzyFireParts {
  const root = new THREE.Group();
  const flames: THREE.Mesh[] = [];
  const materials: THREE.MeshBasicMaterial[] = [];
  const positions = [
    [-0.84, -1.02, -0.42, 0.42],
    [-0.84, -1.02, 0.42, 0.42],
    [0.62, -1.02, -0.42, 0.38],
    [0.62, -1.02, 0.42, 0.38],
    [riderMountX + 0.08, riderMountY + 1.08, 0, 0.68]
  ] as const;

  root.visible = false;

  positions.forEach(([x, y, z, scale], index) => {
    const material = new THREE.MeshBasicMaterial({
      color: index === positions.length - 1 ? 0xff3b1f : 0xff8a00,
      transparent: true,
      opacity: 0.86,
      depthWrite: false
    });
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.62, 8), material);
    flame.position.set(x, y, z);
    flame.scale.setScalar(scale);
    flame.userData.baseY = y;
    flame.userData.baseScale = scale;
    flame.userData.phase = index * 1.17;
    flame.renderOrder = 8;
    root.add(flame);
    flames.push(flame);
    materials.push(material);

    if (index === positions.length - 1) {
      const innerMaterial = new THREE.MeshBasicMaterial({
        color: 0xfff06a,
        transparent: true,
        opacity: 0.82,
        depthWrite: false
      });
      const innerFlame = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.44, 8), innerMaterial);
      innerFlame.position.set(x + 0.02, y - 0.02, z);
      innerFlame.scale.setScalar(scale * 0.86);
      innerFlame.userData.baseY = y - 0.02;
      innerFlame.userData.baseScale = scale * 0.86;
      innerFlame.userData.phase = index * 1.17 + 0.64;
      innerFlame.renderOrder = 9;
      root.add(innerFlame);
      flames.push(innerFlame);
      materials.push(innerMaterial);
    }
  });

  return { root, flames, materials };
}

function createRocketFart(): RocketFartParts {
  const root = new THREE.Group();
  const puffs: THREE.Mesh[] = [];
  const materials: THREE.MeshBasicMaterial[] = [];
  const colors = [0xd7ff7a, 0xc4e86b, 0xf2e58a, 0xa6c957, 0x8b6f3f];

  root.visible = false;
  root.position.set(-1.62, 0.52, 0);

  for (let index = 0; index < 14; index += 1) {
    const material = new THREE.MeshBasicMaterial({
      color: colors[index % colors.length] ?? 0xd7ff7a,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false
    });
    const puff = new THREE.Mesh(new THREE.SphereGeometry(0.16 + (index % 4) * 0.035, 12, 8), material);
    puff.userData.phase = index * 0.31;
    puff.renderOrder = 10;
    puffs.push(puff);
    materials.push(material);
    root.add(puff);
  }

  return { root, puffs, materials };
}

function createFrenzyVortex(accentColor: number): FrenzyVortexParts {
  const root = new THREE.Group();
  const rings: THREE.Mesh[] = [];
  const dust: THREE.Mesh[] = [];
  const smokeSprites: THREE.Sprite[] = [];
  const smokeMaterials: THREE.SpriteMaterial[] = [];
  const ringColors = [0xffffff, accentColor, 0xff4d4d];
  const textures = getFrenzyParticleTextures();

  root.position.y = 0.12;
  root.visible = false;

  for (let index = 0; index < 5; index += 1) {
    const material = new THREE.MeshBasicMaterial({
      color: ringColors[index % ringColors.length] ?? 0xffffff,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
      depthTest: false
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.92 + index * 0.2, 0.05, 8, 72), material);
    ring.rotation.x = Math.PI / 2;
    ring.rotation.y = index % 2 === 0 ? 0.34 : -0.34;
    ring.rotation.z = index * 0.42;
    ring.position.y = 0.04 + index * 0.28;
    rings.push(ring);
    root.add(ring);
  }

  for (let index = 0; index < 22; index += 1) {
    const material = new THREE.MeshBasicMaterial({
      color: index % 3 === 0 ? 0xffe9a6 : 0xffffff,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      depthTest: false
    });
    const particle = new THREE.Mesh(new THREE.SphereGeometry(0.085 + (index % 4) * 0.018, 8, 6), material);
    particle.userData.phase = index * 0.77;
    dust.push(particle);
    root.add(particle);
  }

  for (let index = 0; index < 14; index += 1) {
    const material = new THREE.SpriteMaterial({
      alphaMap: textures[index % textures.length],
      color: index % 4 === 0 ? 0xff7a2a : 0xf7fbff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false
    });
    const smoke = new THREE.Sprite(material);
    smoke.userData.phase = index * 0.91;
    smoke.userData.baseScale = 0.74 + (index % 5) * 0.16;
    smoke.renderOrder = 12;
    smokeSprites.push(smoke);
    smokeMaterials.push(material);
    root.add(smoke);
  }

  return { root, rings, dust, smokeSprites, smokeMaterials };
}

function createDanceMirrorBall(accentColor: number): DanceMirrorBallParts {
  const root = new THREE.Group();
  const beams: THREE.Mesh[] = [];
  const sparkles: THREE.Mesh[] = [];
  const materials: THREE.MeshBasicMaterial[] = [];
  const beamColors = [0xffffff, accentColor, 0x74d7ff, 0xff78cf, 0xfff06a];

  root.visible = false;
  root.position.set(-0.34, 2.78, -0.16);

  const hangerMaterial = new THREE.MeshBasicMaterial({ color: 0xdce7f2, transparent: true, opacity: 0.54 });
  const hanger = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.96, 8), hangerMaterial);
  hanger.position.y = 0.66;
  root.add(hanger);
  materials.push(hangerMaterial);

  const ball = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.46, 2),
    new THREE.MeshStandardMaterial({
      color: 0xdfe8ff,
      metalness: 0.72,
      roughness: 0.18,
      emissive: 0x607dff,
      emissiveIntensity: 0.28
    })
  );
  ball.position.y = 0.1;
  ball.castShadow = true;
  root.add(ball);

  const tileMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    wireframe: true,
    transparent: true,
    opacity: 0.5,
    depthWrite: false
  });
  const tiles = new THREE.Mesh(new THREE.IcosahedronGeometry(0.476, 2), tileMaterial);
  tiles.name = 'dance-mirrorball-tiles';
  tiles.position.copy(ball.position);
  root.add(tiles);
  materials.push(tileMaterial);

  for (let index = 0; index < 6; index += 1) {
    const material = new THREE.MeshBasicMaterial({
      color: beamColors[index % beamColors.length] ?? 0xffffff,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide
    });
    const beam = new THREE.Mesh(new THREE.ConeGeometry(0.18, 1.18, 4, 1, true), material);
    beam.userData.phase = index * 0.72;
    beam.position.set(Math.cos(index * 1.05) * 0.52, -0.72, Math.sin(index * 1.05) * 0.52);
    beam.rotation.x = Math.PI + 0.58 + Math.sin(index) * 0.1;
    beam.rotation.z = index * 1.05;
    beam.renderOrder = 9;
    root.add(beam);
    beams.push(beam);
    materials.push(material);
  }

  for (let index = 0; index < 14; index += 1) {
    const material = new THREE.MeshBasicMaterial({
      color: beamColors[(index + 1) % beamColors.length] ?? 0xffffff,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      depthTest: false
    });
    const sparkle = new THREE.Mesh(new THREE.SphereGeometry(0.035 + (index % 3) * 0.01, 8, 6), material);
    sparkle.userData.phase = index * 0.53;
    sparkle.renderOrder = 10;
    root.add(sparkle);
    sparkles.push(sparkle);
    materials.push(material);
  }

  materials.forEach((material) => {
    material.userData.baseOpacity = material.opacity;
  });

  return { root, ball, beams, sparkles, materials };
}

function createFlatGlideEffect(accentColor: number): FlatGlideParts {
  const root = new THREE.Group();
  const streaks: THREE.Mesh[] = [];
  const ripples: THREE.Mesh[] = [];
  const dust: THREE.Mesh[] = [];
  const materials: THREE.MeshBasicMaterial[] = [];
  const trailColors = [0xff4d6d, 0xff9f1c, 0xffe45c, 0x52d66b, 0x54d8ff, 0x5f7cff, 0xb86cff];

  root.visible = false;
  root.position.set(-0.58, -0.22, 0);

  for (let index = 0; index < 9; index += 1) {
    const material = new THREE.MeshBasicMaterial({
      color: trailColors[index % trailColors.length] ?? accentColor,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide
    });
    const streak = new THREE.Mesh(new THREE.BoxGeometry(1.58 + (index % 3) * 0.5, 0.034, 0.068), material);
    streak.userData.phase = index * 0.47;
    streak.userData.baseZ = (index - 4) * 0.16;
    streak.userData.baseLength = 1.58 + (index % 3) * 0.5;
    streak.renderOrder = 11;
    root.add(streak);
    streaks.push(streak);
    materials.push(material);
  }

  for (let index = 0; index < 4; index += 1) {
    const material = new THREE.MeshBasicMaterial({
      color: index % 2 === 0 ? 0xffffff : 0x8fe8ff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false
    });
    const ripple = new THREE.Mesh(new THREE.TorusGeometry(0.34 + index * 0.08, 0.018, 8, 64), material);
    ripple.rotation.x = Math.PI / 2;
    ripple.userData.phase = index * 0.23;
    ripple.renderOrder = 7;
    root.add(ripple);
    ripples.push(ripple);
    materials.push(material);
  }

  for (let index = 0; index < 12; index += 1) {
    const material = new THREE.MeshBasicMaterial({
      color: index % 3 === 0 ? 0xffffff : (trailColors[index % trailColors.length] ?? 0xb9f2ff),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false
    });
    const puff = new THREE.Mesh(new THREE.SphereGeometry(0.035 + (index % 4) * 0.01, 8, 6), material);
    puff.userData.phase = index * 0.39;
    puff.renderOrder = 10;
    root.add(puff);
    dust.push(puff);
    materials.push(material);
  }

  return { root, streaks, ripples, dust, materials };
}

function createRider(primaryColor: number, secondaryColor: number): RiderParts {
  return createFallbackRider(primaryColor, secondaryColor);
}

function createFallbackRider(primaryColor: number, secondaryColor: number): RiderParts {
  const root = new THREE.Group();
  const skinMaterial = new THREE.MeshStandardMaterial({ color: 0xf4d6b0, roughness: 0.52 });
  const shirtMaterial = new THREE.MeshStandardMaterial({ color: primaryColor, roughness: 0.5, metalness: 0.02 });
  const accentMaterial = new THREE.MeshStandardMaterial({ color: secondaryColor, roughness: 0.52, metalness: 0.02 });
  const tightsMaterial = new THREE.MeshStandardMaterial({ color: 0xf6f4ec, roughness: 0.46 });
  const bootMaterial = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.68 });

  root.position.set(riderMountX, riderMountY, 0);
  root.scale.setScalar(riderScale);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.23, 0.56, 7, 14), shirtMaterial);
  torso.position.set(0.12, 0.22, 0);
  torso.rotation.z = -0.42;
  torso.scale.set(0.84, 0.82, 0.62);
  torso.castShadow = true;
  root.add(torso);

  const head = new THREE.Group();
  head.position.set(0.28, 0.64, 0);
  root.add(head);

  const face = new THREE.Mesh(new THREE.SphereGeometry(0.19, 16, 12), skinMaterial);
  face.scale.set(0.92, 1.05, 0.92);
  face.castShadow = true;
  head.add(face);

  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.205, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), shirtMaterial);
  helmet.position.set(0, 0.08, 0);
  helmet.castShadow = true;
  head.add(helmet);

  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.055, 0.3), accentMaterial);
  visor.position.set(0.16, 0.02, 0);
  visor.castShadow = true;
  head.add(visor);

  const leftArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.058, 0.5, 5, 10), shirtMaterial);
  leftArm.position.set(0.24, 0.24, 0.28);
  leftArm.rotation.z = 1.16;
  leftArm.castShadow = true;
  root.add(leftArm);

  const leftHand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), skinMaterial);
  leftHand.position.set(0.03, -0.28, 0);
  leftHand.castShadow = true;
  leftArm.add(leftHand);

  const rightArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.058, 0.5, 5, 10), shirtMaterial);
  rightArm.position.set(0.24, 0.24, -0.28);
  rightArm.rotation.z = 1.16;
  rightArm.castShadow = true;
  root.add(rightArm);

  const rightHand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), skinMaterial);
  rightHand.position.set(0.03, -0.28, 0);
  rightHand.castShadow = true;
  rightArm.add(rightHand);

  const leftLeg = createJockeyLeg(1, tightsMaterial, bootMaterial);
  leftLeg.position.set(0.02, -0.08, riderLegZ);
  leftLeg.rotation.set(0.1, 0, -0.2);
  root.add(leftLeg);

  const rightLeg = createJockeyLeg(-1, tightsMaterial, bootMaterial);
  rightLeg.position.set(0.02, -0.08, -riderLegZ);
  rightLeg.rotation.set(-0.1, 0, -0.2);
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

function createJockeyLeg(side: 1 | -1, tightsMaterial: THREE.Material, bootMaterial: THREE.Material) {
  const group = new THREE.Group();
  const hipPoint = new THREE.Vector3(0, 0, 0);
  const kneePoint = new THREE.Vector3(0.17, -0.29, side * 0.01);
  const anklePoint = new THREE.Vector3(0.09, -0.62, side * 0.02);
  const hip = new THREE.Mesh(new THREE.SphereGeometry(0.066, 8, 6), tightsMaterial);
  const knee = new THREE.Mesh(new THREE.SphereGeometry(0.064, 8, 6), tightsMaterial);
  const boot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.12), bootMaterial);
  const thigh = createCapsuleBetween(hipPoint, kneePoint, 0.052, tightsMaterial, 10);
  const shin = createCapsuleBetween(kneePoint, anklePoint, 0.046, tightsMaterial, 10);

  hip.castShadow = true;
  group.add(hip);

  group.add(thigh);

  knee.position.copy(kneePoint);
  knee.castShadow = true;
  group.add(knee);

  group.add(shin);

  boot.position.set(0.2, -0.69, side * 0.02);
  boot.rotation.z = 0.06;
  boot.castShadow = true;
  group.add(boot);

  return group;
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
    for (const z of [-0.47, 0.47]) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.42, 0.055), material);
      stripe.position.set(x, 0.18, z);
      stripe.rotation.z = -0.24;
      stripe.castShadow = true;
      group.add(stripe);
    }
  }
}

function updateCameraTargetSelection(race: RaceResult) {
  const previousValue = selectedCameraEntryId;
  const hasPreviousEntry = race.placements.some((placement) => placement.entry.id === previousValue);

  selectedCameraEntryId = hasPreviousEntry ? previousValue : 'overview';
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
  syncVictoryPresentation(race);
  updateVictoryEffect(null);
  clearVisualRunners();
  updateCameraTargetSelection(race);

  createVisualRunnersForRace(race);

  updateHelicopterState(race.hazardEvents);
  if (raceStarted && usesDetailedGraphics()) {
    void ensureHelicopterVisualLoading();
  }
  syncRaceStartedState();
  renderRaceStaticState();
  renderLeaderboard();
  updateMinimap();
  snapCameraToLeader();
}

function createVisualRunnersForRace(race: RaceResult) {
  const lanePlacements = [...race.placements].sort((left, right) => left.laneIndex - right.laneIndex);

  lanePlacements.forEach((placement, indexInLane) => {
    const count = lanePlacements.length;
    const laneIndex = placement.laneIndex;
    const mesh = createHorse(placement.entry.profile, placement.entry.name);
    const baseScale = count > 14 ? 0.58 : count > 10 ? 0.68 : count > 6 ? 0.82 : 1;
    mesh.position.set(startX, horseBaseY, laneZ(laneIndex, count));
    mesh.rotation.y = 0;
    mesh.scale.setScalar(baseScale);
    scene.add(mesh);

    visualRunners.push({
      placement,
      mesh,
      label: makeLabel(placement.entry.name),
      identityLabel: makeIdentityLabel(placement.entry.name),
      lane: laneIndex,
      phase: indexInLane * 0.7,
      baseScale,
      skillActive: false,
      eliminated: false
    });
  });
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

function makeIdentityLabel(name: string) {
  const label = document.createElement('div');
  label.className = 'runner-identity';

  const text = document.createElement('strong');
  text.textContent = name;
  label.append(text);

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
    syncVictoryPresentation(null);
    updateVictoryEffect(null);
    updateCamera(null, null);
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
      updateFrenzyVortex(runner, false);
      updateDanceMirrorBall(runner, false);
      updateFlatGlideEffect(runner, false);
      updateFrenzyFire(runner, false);
      updateRocketFart(runner, false);
      updateRunnerLabel(runner, false);
    });
    updateHelicopterAnimation([]);
    updateFrenzySnorts(null);
    raceStage.dataset.frenzy = 'idle';
    raceStage.dataset.frenzyVortex = 'idle';
    raceStage.dataset.frenzySpin = 'idle';
    raceStage.dataset.mirrorBall = 'idle';
    raceStage.dataset.flatGlide = 'idle';
    raceStage.dataset.rocketFart = 'idle';
    syncVictoryPresentation(race);
    updateVictoryEffect(null);
    updateCamera(null, null);
    updateHelicopterFrameState();
    updateMinimap();
    positionRunnerLabels();
    return;
  }

  raceElapsed += delta * getRaceTimeScale(race.hazardEvents) * defaultRacePaceMultiplier * getPostQualifierRacePaceMultiplier(race);
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
    const activeSkillEvent = getActiveSkillEvent(runner.placement);
    const activeFrenzySkillEvent = getActiveFrenzySkillEvent(runner.placement);
    const activeSkill = !eliminatedNow && Boolean(activeSkillEvent);
    const frenzyActive = !eliminatedNow && Boolean(activeFrenzySkillEvent);
    const frenzyVortexActive =
      frenzyActive &&
      activeFrenzySkillEvent?.skill.pose !== 'dance' &&
      activeFrenzySkillEvent?.skill.pose !== 'lie-flat';
    const mirrorBallActive = activeSkill && activeSkillEvent?.skill.pose === 'dance';
    const flatGlideActive = activeSkill && activeSkillEvent?.skill.pose === 'lie-flat';
    const skillPulse = frenzyActive ? 1 + Math.sin(raceElapsed * 16) * 0.065 : activeSkill ? 1 + Math.sin(raceElapsed * 9) * 0.035 : 1;

    runner.mesh.position.x = startX + progress * (finishX - startX);
    runner.mesh.position.z = laneZ(runner.lane, visualRunners.length) + (eliminatedNow ? 0 : laneSway);
    runner.mesh.position.y = eliminatedNow ? lerpNumber(horseBaseY, 0.42, fallProgress) : horseBaseY + Math.abs(bob) * 0.24;
    if (frenzyVortexActive) {
      const spin = raceElapsed * (10.8 + raceProgress.multiplier * 0.42) + runner.phase;
      runner.mesh.rotation.x = Math.sin(spin * 0.72) * 0.16;
      runner.mesh.rotation.y = spin;
      runner.mesh.rotation.z = Math.cos(spin * 0.68) * 0.14;
    } else {
      runner.mesh.rotation.x = eliminatedNow ? lerpNumber(0, Math.PI / 2, fallProgress) : 0;
      runner.mesh.rotation.y = 0;
      runner.mesh.rotation.z = eliminatedNow ? lerpNumber(bob * 0.055, -0.18, fallProgress) : bob * 0.055;
    }
    runner.mesh.scale.setScalar(runner.baseScale * skillPulse);
    runner.skillActive = activeSkill;
    runner.eliminated = eliminatedNow;

    animateHorseStride(runner, progress, eliminatedNow, frenzyActive ? raceProgress.multiplier * 1.7 : raceProgress.multiplier);
    applySkillPose(runner, activeSkill);
    updateFrenzyVortex(runner, frenzyVortexActive && usesDetailedGraphics());
    updateDanceMirrorBall(runner, mirrorBallActive && usesDetailedGraphics());
    updateFlatGlideEffect(runner, flatGlideActive && usesDetailedGraphics());
    updateFrenzyFire(runner, frenzyActive);
    updateRocketFart(runner, !eliminatedNow && activeSkillEvent?.skill.id === 'rocket-start');
    updateRunnerLabel(runner, activeSkill);
  });

  raceStage.dataset.frenzy = visualRunners.some((runner) => !runner.eliminated && isFrenzySkillActive(runner.placement)) ? 'active' : 'idle';
  raceStage.dataset.frenzyVortex = visualRunners.some((runner) => !runner.eliminated && shouldShowFrenzyVortex(runner.placement))
    ? 'active'
    : 'idle';
  raceStage.dataset.frenzySpin = raceStage.dataset.frenzyVortex;
  raceStage.dataset.mirrorBall = visualRunners.some((runner) => !runner.eliminated && getActiveSkillEvent(runner.placement)?.skill.pose === 'dance')
    ? 'active'
    : 'idle';
  raceStage.dataset.flatGlide = visualRunners.some((runner) => !runner.eliminated && getActiveSkillEvent(runner.placement)?.skill.pose === 'lie-flat')
    ? 'active'
    : 'idle';
  raceStage.dataset.rocketFart = visualRunners.some(
    (runner) => !runner.eliminated && getActiveSkillEvent(runner.placement)?.skill.id === 'rocket-start'
  )
    ? 'active'
    : 'idle';
  const activeHazard = getActiveHazardEvent(race.hazardEvents);
  updateHelicopterAnimation(race.hazardEvents);
  const activeFrenzyRunner = activeHazard ? null : getActiveFrenzyCinematicRunner();
  updateFrenzySnorts(activeFrenzyRunner);

  if (activeFrenzyRunner) {
    raceStage.dataset.cinematic = 'frenzy';
    setCameraControlLocked(true);
  }

  updateCamera(activeHazard, activeFrenzyRunner);
  updateHelicopterFrameState();
  updateMinimap();
  positionRunnerLabels();

  if (!raceFinished && raceElapsed >= maxFinish + 0.8) {
    raceFinished = true;
    visualRunners.forEach((runner) => updateRunnerLabel(runner, runner.skillActive));
    renderRaceStaticState();
  }

  syncVictoryPresentation(race);
  updateVictoryEffect(race);
}

function getPostQualifierRacePaceMultiplier(race: RaceResult) {
  if (raceFinished) {
    return 1;
  }

  const qualifiedFinishTimes = race.placements
    .filter((placement) => placement.qualified)
    .map((placement) => placement.finishSeconds);

  if (qualifiedFinishTimes.length === 0) {
    return 1;
  }

  return raceElapsed >= Math.max(...qualifiedFinishTimes) ? fastFinishRacePaceMultiplier : 1;
}

function updateHelicopterState(hazardEvents: HazardEvent[]) {
  helicopterGroup.visible = false;
  bulletMesh.visible = false;
  muzzleFlash.visible = false;
  impactBurst.visible = false;
  raceStage.dataset.cinematic = 'idle';
  raceStage.dataset.frenzy = 'idle';
  resetHelicopterModelDiagnostics();

  const firstEvent = hazardEvents[0];

  if (!firstEvent) {
    return;
  }

  const mobile = raceCanvas.clientWidth < 760;
  helicopterGroup.position.set(
    mobile ? finishX + 12 : finishX + 22,
    mobile ? 9.8 : 11.8,
    -(trackVisualWidth / 2 + (mobile ? 5.8 : 18))
  );
  helicopterGroup.rotation.set(0, helicopterForwardRotationY, 0);
  helicopterGroup.scale.setScalar(mobile ? 1.18 : 1);
}

function ensureHelicopterVisualLoading() {
  if (!usesDetailedGraphics()) {
    resetHelicopterVisualToFallback();
    return Promise.resolve<'generated'>('generated');
  }

  if (!helicopterVisualPromise) {
    const loadToken = ++helicopterVisualLoadToken;
    helicopterVisualPromise = installHelicopterVisual(
      helicopterAssetSlot,
      () => loadToken === helicopterVisualLoadToken && usesDetailedGraphics()
    ).then((status) => {
      if (loadToken !== helicopterVisualLoadToken || !usesDetailedGraphics()) {
        return 'generated';
      }

      raceStage.dataset.helicopterAsset = status;
      return status;
    });
  }

  return helicopterVisualPromise;
}

function resetHelicopterVisualToFallback() {
  helicopterVisualLoadToken += 1;
  helicopterVisualPromise = null;
  raceStage.dataset.helicopterAsset = 'generated';
  installHelicopterFallback(helicopterAssetSlot);
}

function updateHelicopterAnimation(hazardEvents: HazardEvent[]) {
  const hazardEvent = getActiveHazardEvent(hazardEvents);

  if (!hazardEvent) {
    helicopterGroup.visible = false;
    bulletMesh.visible = false;
    muzzleFlash.visible = false;
    impactBurst.visible = false;
    raceStage.dataset.cinematic = 'idle';
    resetHelicopterModelDiagnostics();
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
    resetHelicopterModelDiagnostics();
    setCameraControlLocked(false);
    return;
  }

  setCameraControlLocked(true);

  const targetPosition = getRunnerAimPoint(target);
  const orbit = Math.sin(raceElapsed * 1.8) * 1.2;
  const mobile = raceCanvas.clientWidth < 760;
  const arrivalProgress = smoothStep(clampNumber((raceElapsed - sequenceStart) / helicopterEntranceSeconds, 0, 1));
  const hoverPosition = getFinishHelicopterHoverPosition(orbit, mobile);
  const entryPosition = mobile
    ? new THREE.Vector3(finishX + 14, 10.2, -(trackVisualWidth / 2 + 7.2))
    : new THREE.Vector3(finishX + 26, 13.4, -(trackVisualWidth / 2 + 20));
  helicopterGroup.position.copy(entryPosition.lerp(hoverPosition, arrivalProgress));
  helicopterGroup.scale.setScalar(mobile ? 1.18 : 1);
  helicopterGroup.rotation.y = getHelicopterYawToward(targetPosition) + Math.sin(raceElapsed * 1.6) * 0.08;
  spinHelicopterRotors(helicopterGroup, raceElapsed);
  aimSniperRigAt(targetPosition);

  const muzzlePosition = getMuzzleWorldPosition();
  updateHelicopterModelDiagnostics(targetPosition, muzzlePosition);
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

  updateBallisticsFrameState(muzzlePosition, targetPosition, bulletActive);
  raceStage.dataset.cinematic = impactActive ? 'hit' : bulletActive || flashActive ? 'shot' : 'approach';
}

function getHelicopterYawToward(targetPosition: THREE.Vector3) {
  const forward = targetPosition.clone().sub(helicopterGroup.position);
  forward.y = 0;

  if (forward.lengthSq() < 0.0001) {
    return helicopterGroup.rotation.y;
  }

  forward.normalize();
  return Math.atan2(-forward.z, forward.x);
}

function updateBallisticsFrameState(muzzlePosition: THREE.Vector3, targetPosition: THREE.Vector3, bulletActive: boolean) {
  const shotDirection = targetPosition.clone().sub(muzzlePosition).normalize();
  const helicopterForward = new THREE.Vector3(1, 0, 0).applyQuaternion(helicopterGroup.quaternion);
  helicopterForward.y = 0;

  if (helicopterForward.lengthSq() > 0.0001) {
    const flatShotDirection = shotDirection.clone();
    flatShotDirection.y = 0;

    if (flatShotDirection.lengthSq() > 0.0001) {
      raceStage.dataset.helicopterForwardDot = helicopterForward.normalize().dot(flatShotDirection.normalize()).toFixed(3);
    }
  }

  if (!bulletActive) {
    delete raceStage.dataset.bulletDirectionDot;
    return;
  }

  const bulletForward = new THREE.Vector3(0, 1, 0).applyQuaternion(bulletMesh.quaternion).normalize();
  raceStage.dataset.bulletDirectionDot = bulletForward.dot(shotDirection).toFixed(3);
}

function setCameraControlLocked(locked: boolean) {
  cameraSelectionLocked = locked;
  leaderboardList.classList.toggle('camera-locked', locked);
  leaderboardList.dataset.cameraLocked = locked ? 'true' : 'false';
}

function updateHelicopterFrameState() {
  if (!helicopterGroup.visible || raceStage.dataset.cinematic === 'idle') {
    raceStage.dataset.helicopterInFrame = 'false';
    return;
  }

  camera.updateMatrixWorld();
  helicopterGroup.updateMatrixWorld();
  const bounds = getProjectedHelicopterVisualBounds();
  const focusPoint = getHelicopterVisualCenterPoint();
  const projected = focusPoint.clone().project(camera);
  const screenX = bounds?.centerX ?? (projected.x + 1) / 2;
  const screenY = bounds?.centerY ?? (1 - projected.y) / 2;
  const inFrame =
    bounds !== null &&
    bounds.left > 0.04 &&
    bounds.right < 0.96 &&
    bounds.top > 0.08 &&
    bounds.bottom < 0.78;

  raceStage.dataset.helicopterInFrame = String(inFrame);
  raceStage.dataset.helicopterScreenX = screenX.toFixed(3);
  raceStage.dataset.helicopterScreenY = screenY.toFixed(3);
  if (bounds) {
    raceStage.dataset.helicopterBoxLeft = bounds.left.toFixed(3);
    raceStage.dataset.helicopterBoxRight = bounds.right.toFixed(3);
    raceStage.dataset.helicopterBoxTop = bounds.top.toFixed(3);
    raceStage.dataset.helicopterBoxBottom = bounds.bottom.toFixed(3);
    raceStage.dataset.helicopterBoxWidth = bounds.width.toFixed(3);
    raceStage.dataset.helicopterBoxHeight = bounds.height.toFixed(3);
  }
  raceStage.dataset.helicopterCameraDistance = camera.position.distanceTo(focusPoint).toFixed(2);
}

function resetHelicopterModelDiagnostics() {
  raceStage.dataset.helicopterModelClean = 'false';
  raceStage.dataset.helicopterMainRotorClear = 'false';
  raceStage.dataset.helicopterTailRotorAttached = 'false';
  raceStage.dataset.helicopterMuzzleForward = 'false';
  raceStage.dataset.helicopterShotOrigin = 'unknown';
  raceStage.dataset.helicopterGeneratedRootCount = '0';
  raceStage.dataset.helicopterMainRotorCount = '0';
  raceStage.dataset.helicopterTailRotorCount = '0';
  raceStage.dataset.helicopterStaticRotorBladeCount = '0';
}

function updateHelicopterModelDiagnostics(targetPosition: THREE.Vector3, muzzleWorldPosition: THREE.Vector3) {
  helicopterGroup.updateMatrixWorld(true);
  helicopterSniperRig.updateMatrixWorld(true);
  const assemblyCounts = getHelicopterAssemblyCounts();

  const nosePosition = helicopterGroup.localToWorld(new THREE.Vector3(helicopterNoseLocalX, 0, 0));
  const tailPosition = helicopterGroup.localToWorld(new THREE.Vector3(helicopterTailLocalX, 0.12, 0));
  const tailBoomEndPosition = helicopterGroup.localToWorld(new THREE.Vector3(helicopterTailBoomEndX, 0.18, 0));
  const tailRotorHubPosition = helicopterGroup.localToWorld(new THREE.Vector3(helicopterTailRotorHubX, 0.18, 0));
  const muzzleLocal = helicopterGroup.worldToLocal(muzzleWorldPosition.clone());
  const mainRotorClearance = (helicopterMainRotorY - helicopterBodyTopY) * helicopterGroup.scale.y;
  const tailRotorGap = tailRotorHubPosition.distanceTo(tailBoomEndPosition);
  const noseTargetBias = tailPosition.distanceTo(targetPosition) - nosePosition.distanceTo(targetPosition);
  const muzzleForward = muzzleLocal.x > helicopterNoseLocalX - 0.46;
  const mainRotorClear = mainRotorClearance > 0.55;
  const tailRotorAttached = tailRotorGap < 0.18;
  const noseFacesTarget = noseTargetBias > 0.2;
  const singleRotorAssembly =
    assemblyCounts.generatedRootCount === 1 &&
    assemblyCounts.mainRotorCount === 1 &&
    assemblyCounts.tailRotorCount === 1 &&
    assemblyCounts.staticRotorBladeCount === 0;

  raceStage.dataset.helicopterGeneratedRootCount = String(assemblyCounts.generatedRootCount);
  raceStage.dataset.helicopterMainRotorCount = String(assemblyCounts.mainRotorCount);
  raceStage.dataset.helicopterTailRotorCount = String(assemblyCounts.tailRotorCount);
  raceStage.dataset.helicopterStaticRotorBladeCount = String(assemblyCounts.staticRotorBladeCount);
  raceStage.dataset.helicopterMainRotorClearance = mainRotorClearance.toFixed(3);
  raceStage.dataset.helicopterTailRotorGap = tailRotorGap.toFixed(3);
  raceStage.dataset.helicopterMuzzleLocalX = muzzleLocal.x.toFixed(3);
  raceStage.dataset.helicopterNoseTargetBias = noseTargetBias.toFixed(3);
  raceStage.dataset.helicopterMainRotorClear = String(mainRotorClear);
  raceStage.dataset.helicopterTailRotorAttached = String(tailRotorAttached);
  raceStage.dataset.helicopterMuzzleForward = String(muzzleForward);
  raceStage.dataset.helicopterShotOrigin = muzzleForward && noseFacesTarget ? 'nose' : 'tail';
  raceStage.dataset.helicopterModelClean = String(singleRotorAssembly && mainRotorClear && tailRotorAttached && muzzleForward && noseFacesTarget);
}

function getHelicopterAssemblyCounts() {
  let mainRotorCount = 0;
  let tailRotorCount = 0;
  let staticRotorBladeCount = 0;

  helicopterAssetSlot.traverse((child) => {
    if (child.name === 'main-rotor') {
      mainRotorCount += 1;
    }

    if (child.name === 'tail-rotor') {
      tailRotorCount += 1;
    }

    if (
      (child.name === 'main-rotor-blade' && !hasAncestorNamed(child, 'main-rotor')) ||
      (child.name === 'tail-rotor-blade' && !hasAncestorNamed(child, 'tail-rotor'))
    ) {
      staticRotorBladeCount += 1;
    }
  });

  return {
    generatedRootCount: helicopterAssetSlot.children.length,
    mainRotorCount,
    tailRotorCount,
    staticRotorBladeCount
  };
}

function hasAncestorNamed(object: THREE.Object3D, name: string) {
  let parent = object.parent;

  while (parent) {
    if (parent.name === name) {
      return true;
    }

    parent = parent.parent;
  }

  return false;
}

function getProjectedHelicopterVisualBounds() {
  const min = new THREE.Vector3(-3.3, -0.78, -2.48);
  const max = new THREE.Vector3(2.55, 1.32, 2.48);
  const corners = [
    new THREE.Vector3(min.x, min.y, min.z),
    new THREE.Vector3(min.x, min.y, max.z),
    new THREE.Vector3(min.x, max.y, min.z),
    new THREE.Vector3(min.x, max.y, max.z),
    new THREE.Vector3(max.x, min.y, min.z),
    new THREE.Vector3(max.x, min.y, max.z),
    new THREE.Vector3(max.x, max.y, min.z),
    new THREE.Vector3(max.x, max.y, max.z)
  ];

  let left = Infinity;
  let right = -Infinity;
  let top = Infinity;
  let bottom = -Infinity;

  for (const corner of corners) {
    const projected = helicopterGroup.localToWorld(corner).project(camera);

    if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y)) {
      return null;
    }

    const x = (projected.x + 1) / 2;
    const y = (1 - projected.y) / 2;
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }

  return {
    left,
    right,
    top,
    bottom,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
    width: right - left,
    height: bottom - top
  };
}

function getHelicopterVisualCenterPoint() {
  return helicopterGroup.localToWorld(new THREE.Vector3(-0.18, 0.28, 0));
}

function getMobileHelicopterCameraView(targetPoint?: THREE.Vector3) {
  const visualCenter = getHelicopterVisualCenterPoint();
  const position = visualCenter.clone().add(new THREE.Vector3(-12.4, 5.4, 20.8));
  const forward = visualCenter.clone().sub(position);
  const right = new THREE.Vector3(-forward.z, 0, forward.x).normalize();
  const target = visualCenter
    .clone()
    .add(right.multiplyScalar(-0.16))
    .add(new THREE.Vector3(0, -0.08, 0));

  if (targetPoint) {
    target.lerp(targetPoint, 0.04);
  }

  return {
    position,
    target,
    alpha: 0.56
  };
}

function getFinishHelicopterHoverPosition(orbit: number, mobile = false) {
  return new THREE.Vector3(
    finishX + (mobile ? -9.5 : -3.8) + orbit * 0.45,
    (mobile ? 7.4 : 8.8) + Math.sin(raceElapsed * 3) * 0.22,
    -(trackVisualWidth / 2 + (mobile ? 2.8 : 8.5))
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

function getActiveFrenzyCinematicRunner() {
  return getActiveFrenzyCinematicCandidate()?.runner ?? null;
}

function getFrenzyCinematicWindowEvent(placement: RacePlacement) {
  const candidate = getActiveFrenzyCinematicCandidate();
  return candidate?.runner.placement === placement ? candidate.skillEvent : null;
}

function getActiveFrenzyCinematicCandidate() {
  return getScheduledFrenzyCinematicCandidates().find((candidate) => {
    return raceElapsed >= candidate.scheduledStart && raceElapsed <= candidate.windowEnd;
  }) ?? null;
}

function getScheduledFrenzyCinematicCandidates() {
  const candidates = visualRunners
    .filter((runner) => !runner.eliminated)
    .flatMap((runner) =>
      getSkillEvents(runner.placement)
        .filter(isFrenzySkillEvent)
        .map((skillEvent) => {
          const start = getSkillStartSeconds(runner.placement, skillEvent);
          const windowEnd = Math.min(runner.placement.finishSeconds, start + Math.min(skillEvent.durationSeconds, frenzyCutsceneHoldSeconds));
          return {
            runner,
            skillEvent,
            start,
            windowStart: start - frenzyCutsceneLeadSeconds,
            windowEnd
          };
        })
    )
    .sort((left, right) => left.start - right.start || left.runner.placement.entry.id.localeCompare(right.runner.placement.entry.id));

  let nextAllowedStart = Number.NEGATIVE_INFINITY;

  return candidates
    .map((candidate) => {
      const scheduledStart = Math.max(candidate.windowStart, nextAllowedStart);
      nextAllowedStart = Math.max(nextAllowedStart, candidate.windowEnd + frenzyCutsceneReturnSeconds);
      return {
        ...candidate,
        scheduledStart
      };
    })
    .filter((candidate) => candidate.scheduledStart <= candidate.windowEnd);
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

function getStableHorseFacePoint(runner: VisualRunner) {
  return runner.mesh.position.clone().add(new THREE.Vector3(2.12, 1.18, 0));
}

function getHorseNostrilPoint(runner: VisualRunner, nostrilSide: number) {
  return runner.mesh.localToWorld(new THREE.Vector3(2.12, 1.12, nostrilSide * 0.13));
}

function getHorseForwardDirection(runner: VisualRunner) {
  const nose = runner.mesh.localToWorld(new THREE.Vector3(2.12, 1.12, 0));
  const forward = runner.mesh.localToWorld(new THREE.Vector3(3.12, 1.12, 0)).sub(nose);
  return forward.lengthSq() > 0 ? forward.normalize() : new THREE.Vector3(1, 0, 0);
}

function getMuzzleWorldPosition() {
  helicopterSniperRig.updateMatrixWorld(true);
  return helicopterSniperRig.localToWorld(new THREE.Vector3(0, 0, helicopterMuzzleLocalZ));
}

function aimSniperRigAt(targetWorldPosition: THREE.Vector3) {
  helicopterGroup.updateMatrixWorld(true);
  helicopterSniperRig.lookAt(targetWorldPosition);
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

function ensureFrenzyVortex(runner: VisualRunner) {
  const existing = runner.mesh.userData.frenzyVortex as FrenzyVortexParts | undefined;

  if (existing) {
    return existing;
  }

  const vortex = createFrenzyVortex(runner.placement.entry.profile.secondaryColor);
  runner.mesh.add(vortex.root);
  runner.mesh.userData.frenzyVortex = vortex;
  return vortex;
}

function updateFrenzyVortex(runner: VisualRunner, active: boolean) {
  const vortex = active ? ensureFrenzyVortex(runner) : (runner.mesh.userData.frenzyVortex as FrenzyVortexParts | undefined);

  if (!vortex) {
    return;
  }

  vortex.root.visible = active;

  if (!active) {
    vortex.smokeMaterials.forEach((material) => {
      material.opacity = 0;
    });
    return;
  }

  const pulse = 1 + Math.sin(raceElapsed * 19) * 0.08;
  vortex.root.rotation.y = raceElapsed * 8 + runner.phase;
  vortex.root.scale.set(pulse, 1, pulse);

  vortex.rings.forEach((ring, index) => {
    ring.rotation.z = raceElapsed * (2.8 + index * 0.42) + index * 0.7;
    ring.position.y = 0.2 + index * 0.28 + Math.sin(raceElapsed * 7 + index) * 0.035;

    const material = ring.material;
    if (material instanceof THREE.MeshBasicMaterial) {
      material.opacity = 0.52 + Math.sin(raceElapsed * 9 + index) * 0.12;
    }
  });

  vortex.dust.forEach((particle, index) => {
    const phase = Number(particle.userData.phase ?? 0);
    const angle = raceElapsed * 11 + phase;
    const radius = 0.72 + (index % 6) * 0.13;
    particle.position.set(Math.cos(angle) * radius, 0.24 + ((index * 0.17 + raceElapsed * 1.8) % 1.72), Math.sin(angle) * radius);
    particle.scale.setScalar(0.9 + Math.sin(raceElapsed * 12 + phase) * 0.22);
  });

  vortex.smokeSprites.forEach((sprite, index) => {
    const phase = Number(sprite.userData.phase ?? 0);
    const baseScale = Number(sprite.userData.baseScale ?? 1);
    const angle = raceElapsed * (6.8 + index * 0.08) + phase;
    const layerProgress = (index * 0.19 + raceElapsed * 1.25) % 1;
    const radius = 0.9 + (index % 5) * 0.2 + Math.sin(raceElapsed * 3.2 + phase) * 0.06;
    const height = 0.18 + layerProgress * 1.85;
    const opacity = 0.42 + Math.sin(raceElapsed * 5.7 + phase) * 0.12;
    sprite.position.set(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
    sprite.scale.setScalar(baseScale * (1.12 + layerProgress * 1.72));

    const material = sprite.material;
    if (material instanceof THREE.SpriteMaterial) {
      material.opacity = opacity * (1 - layerProgress * 0.28);
      material.rotation = -angle + raceElapsed * 1.4;
    }
  });
}

function ensureDanceMirrorBall(runner: VisualRunner) {
  const existing = runner.mesh.userData.danceMirrorBall as DanceMirrorBallParts | undefined;

  if (existing) {
    return existing;
  }

  const mirrorBall = createDanceMirrorBall(runner.placement.entry.profile.secondaryColor);
  runner.mesh.add(mirrorBall.root);
  runner.mesh.userData.danceMirrorBall = mirrorBall;
  return mirrorBall;
}

function updateDanceMirrorBall(runner: VisualRunner, active: boolean) {
  const mirrorBall = active ? ensureDanceMirrorBall(runner) : (runner.mesh.userData.danceMirrorBall as DanceMirrorBallParts | undefined);

  if (!mirrorBall) {
    return;
  }

  mirrorBall.root.visible = active;

  if (!active) {
    mirrorBall.materials.forEach((material) => {
      material.opacity = 0;
    });
    return;
  }

  mirrorBall.materials.forEach((material) => {
    material.opacity = Number(material.userData.baseOpacity ?? 0.5);
  });
  mirrorBall.root.position.y = 2.78 + Math.sin(raceElapsed * 4.5 + runner.phase) * 0.08;
  mirrorBall.root.rotation.y = raceElapsed * 2.8 + runner.phase;
  mirrorBall.ball.rotation.set(raceElapsed * 2.4, raceElapsed * 5.6, raceElapsed * 1.7);

  mirrorBall.beams.forEach((beam, index) => {
    const phase = Number(beam.userData.phase ?? 0);
    beam.rotation.z = raceElapsed * (1.4 + index * 0.08) + phase;
    beam.scale.set(1 + Math.sin(raceElapsed * 7 + phase) * 0.16, 1, 1 + Math.cos(raceElapsed * 6 + phase) * 0.12);

    const material = beam.material;
    if (material instanceof THREE.MeshBasicMaterial) {
      material.opacity = 0.1 + Math.sin(raceElapsed * 8 + phase) * 0.035;
    }
  });

  mirrorBall.sparkles.forEach((sparkle, index) => {
    const phase = Number(sparkle.userData.phase ?? 0);
    const angle = raceElapsed * (3.4 + (index % 5) * 0.18) + phase;
    const radius = 0.48 + (index % 4) * 0.11;
    sparkle.position.set(Math.cos(angle) * radius, 0.02 + Math.sin(raceElapsed * 5 + phase) * 0.22, Math.sin(angle) * radius);
    sparkle.scale.setScalar(0.82 + Math.sin(raceElapsed * 12 + phase) * 0.28);

    const material = sparkle.material;
    if (material instanceof THREE.MeshBasicMaterial) {
      material.opacity = 0.5 + Math.sin(raceElapsed * 10 + phase) * 0.24;
    }
  });
}

function ensureFlatGlideEffect(runner: VisualRunner) {
  const existing = runner.mesh.userData.flatGlide as FlatGlideParts | undefined;

  if (existing) {
    return existing;
  }

  const glide = createFlatGlideEffect(runner.placement.entry.profile.secondaryColor);
  runner.mesh.add(glide.root);
  runner.mesh.userData.flatGlide = glide;
  return glide;
}

function updateFlatGlideEffect(runner: VisualRunner, active: boolean) {
  const glide = active ? ensureFlatGlideEffect(runner) : (runner.mesh.userData.flatGlide as FlatGlideParts | undefined);

  if (!glide) {
    return;
  }

  glide.root.visible = active;

  if (!active) {
    glide.materials.forEach((material) => {
      material.opacity = 0;
    });
    return;
  }

  glide.root.rotation.y = Math.sin(raceElapsed * 5 + runner.phase) * 0.08;

  glide.streaks.forEach((streak) => {
    const phase = Number(streak.userData.phase ?? 0);
    const cycle = (raceElapsed * 3.7 + phase) % 1;
    const baseZ = Number(streak.userData.baseZ ?? 0);
    const baseLength = Number(streak.userData.baseLength ?? 1);
    streak.position.set(-0.42 - cycle * 1.7, 0.2 + Math.sin(raceElapsed * 11 + phase) * 0.026, baseZ + Math.sin(raceElapsed * 7 + phase) * 0.05);
    streak.scale.set(0.68 + cycle * 1.35, 1, 1);

    const material = streak.material;
    if (material instanceof THREE.MeshBasicMaterial) {
      material.opacity = (0.78 - cycle * 0.52) * (baseLength / 2.55);
    }
  });

  glide.ripples.forEach((ripple, index) => {
    const phase = Number(ripple.userData.phase ?? 0);
    const cycle = (raceElapsed * 1.65 + phase) % 1;
    ripple.position.set(-0.16 - cycle * 0.62, 0.006 + index * 0.005, Math.sin(raceElapsed * 4 + phase) * 0.04);
    ripple.scale.set(1.3 + cycle * 2.55, 0.34 + cycle * 0.42, 0.58 + cycle * 0.42);

    const material = ripple.material;
    if (material instanceof THREE.MeshBasicMaterial) {
      material.opacity = Math.max(0, 0.5 * (1 - cycle));
    }
  });

  glide.dust.forEach((puff, index) => {
    const phase = Number(puff.userData.phase ?? 0);
    const cycle = (raceElapsed * 2.35 + phase) % 1;
    const side = index % 2 === 0 ? 1 : -1;
    puff.position.set(-0.88 - cycle * 1.22, 0.14 + cycle * 0.22, side * (0.3 + (index % 5) * 0.1 + cycle * 0.28));
    puff.scale.setScalar(0.78 + cycle * 1.65);

    const material = puff.material;
    if (material instanceof THREE.MeshBasicMaterial) {
      material.opacity = Math.max(0, 0.44 * (1 - cycle));
    }
  });
}

function ensureFrenzyFire(runner: VisualRunner) {
  const existing = runner.mesh.userData.frenzyFire as FrenzyFireParts | undefined;

  if (existing) {
    return existing;
  }

  const fire = createFrenzyFire();
  runner.mesh.add(fire.root);
  runner.mesh.userData.frenzyFire = fire;
  return fire;
}

function updateFrenzyFire(runner: VisualRunner, active: boolean) {
  const fire = active ? ensureFrenzyFire(runner) : (runner.mesh.userData.frenzyFire as FrenzyFireParts | undefined);

  if (!fire) {
    return;
  }

  fire.root.visible = active;

  if (!active) {
    fire.materials.forEach((material) => {
      material.opacity = 0;
    });
    return;
  }

  fire.flames.forEach((flame, index) => {
    const phase = Number(flame.userData.phase ?? 0);
    const baseY = Number(flame.userData.baseY ?? flame.position.y);
    const baseScale = Number(flame.userData.baseScale ?? 1);
    const pulse = 1 + Math.sin(raceElapsed * 18 + phase) * 0.22;
    flame.position.y = baseY + Math.sin(raceElapsed * 24 + phase) * 0.045;
    flame.rotation.y = raceElapsed * (6.5 + index * 0.4) + phase;
    flame.scale.set(baseScale * pulse * 0.88, baseScale * (1.08 + pulse * 0.18), baseScale * pulse * 0.88);

    const material = flame.material;
    if (material instanceof THREE.MeshBasicMaterial) {
      material.opacity = 0.66 + Math.sin(raceElapsed * 20 + phase) * 0.18;
    }
  });
}

function ensureRocketFart(runner: VisualRunner) {
  const existing = runner.mesh.userData.rocketFart as RocketFartParts | undefined;

  if (existing) {
    return existing;
  }

  const fart = createRocketFart();
  runner.mesh.add(fart.root);
  runner.mesh.userData.rocketFart = fart;
  return fart;
}

function updateRocketFart(runner: VisualRunner, active: boolean) {
  const fart = active ? ensureRocketFart(runner) : (runner.mesh.userData.rocketFart as RocketFartParts | undefined);

  if (!fart) {
    return;
  }

  fart.root.visible = active;

  if (!active) {
    fart.materials.forEach((material) => {
      material.opacity = 0;
    });
    return;
  }

  const skillEvent = getActiveSkillEvent(runner.placement);
  const startSeconds = getSkillStartSeconds(runner.placement, skillEvent);
  const elapsed = Math.max(0, raceElapsed - startSeconds);
  fart.root.rotation.y = Math.sin(raceElapsed * 9 + runner.phase) * 0.18;

  fart.puffs.forEach((puff, index) => {
    const phase = Number(puff.userData.phase ?? 0);
    const streamProgress = (elapsed * 3.2 + phase) % 1;
    const spread = 0.2 + streamProgress * 0.7;
    const side = index % 2 === 0 ? 1 : -1;
    puff.position.set(
      -0.2 - streamProgress * 1.55 - Math.sin(raceElapsed * 6 + phase) * 0.1,
      0.04 + Math.sin(raceElapsed * 8 + phase) * 0.1 + streamProgress * 0.18,
      side * spread * (0.34 + (index % 4) * 0.08)
    );
    puff.scale.setScalar(0.85 + streamProgress * 2.2);

    const material = puff.material;
    if (material instanceof THREE.MeshBasicMaterial) {
      material.opacity = Math.max(0, 0.88 * (1 - streamProgress));
    }
  });
}

function updateFrenzySnorts(runner: VisualRunner | null) {
  const puffs = frenzySnortGroup.userData.puffs as SnortPuffParts[] | undefined;

  if (!puffs) {
    return;
  }

  const skillEvent = runner ? getActiveFrenzySkillEvent(runner.placement, frenzyCutsceneLeadSeconds) : null;

  if (!runner || !skillEvent) {
    frenzySnortGroup.visible = false;
    puffs.forEach((puff) => {
      puff.mesh.visible = false;
      puff.material.opacity = 0;
    });
    return;
  }

  const skillStart = getSkillStartSeconds(runner.placement, skillEvent);
  const cutsceneElapsed = raceElapsed - skillStart;
  const burstOffsets = [-0.48, 0.18];
  let visible = false;

  puffs.forEach((puff) => {
    const localElapsed = cutsceneElapsed - (burstOffsets[puff.burstIndex] ?? 0);
    const burstProgress = clampNumber(localElapsed / 0.58, 0, 1);
    const burstActive = localElapsed >= 0 && localElapsed <= 0.58;

    puff.mesh.visible = burstActive;
    puff.material.opacity = burstActive ? 0.68 * (1 - burstProgress) : 0;

    if (!burstActive) {
      return;
    }

    visible = true;

    const origin = getHorseNostrilPoint(runner, puff.nostrilSide);
    const direction = getHorseForwardDirection(runner);
    const lift = new THREE.Vector3(0, 0.16 + burstProgress * 0.2, 0);
    const sideSpread = new THREE.Vector3(0, 0, puff.nostrilSide * burstProgress * 0.18);
    puff.mesh.position.copy(origin).add(direction.multiplyScalar(0.15 + burstProgress * 1.45)).add(lift).add(sideSpread);
    puff.mesh.scale.setScalar(0.26 + burstProgress * 1.05);
  });

  frenzySnortGroup.visible = visible;
}

function isFrenzySkillActive(placement: RacePlacement) {
  return Boolean(getActiveFrenzySkillEvent(placement));
}

function shouldShowFrenzyVortex(placement: RacePlacement) {
  const event = getActiveFrenzySkillEvent(placement);
  return Boolean(event && event.skill.pose !== 'dance' && event.skill.pose !== 'lie-flat');
}

function getActiveSkillEvent(placement: RacePlacement, leadSeconds = 0) {
  const activeEvents = getSkillEvents(placement).filter((skillEvent) => {
    const start = getSkillStartSeconds(placement, skillEvent);
    const end = Math.min(placement.finishSeconds, start + skillEvent.durationSeconds);
    return raceElapsed >= start - leadSeconds && raceElapsed <= end;
  });

  return activeEvents.find(isFrenzySkillEvent) ?? activeEvents[0] ?? null;
}

function getActiveFrenzySkillEvent(placement: RacePlacement, leadSeconds = 0) {
  return (
    getSkillEvents(placement).find((skillEvent) => {
      if (!isFrenzySkillEvent(skillEvent)) {
        return false;
      }

      const start = getSkillStartSeconds(placement, skillEvent);
      const end = Math.min(placement.finishSeconds, start + skillEvent.durationSeconds);
      return raceElapsed >= start - leadSeconds && raceElapsed <= end;
    }) ?? null
  );
}

function getSkillEvents(placement: RacePlacement) {
  return placement.skillEvents.length > 0 ? placement.skillEvents : placement.skillEvent ? [placement.skillEvent] : [];
}

function isFrenzySkillEvent(skillEvent: SkillEvent | null | undefined) {
  return skillEvent?.skill.cinematic === 'frenzy' && hasSpeedSkillEvent(skillEvent);
}

function hasSpeedSkillEvent(skillEvent: SkillEvent | null | undefined): skillEvent is SpeedSkillEvent {
  return Boolean(skillEvent?.triggerSeconds !== undefined && skillEvent.speedMultiplier !== undefined && skillEvent.speedMultiplier > 1);
}

function getSkillStartSeconds(placement: RacePlacement, skillEvent: SkillEvent | null | undefined = placement.skillEvent) {
  return skillEvent?.triggerSeconds ?? placement.finishSeconds * (skillEvent?.triggerProgress ?? 0);
}

function getSegmentedRaceProgress(elapsedSeconds: number, placement: RacePlacement, speedSegments: SpeedSegment[]) {
  const progressElapsedSeconds = getProgressElapsedSeconds(elapsedSeconds, placement);
  const progressFinishSeconds = getProgressFinishSeconds(placement);

  if (speedSegments.length === 0) {
    return {
      progress: Math.min(1, progressElapsedSeconds / progressFinishSeconds),
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
    const segmentDuration = progressFinishSeconds * (segmentWeight / totalWeight);

    if (progressElapsedSeconds <= elapsedCursor + segmentDuration) {
      const localProgress = clampNumber((progressElapsedSeconds - elapsedCursor) / segmentDuration, 0, 1);

      return {
        progress: (index + localProgress) / speedSegments.length,
        multiplier: (segment?.multiplier ?? 1) * getActiveSpeedMultiplier(elapsedSeconds, placement),
        segmentIndex: index
      };
    }

    elapsedCursor += segmentDuration;
  }

  const lastSegment = speedSegments[speedSegments.length - 1];

  return {
    progress: 1,
    multiplier: (lastSegment?.multiplier ?? 1) * getActiveSpeedMultiplier(elapsedSeconds, placement),
    segmentIndex: Math.max(0, speedSegments.length - 1)
  };
}

function getProgressFinishSeconds(placement: RacePlacement) {
  return getSpeedSkillEvents(placement).length > 0 ? placement.baseFinishSeconds : placement.finishSeconds;
}

function getProgressElapsedSeconds(elapsedSeconds: number, placement: RacePlacement) {
  const speedEvents = getSpeedSkillEvents(placement);

  if (speedEvents.length === 0) {
    return elapsedSeconds;
  }

  const boundaries = new Set<number>([0, placement.baseFinishSeconds]);

  speedEvents.forEach((skillEvent) => {
    const baseStart = skillEvent.baseTriggerSeconds ?? skillEvent.triggerSeconds;
    const baseEnd = baseStart + skillEvent.durationSeconds * skillEvent.speedMultiplier;
    boundaries.add(clampNumber(baseStart, 0, placement.baseFinishSeconds));
    boundaries.add(clampNumber(baseEnd, 0, placement.baseFinishSeconds));
  });

  const points = [...boundaries].sort((left, right) => left - right);
  let raceClockCursor = 0;

  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index] ?? 0;
    const end = points[index + 1] ?? start;
    const midpoint = (start + end) / 2;
    const multiplier = getSpeedMultiplierAtBaseElapsed(midpoint, speedEvents);
    const duration = (end - start) / multiplier;

    if (elapsedSeconds <= raceClockCursor + duration) {
      return start + (elapsedSeconds - raceClockCursor) * multiplier;
    }

    raceClockCursor += duration;
  }

  return placement.baseFinishSeconds + Math.max(0, elapsedSeconds - raceClockCursor);
}

function getActiveSpeedMultiplier(elapsedSeconds: number, placement: RacePlacement) {
  return getSpeedSkillEvents(placement).reduce((multiplier, skillEvent) => {
    const start = skillEvent.triggerSeconds;
    const end = start + skillEvent.durationSeconds;
    return elapsedSeconds >= start && elapsedSeconds <= end ? Math.max(multiplier, skillEvent.speedMultiplier) : multiplier;
  }, 1);
}

function getSpeedSkillEvents(placement: RacePlacement) {
  return getSkillEvents(placement)
    .filter(hasSpeedSkillEvent)
    .sort((left, right) => (left.baseTriggerSeconds ?? left.triggerSeconds) - (right.baseTriggerSeconds ?? right.triggerSeconds));
}

function getSpeedMultiplierAtBaseElapsed(baseElapsedSeconds: number, speedEvents: SpeedSkillEvent[]) {
  return speedEvents.reduce((multiplier, skillEvent) => {
    const baseStart = skillEvent.baseTriggerSeconds ?? skillEvent.triggerSeconds;
    const baseEnd = baseStart + skillEvent.durationSeconds * skillEvent.speedMultiplier;
    return baseElapsedSeconds >= baseStart && baseElapsedSeconds < baseEnd ? Math.max(multiplier, skillEvent.speedMultiplier) : multiplier;
  }, 1);
}

function animateHorseStride(runner: VisualRunner, progress: number, eliminated: boolean, speedMultiplier: number) {
  const legs = runner.mesh.userData.legs as HorseLegParts[] | undefined;
  const motionStyle = runner.mesh.userData.motionStyle as HorseMotionStyle | undefined;
  const rig = runner.mesh.userData.horseRig as HorseRigParts | undefined;

  if (!legs) {
    return;
  }

  const motion = getHorseMotionConfig(motionStyle ?? 'run');
  const moving = raceStarted && !eliminated && progress > 0.01 && progress < 0.995;
  const pace = moving ? motion.speed * speedMultiplier : 1.8;
  const swing = moving ? motion.swing * clampNumber(speedMultiplier, 0.75, 1.35) : 0.07;
  const lift = moving ? motion.lift * clampNumber(speedMultiplier, 0.8, 1.28) : 0.018;
  const time = raceElapsed * pace + runner.phase;
  const stride = Math.sin(time);
  const strideAbs = Math.abs(stride);
  const gallop = moving ? clampNumber(speedMultiplier, 0.75, 1.55) : 0.18;
  const bodyBounce = moving ? strideAbs * lift * 0.42 : Math.sin(time * 0.48) * 0.012;
  const bodyPitch = moving ? Math.sin(time + 0.42) * swing * 0.075 : Math.sin(time * 0.34) * 0.012;
  const neckCounter = moving ? Math.sin(time + Math.PI * 0.72) * swing * 0.11 : Math.sin(time * 0.3) * 0.012;
  const tailSwing = Math.sin(time * (moving ? 0.82 : 0.22) + runner.phase) * (moving ? 0.22 * gallop : 0.08);

  if (rig) {
    rig.body.position.y = 0.25 + bodyBounce * 0.56;
    rig.body.rotation.z = Math.PI / 2 + bodyPitch;
    rig.chest.position.y = 0.36 + bodyBounce * 0.82;
    rig.chest.rotation.z = bodyPitch * 0.42;
    rig.haunch.position.y = 0.32 + bodyBounce * 0.46;
    rig.haunch.rotation.z = -bodyPitch * 0.34;
    rig.neck.position.y = 0.9 + bodyBounce * 0.6;
    rig.neck.rotation.z = -0.66 + neckCounter;
    rig.head.position.y = 1.18 + bodyBounce * 0.54 - Math.max(0, stride) * lift * 0.12;
    rig.head.rotation.z = neckCounter * 0.48;
    rig.tail.rotation.z = 1.08 + tailSwing;
    rig.tail.rotation.x = Math.cos(time * 0.74 + runner.phase) * (moving ? 0.18 : 0.04);
    rig.shadow.scale.set(1.18 + strideAbs * 0.13, 0.32 + Math.max(0, -stride) * 0.035, 1);
    setHorseDustState(rig, time, moving, gallop);
  }

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

function setHorseDustState(rig: HorseRigParts, time: number, moving: boolean, speedMultiplier: number) {
  rig.dust.forEach((puff, index) => {
    const material = rig.dustMaterials[index];
    const phase = (puff.userData.phase as number | undefined) ?? 0;
    const side = (puff.userData.side as number | undefined) ?? 1;
    const contact = moving ? Math.max(0, Math.cos(time + phase)) : 0;
    const burst = smoothStep(contact);
    const spread = burst * (0.2 + speedMultiplier * 0.18);
    const baseX = -0.94 + (index % 5) * 0.42;

    puff.visible = moving || burst > 0.02;
    puff.position.x = baseX - spread * (0.9 + (index % 3) * 0.18);
    puff.position.y = -1.29 + burst * (0.1 + (index % 4) * 0.025);
    puff.position.z = side * (0.38 + spread * 0.72);
    puff.scale.setScalar(0.58 + burst * (0.9 + speedMultiplier * 0.28));

    if (material) {
      material.opacity = moving ? burst * 0.28 : 0;
    }
  });
}

function getHorseMotionConfig(style: HorseMotionStyle) {
  if (style === 'rush') {
    return { speed: 17.8, swing: 0.82, lift: 0.22 };
  }

  if (style === 'walk') {
    return { speed: 6.8, swing: 0.34, lift: 0.1 };
  }

  if (style === 'stroll') {
    return { speed: 4.8, swing: 0.24, lift: 0.07 };
  }

  return { speed: 11.2, swing: 0.58, lift: 0.15 };
}

function applySkillPose(runner: VisualRunner, active: boolean) {
  const rider = runner.mesh.userData.rider as RiderParts | undefined;
  const effect = runner.mesh.userData.effect as THREE.Mesh | undefined;
  const pose = getActiveSkillEvent(runner.placement)?.skill.pose;

  if (effect) {
    effect.visible = active && pose !== 'dance' && pose !== 'lie-flat';
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
    rider.root.position.y = lerpNumber(riderMountY, 0.62, fallProgress);
    rider.leftArm.rotation.z = lerpNumber(1.16, 2.1, fallProgress);
    rider.rightArm.rotation.z = lerpNumber(1.16, -1.7, fallProgress);
    rider.leftLeg.rotation.z = lerpNumber(-0.2, 0.8, fallProgress);
    rider.rightLeg.rotation.z = lerpNumber(-0.2, -0.2, fallProgress);
    return;
  }

  if (!active || !pose) {
    return;
  }

  poseRider(pose, rider, raceElapsed);
}

function resetRiderPose(rider: RiderParts) {
  const assetRider = rider.root.userData.assetRider === true;

  rider.root.position.set(assetRider ? riderMountX - 0.1 : riderMountX, assetRider ? riderMountY - 0.04 : riderMountY, 0);
  rider.root.rotation.set(0, 0, assetRider ? -0.08 : 0);
  rider.torso.position.set(assetRider ? 0.04 : 0.12, assetRider ? 0.34 : 0.22, 0);
  rider.torso.rotation.set(0, 0, -0.42);
  rider.head.position.set(assetRider ? 0 : 0.28, assetRider ? 1.04 : 0.64, assetRider ? 0.02 : 0);
  rider.head.rotation.set(0, 0, 0);
  rider.leftArm.position.set(assetRider ? 0 : 0.24, assetRider ? 0.5 : 0.24, assetRider ? 0.2 : 0.28);
  rider.leftArm.rotation.set(0, 0, 1.16);
  rider.rightArm.position.set(assetRider ? 0 : 0.24, assetRider ? 0.5 : 0.24, assetRider ? -0.2 : -0.28);
  rider.rightArm.rotation.set(0, 0, 1.16);
  rider.leftLeg.position.set(assetRider ? -0.02 : 0.02, assetRider ? -0.12 : -0.08, riderLegZ);
  rider.leftLeg.rotation.set(0.1, 0, -0.2);
  rider.rightLeg.position.set(assetRider ? -0.02 : 0.02, assetRider ? -0.12 : -0.08, -riderLegZ);
  rider.rightLeg.rotation.set(-0.1, 0, -0.2);
}

function poseRider(pose: SkillPose, rider: RiderParts, time: number) {
  if (pose === 'headspin') {
    rider.root.position.y = riderMountY + 0.34;
    rider.root.rotation.set(0, time * 17, Math.PI);
    rider.torso.rotation.x = Math.sin(time * 22) * 0.12;
    rider.leftArm.rotation.z = 2.25 + Math.sin(time * 18) * 0.22;
    rider.rightArm.rotation.z = -2.25 + Math.cos(time * 18) * 0.22;
    rider.leftLeg.rotation.z = -1.5 + Math.sin(time * 16) * 0.38;
    rider.rightLeg.rotation.z = 1.5 + Math.cos(time * 16) * 0.38;
    return;
  }

  if (pose === 'handstand') {
    rider.root.rotation.z = Math.PI;
    rider.root.position.y = riderMountY + 0.36;
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
    rider.head.position.x = 0.28 + Math.sin(time * 10) * 0.1;
    return;
  }

  if (pose === 'lie-flat') {
    rider.root.rotation.z = Math.PI / 2;
    rider.root.position.y = riderMountY - 0.12;
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
  const skill = getActiveSkillEvent(runner.placement)?.skill;
  const liveRank = getLiveRunnerRank(runner);
  const selected = isSelectedRunner(runner);
  const race = getCurrentRace();
  runner.label.textContent = runner.eliminated
    ? `${runner.placement.entry.name} - 탈락`
    : activeSkill && skill
      ? `${runner.placement.entry.name} - ${skill.name}`
      : raceFinished && race?.isFinal && runner.placement.qualified
        ? `우승 ${runner.placement.entry.name}`
        : raceFinished && runner.placement.qualified
          ? `진출 ${runner.placement.entry.name}`
          : selected
            ? `선택 ${runner.placement.entry.name}`
            : liveRank === 1
              ? `1위 ${runner.placement.entry.name}`
              : runner.placement.entry.name;
  runner.label.classList.toggle('skill', activeSkill);
  runner.label.classList.toggle('selected', selected);
  runner.label.classList.toggle('eliminated', runner.eliminated);
  runner.label.classList.toggle('hit', runner.eliminated && getFallProgress(getCurrentRace()?.hazardEvents ?? [], runner.placement) < 0.7);
  runner.label.classList.toggle('winner', raceFinished && getCurrentRace()?.isFinal && runner.placement.qualified);
  runner.label.classList.toggle('qualified', raceFinished && runner.placement.qualified && !getCurrentRace()?.isFinal);
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

function isSelectedRunner(runner: VisualRunner) {
  return selectedCameraEntryId !== 'overview' && selectedCameraEntryId === runner.placement.entry.id;
}

function getRunnerCalloutPriority(runner: VisualRunner) {
  const race = getCurrentRace();
  const liveRank = getLiveRunnerRank(runner);
  const selected = isSelectedRunner(runner);

  if (runner.skillActive) {
    return 100;
  }

  if (raceFinished && race?.isFinal && runner.placement.qualified) {
    return 96;
  }

  if (selected) {
    return 92;
  }

  if (runner.eliminated) {
    const fallProgress = getFallProgress(race?.hazardEvents ?? [], runner.placement);
    return fallProgress < 0.86 ? 86 : 42;
  }

  if (raceFinished && runner.placement.qualified) {
    return 78;
  }

  if (liveRank === 1) {
    return 70;
  }

  return 0;
}

function getVisibleCalloutRunnerIds() {
  return new Set(
    visualRunners
      .map((runner, index) => ({
        runner,
        index,
        priority: getRunnerCalloutPriority(runner)
      }))
      .filter((entry) => entry.priority > 0)
      .sort((left, right) => right.priority - left.priority || left.index - right.index)
      .slice(0, 4)
      .map((entry) => entry.runner.placement.entry.id)
  );
}

function positionRunnerLabels() {
  const rect = raceCanvas.getBoundingClientRect();
  const minX = rect.left + 44;
  const maxX = rect.right - 44;
  const minY = rect.top + 26;
  const maxY = rect.bottom - 32;
  const visibleCalloutIds = getVisibleCalloutRunnerIds();

  visualRunners.forEach((runner) => {
    const labelHeight = runner.eliminated ? 0.9 : 2.35;
    const anchor = runner.mesh.localToWorld(new THREE.Vector3(0, labelHeight, 0));
    const projected = anchor.project(camera);
    const screenX = rect.left + (projected.x * 0.5 + 0.5) * rect.width;
    const screenY = rect.top + (-projected.y * 0.5 + 0.5) * rect.height;
    const screenVisible =
      screenX >= rect.left + 18 && screenX <= rect.right - 18 && screenY >= rect.top + 16 && screenY <= rect.bottom - 16;
    const important = visibleCalloutIds.has(runner.placement.entry.id);
    const clampedX = important ? clampNumber(screenX, minX, maxX) : screenX;
    const clampedY = important ? clampNumber(screenY, minY, maxY) : screenY;
    const onCameraSide = projected.z < 1;
    const edgeOpacity = screenVisible ? 1 : 0.64;

    runner.label.style.opacity = String(onCameraSide && important ? edgeOpacity : 0);
    runner.label.style.transform = `translate(${clampedX}px, ${clampedY}px) translate(-50%, -120%)`;

    const identityAnchor = runner.mesh.localToWorld(new THREE.Vector3(-0.12, 1.44, 0));
    const identityProjected = identityAnchor.project(camera);
    const identityX = rect.left + (identityProjected.x * 0.5 + 0.5) * rect.width;
    const identityY = rect.top + (-identityProjected.y * 0.5 + 0.5) * rect.height;
    const identityVisible =
      identityProjected.z < 1 &&
      identityX >= rect.left + 16 &&
      identityX <= rect.right - 16 &&
      identityY >= rect.top + 16 &&
      identityY <= rect.bottom - 16;
    const identityRank = getLiveRunnerRank(runner);
    const showSupplementalIdentity = visualRunners.length <= 10 || isSelectedRunner(runner);
    runner.identityLabel.classList.toggle('eliminated', runner.eliminated);
    runner.identityLabel.classList.toggle('selected', isSelectedRunner(runner));
    runner.identityLabel.classList.toggle('rank-first', identityRank === 1 && !runner.eliminated);
    runner.identityLabel.style.opacity = String(identityVisible && raceStarted && showSupplementalIdentity && !important ? (runner.eliminated ? 0.42 : 0.86) : 0);
    runner.identityLabel.style.transform =
      `translate(${clampNumber(identityX, minX, maxX)}px, ${clampNumber(identityY, minY, maxY)}px) translate(-50%, -112%)`;
  });
}

function updateMinimap() {
  const activeIds = new Set<string>();
  const laneCount = Math.max(visualRunners.length, 1);

  visualRunners.forEach((runner) => {
    activeIds.add(runner.placement.entry.id);
    const dot = getMinimapDot(runner);
    const progress = clampNumber((runner.mesh.position.x - startX) / (finishX - startX), 0, 1);
    const laneProgress = laneCount <= 1 ? 0.5 : runner.lane / (laneCount - 1);

    dot.style.left = `${progress * 100}%`;
    dot.style.top = `${12 + laneProgress * 76}%`;
    dot.classList.toggle('eliminated', runner.eliminated);
    dot.classList.toggle('frenzy', isFrenzySkillActive(runner.placement));
    dot.classList.toggle('selected', selectedCameraEntryId === runner.placement.entry.id);
  });

  [...minimapDots.entries()].forEach(([entryId, dot]) => {
    if (activeIds.has(entryId)) {
      return;
    }

    dot.remove();
    minimapDots.delete(entryId);
  });
}

function getMinimapDot(runner: VisualRunner) {
  const entryId = runner.placement.entry.id;
  const existing = minimapDots.get(entryId);

  if (existing) {
    return existing;
  }

  const dot = document.createElement('span');
  dot.className = 'minimap-dot';
  dot.title = runner.placement.entry.name;
  dot.style.background = `#${runner.placement.entry.profile.color.toString(16).padStart(6, '0')}`;
  dot.style.borderColor = `#${runner.placement.entry.profile.secondaryColor.toString(16).padStart(6, '0')}`;
  minimapDots.set(entryId, dot);
  minimapDotsLayer.appendChild(dot);
  return dot;
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
    summaryGroup('진행 방식', [
      summaryRow('출전', `${race.placements.length}명`),
      summaryRow(race.isFinal ? '우승' : '진출', `${race.qualifiers.length}명`),
      summaryRow('전체', `${tournament.participantCount}명`)
    ]),
    summaryGroup('운영', [
      summaryRow('헬기', race.hazardEvents.length > 0 ? `출격 x${race.hazardEvents.length}` : '없음')
    ])
  );

  syncVictoryPresentation(race);
  replayButton.disabled = false;
  nextButton.disabled = currentRaceIndex >= totalRaces - 1;
}

function resultDetail(placement: RacePlacement, race = getCurrentRace()) {
  const time = `${placement.finishSeconds.toFixed(2)}초`;

  if (placement.eliminatedByHelicopter) {
    return `${time} / 헬기 탈락`;
  }

  if (!placement.qualified) {
    return time;
  }

  return race?.isFinal ? `${time} / 우승` : `${time} / 진출`;
}

function syncVictoryPresentation(race: RaceResult | null) {
  const winners = race ? getWinnerPlacements(race) : [];
  const show = Boolean(raceStarted && raceFinished && race?.isFinal && winners.length > 0);

  raceStage.classList.toggle('victory-active', show);
  raceStage.dataset.victory = show ? 'active' : 'idle';
  winnerBanner.setAttribute('aria-hidden', String(!show));

  if (!show || !race) {
    winnerName.textContent = '-';
    winnerDetail.textContent = '';
    return;
  }

  winnerName.textContent = winners.map((placement) => placement.entry.name).join(', ');
  winnerDetail.textContent = winners.length > 1
    ? `결승 상위 ${winners.length}명 / ${race.options.seed}`
    : `결승 ${winners[0]?.finishSeconds.toFixed(2)}초 / ${race.options.seed}`;
}

function updateVictoryEffect(race: RaceResult | null) {
  const primaryWinner = race ? getWinnerPlacements(race)[0] : null;
  const winnerRunner = primaryWinner
    ? visualRunners.find((runner) => runner.placement.entry.id === primaryWinner.entry.id)
    : null;

  if (!raceStarted || !raceFinished || !race?.isFinal || !winnerRunner) {
    victoryEffect.root.visible = false;
    victoryEffect.materials.forEach((material) => {
      material.opacity = 0;
    });
    return;
  }

  const pulse = 1 + Math.sin(raceElapsed * 5.2) * 0.08;
  victoryEffect.root.visible = true;
  victoryEffect.root.position.copy(winnerRunner.mesh.position);
  victoryEffect.root.position.y = horseBaseY + 0.04;
  victoryEffect.root.scale.setScalar(winnerRunner.baseScale * pulse);
  victoryEffect.spotlight.scale.setScalar(1.02 + Math.sin(raceElapsed * 3.2) * 0.045);
  victoryEffect.crown.rotation.y = raceElapsed * 1.2;
  victoryEffect.crown.position.y = 3.55 + Math.sin(raceElapsed * 3.6) * 0.16;

  const spotlightMaterial = victoryEffect.spotlight.material;
  if (spotlightMaterial instanceof THREE.MeshBasicMaterial) {
    spotlightMaterial.opacity = 0.2 + Math.sin(raceElapsed * 3.8) * 0.035;
  }

  victoryEffect.rings.forEach((ring, index) => {
    ring.rotation.z = raceElapsed * (1.1 + index * 0.26) + index * 0.7;
    ring.scale.setScalar(1 + Math.sin(raceElapsed * 4.4 + index) * 0.08);

    const material = ring.material;
    if (material instanceof THREE.MeshBasicMaterial) {
      material.opacity = 0.36 + Math.sin(raceElapsed * 5.8 + index) * 0.08;
    }
  });

  victoryEffect.beams.forEach((beam, index) => {
    const phase = Number(beam.userData.phase ?? 0);
    beam.rotation.z = raceElapsed * (0.7 + index * 0.08) + phase;

    const material = beam.material;
    if (material instanceof THREE.MeshBasicMaterial) {
      material.opacity = 0.12 + Math.sin(raceElapsed * 4.8 + phase) * 0.035;
    }
  });

  victoryEffect.sparks.forEach((spark, index) => {
    const phase = Number(spark.userData.phase ?? 0);
    const radius = Number(spark.userData.radius ?? 1.6);
    const cycle = (raceElapsed * 0.72 + index * 0.041) % 1;
    const angle = raceElapsed * (2.2 + (index % 5) * 0.18) + phase;
    spark.position.set(Math.cos(angle) * radius, 0.78 + cycle * 3.2, Math.sin(angle) * radius);
    spark.rotation.set(raceElapsed * 2 + phase, raceElapsed * 3.4 + phase, raceElapsed * 1.5);
    spark.scale.setScalar(0.78 + Math.sin(raceElapsed * 8 + phase) * 0.22);

    const material = spark.material;
    if (material instanceof THREE.MeshBasicMaterial) {
      material.opacity = Math.max(0, 0.74 * (1 - cycle * 0.82));
    }
  });

  victoryEffect.materials.forEach((material) => {
    if (material.opacity === 0) {
      material.opacity = 0.62;
    }
  });
}

function getWinnerPlacements(race: RaceResult) {
  return race.placements
    .filter((placement) => placement.qualified)
    .sort((left, right) => left.rank - right.rank);
}

function renderLeaderboard() {
  const race = getCurrentRace();

  if (!race) {
    return;
  }

  syncCameraState();

  const ranked = raceFinished
    ? race.placements
    : [...visualRunners]
        .sort((left, right) => right.mesh.position.x - left.mesh.position.x)
        .map((runner) => runner.placement);

  const visibleIds = new Set<string>();

  ranked.forEach((placement, index) => {
    const runner = visualRunners.find((candidate) => candidate.placement === placement);
    const eliminated = runner?.eliminated || (raceFinished && placement.eliminatedByHelicopter);
    const selected = selectedCameraEntryId === placement.entry.id;
    const parts = getLeaderboardItemParts(placement.entry.id);
    const currentChild = leaderboardList.children[index] ?? null;

    visibleIds.add(placement.entry.id);
    parts.rank.textContent = String(raceFinished ? placement.rank : index + 1);
    parts.name.textContent = placement.entry.name;
    parts.detail.textContent = raceFinished ? resultDetail(placement, race) : '';
    parts.detail.hidden = !raceFinished;
    parts.item.dataset.entryId = placement.entry.id;
    parts.item.setAttribute('role', 'button');
    parts.item.setAttribute('tabindex', cameraSelectionLocked ? '-1' : '0');
    parts.item.setAttribute('aria-pressed', String(selected));
    parts.item.classList.toggle('winner', raceFinished && race.isFinal && placement.qualified);
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

function syncCameraState() {
  const cameraMode = selectedCameraEntryId === 'overview' ? 'overview' : 'tracking';
  const cameraZoom = overviewCameraZoom.toFixed(2);
  raceStage.dataset.cameraMode = cameraMode;
  raceStage.dataset.cameraZoom = cameraZoom;
  raceStage.dataset.cameraSequence = currentCameraSequencePhase;
  leaderboardList.dataset.cameraMode = cameraMode;
  leaderboardList.dataset.cameraZoom = cameraZoom;
  leaderboardList.dataset.cameraSequence = currentCameraSequencePhase;
}

function selectCameraEntry(entryId: string) {
  if (cameraSelectionLocked || !entryId) {
    return;
  }

  selectedCameraEntryId = selectedCameraEntryId === entryId ? 'overview' : entryId;
  renderLeaderboard();
  updateMinimap();
}

function scrollLeaderboardFromWheel(event: WheelEvent) {
  const canScroll = leaderboardList.scrollWidth > leaderboardList.clientWidth;

  if (!canScroll) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  leaderboardList.scrollLeft += delta;
}

function startLeaderboardDrag(event: PointerEvent) {
  if (event.button !== 0 || leaderboardList.scrollWidth <= leaderboardList.clientWidth) {
    return;
  }

  leaderboardDragPointerId = event.pointerId;
  leaderboardDragStartX = event.clientX;
  leaderboardDragStartScrollLeft = leaderboardList.scrollLeft;
  leaderboardDragMoved = false;
  leaderboardList.classList.add('dragging');
}

function moveLeaderboardDrag(event: PointerEvent) {
  if (leaderboardDragPointerId !== event.pointerId) {
    return;
  }

  const deltaX = event.clientX - leaderboardDragStartX;
  if (Math.abs(deltaX) > 3) {
    leaderboardDragMoved = true;
  }

  if (leaderboardDragMoved) {
    event.preventDefault();
    if (!leaderboardList.hasPointerCapture(event.pointerId)) {
      leaderboardList.setPointerCapture(event.pointerId);
    }
    leaderboardList.scrollLeft = leaderboardDragStartScrollLeft - deltaX;
  }
}

function endLeaderboardDrag(event: PointerEvent) {
  if (leaderboardDragPointerId !== event.pointerId) {
    return;
  }

  if (leaderboardDragMoved) {
    suppressLeaderboardClick = true;
    window.setTimeout(() => {
      suppressLeaderboardClick = false;
    }, 0);
  }

  leaderboardDragPointerId = null;
  leaderboardDragMoved = false;
  leaderboardList.classList.remove('dragging');

  if (leaderboardList.hasPointerCapture(event.pointerId)) {
    leaderboardList.releasePointerCapture(event.pointerId);
  }
}

function adjustOverviewCameraZoom(delta: number) {
  const nextZoom = clampNumber(overviewCameraZoom + delta, overviewCameraZoomMin, overviewCameraZoomMax);

  if (Math.abs(nextZoom - overviewCameraZoom) < 0.001) {
    return;
  }

  overviewCameraZoom = nextZoom;
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

  detail.hidden = true;
  item.append(rank, name, detail);
  leaderboardItems.set(entryId, parts);

  return parts;
}

function startTournament() {
  saveRecentParticipants();
  const names = participantInput.value.split(/\r?\n/);
  const options = readOptions();
  tournament = runTournament(names, options);
  currentRaceIndex = 0;
  raceStarted = true;
  refreshCrowdBanners();
  setCurrentRace(0);
  setPanelsHidden(true);
}

function prepareTournament() {
  const names = participantInput.value.split(/\r?\n/);
  const options = readOptions();
  tournament = runTournament(names, options);
  currentRaceIndex = 0;
  raceStarted = false;
  refreshCrowdBanners();
  setCurrentRace(0);
  setPanelsHidden(false);
}

function setPanelsHidden(hidden: boolean) {
  raceStage.classList.toggle('panels-hidden', hidden);
  togglePanelsButton.setAttribute('aria-pressed', String(hidden));
}

function isFullscreenSupported() {
  return Boolean(document.fullscreenEnabled && raceStage.requestFullscreen);
}

function syncFullscreenButton() {
  const supported = isFullscreenSupported();
  const active = document.fullscreenElement === raceStage;
  toggleFullscreenButton.disabled = !supported;
  toggleFullscreenButton.setAttribute('aria-pressed', String(active));
  toggleFullscreenButton.title = supported
    ? active
      ? '전체화면 종료'
      : '전체화면'
    : '전체화면 미지원';
  raceStage.dataset.fullscreen = active ? 'active' : 'idle';
  raceStage.dataset.fullscreenSupported = supported ? 'true' : 'false';
}

async function toggleRaceFullscreen() {
  if (!isFullscreenSupported()) {
    syncFullscreenButton();
    return;
  }

  try {
    if (document.fullscreenElement === raceStage) {
      await document.exitFullscreen();
    } else {
      await raceStage.requestFullscreen();
    }
  } finally {
    syncFullscreenButton();
  }
}

function syncRaceStartedState() {
  raceStage.classList.toggle('race-started', raceStarted);
  raceStage.dataset.raceStarted = String(raceStarted);
}

function syncVisualStyleState() {
  raceStage.dataset.horseAsset = horseAssetId;
  raceStage.dataset.riderAsset = riderAssetId;
  raceStage.dataset.racerModelStrategy = racerModelStrategy;
  raceStage.dataset.horseAssetStatus = horseAssetStatus;
  raceStage.dataset.riderAssetStatus = riderAssetStatus;
  raceStage.dataset.horseAssetLicense = 'generated-local';
  raceStage.dataset.riderAssetLicense = 'generated-local';
  raceStage.dataset.horseVisualStyle = 'procedural-stylized';
  raceStage.dataset.riderVisualStyle = 'procedural-stylized';
}

function syncRacePaceState() {
  raceStage.dataset.racePace = defaultRacePaceMultiplier.toFixed(2);
}

function reshuffleOrder() {
  const timestamp = String(Date.now());
  const entropy = String(Math.floor(Math.random() * 100_000)).padStart(5, '0');
  seedInput.value = `toris-${timestamp}-${entropy}`;
  prepareTournament();
}

function getCurrentParticipantCount() {
  return normalizeParticipants(participantInput.value.split(/\r?\n/)).length;
}

function loadRecentParticipants() {
  try {
    const value = window.localStorage.getItem(recentParticipantsStorageKey);
    return value && value.split(/\r?\n/).some((name) => name.trim()) ? value : null;
  } catch {
    return null;
  }
}

function saveRecentParticipants() {
  const value = participantInput.value;

  try {
    if (value.split(/\r?\n/).some((name) => name.trim())) {
      window.localStorage.setItem(recentParticipantsStorageKey, value);
    } else {
      window.localStorage.removeItem(recentParticipantsStorageKey);
    }
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}

function getGraphicsQuality() {
  return 'standard';
}

function usesDetailedGraphics() {
  return true;
}

function applyGraphicsQuality() {
  raceStage.dataset.graphicsQuality = getGraphicsQuality();

  if (raceStarted) {
    void ensureHelicopterVisualLoading();
  }
}

function syncOptionBounds(options: { preferMaxFieldSize?: boolean } = {}) {
  const participantCount = getCurrentParticipantCount();
  const fieldBounds = getRaceOptionBounds(participantCount);
  const currentFieldSize = Number(fieldSizeInput.value);
  const preferMaxFieldSize =
    options.preferMaxFieldSize || !Number.isFinite(currentFieldSize) || currentFieldSize >= lastFieldSizeMax;
  const nextFieldSize = preferMaxFieldSize
    ? fieldBounds.fieldSize.max
    : clampIntegerInput(currentFieldSize, fieldBounds.fieldSize.min, fieldBounds.fieldSize.max);

  fieldSizeInput.min = String(fieldBounds.fieldSize.min);
  fieldSizeInput.max = String(fieldBounds.fieldSize.max);
  fieldSizeInput.value = String(nextFieldSize);
  lastFieldSizeMax = fieldBounds.fieldSize.max;

  const adjustedBounds = getRaceOptionBounds(participantCount, nextFieldSize);
  qualifiersInput.min = String(adjustedBounds.qualifiersPerGroup.min);
  qualifiersInput.max = String(adjustedBounds.qualifiersPerGroup.max);
  qualifiersInput.value = String(
    clampIntegerInput(Number(qualifiersInput.value), adjustedBounds.qualifiersPerGroup.min, adjustedBounds.qualifiersPerGroup.max)
  );
  winnerCountInput.min = String(adjustedBounds.winnerCount.min);
  winnerCountInput.max = String(adjustedBounds.winnerCount.max);
  winnerCountInput.value = String(clampIntegerInput(Number(winnerCountInput.value), adjustedBounds.winnerCount.min, adjustedBounds.winnerCount.max));
}

function clampIntegerInput(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(Number.isFinite(value) ? value : min)));
}

function readOptions(): Partial<RaceOptions> {
  syncOptionBounds();

  return {
    seed: seedInput.value,
    fieldSize: Number(fieldSizeInput.value),
    qualifiersPerGroup: Number(qualifiersInput.value),
    winnerCount: Number(winnerCountInput.value)
  };
}

function summaryRow(label: string, value: string) {
  const row = document.createElement('div');
  const key = document.createElement('span');
  const text = document.createElement('strong');
  row.className = 'race-summary-row';
  key.textContent = label;
  text.textContent = value;
  row.append(key, text);
  return row;
}

function summaryGroup(title: string, rows: HTMLElement[]) {
  const group = document.createElement('section');
  const heading = document.createElement('div');
  const body = document.createElement('div');

  group.className = 'race-summary-group';
  heading.className = 'race-summary-heading';
  heading.textContent = title;
  body.className = 'race-summary-group-body';
  body.append(...rows);
  group.append(heading, body);
  return group;
}

function laneZ(index: number, count: number) {
  if (count <= 1) {
    return 0;
  }

  return -raceWidth / 2 + (raceWidth / (count - 1)) * index;
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

function getTouchDistance(touches: TouchList) {
  if (touches.length < 2) {
    return null;
  }

  const first = touches[0];
  const second = touches[1];
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
}

function resize() {
  const width = raceCanvas.clientWidth;
  const height = raceCanvas.clientHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.fov = width < 760 ? 56 : 44;
  camera.updateProjectionMatrix();
}

function updateCamera(hazardEvent: HazardEvent | null, frenzyRunner: VisualRunner | null) {
  const width = raceCanvas.clientWidth;
  const mobile = width < 760;
  const defaultView = getDefaultCameraView(width);
  const defaultPosition = defaultView.position;
  const defaultTarget = defaultView.target;
  currentCameraSequencePhase = defaultView.phase;

  if (!hazardEvent) {
    if (frenzyRunner) {
      const frenzyView = getFrenzyCameraView(frenzyRunner, width);
      currentCameraSequencePhase = frenzyView.phase;
      moveCamera(frenzyView.position, frenzyView.target, frenzyView.alpha ?? 0.24);
      return;
    }

    moveCamera(defaultPosition, defaultTarget, defaultView.alpha ?? 0.13);
    return;
  }

  const target = visualRunners.find((runner) => runner.placement.entry.id === hazardEvent.targetEntryId);
  const currentHazardEvents = getCurrentRace()?.hazardEvents ?? [];

  if (!target || raceElapsed < getHazardSequenceStart(currentHazardEvents) || raceElapsed > getHazardSequenceEnd(currentHazardEvents)) {
    moveCamera(defaultPosition, defaultTarget, defaultView.alpha ?? 0.12);
    return;
  }

  currentCameraSequencePhase = 'cinematic';
  const targetPoint = getRunnerAimPoint(target);
  const helicopterPoint = helicopterGroup.getWorldPosition(new THREE.Vector3());
  const shotTiming = getShotTiming(hazardEvent);
  let desiredPosition: THREE.Vector3;
  let desiredTarget: THREE.Vector3;
  let cameraAlpha = 0.14;

  if (raceElapsed < shotTiming.shotStart) {
    const finishRouteCenter = targetPoint.clone().lerp(helicopterPoint, 0.62);
    if (mobile) {
      const helicopterView = getMobileHelicopterCameraView();
      desiredPosition = helicopterView.position;
      desiredTarget = helicopterView.target;
      cameraAlpha = helicopterView.alpha;
    } else {
      desiredPosition = finishRouteCenter.clone().add(new THREE.Vector3(-24, 13.5, 32));
      desiredTarget = finishRouteCenter.clone().lerp(helicopterPoint, 0.22);
      cameraAlpha = 0.07;
    }
  } else if (raceElapsed < hazardEvent.triggerSeconds) {
    const muzzlePoint = getMuzzleWorldPosition();
    const bulletProgress = clampNumber((raceElapsed - shotTiming.shotStart) / (hazardEvent.triggerSeconds - shotTiming.shotStart), 0, 1);
    const bulletPosition = bulletMesh.visible ? bulletMesh.position.clone() : muzzlePoint.clone().lerp(targetPoint, smoothStep(bulletProgress));
    if (mobile) {
      const helicopterView = getMobileHelicopterCameraView(bulletPosition);
      desiredPosition = helicopterView.position;
      desiredTarget = helicopterView.target;
      cameraAlpha = helicopterView.alpha;
    } else {
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
    }
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

function getFrenzyCameraView(runner: VisualRunner, width: number): CameraView {
  const skillEvent = getFrenzyCinematicWindowEvent(runner.placement);
  const start = getSkillStartSeconds(runner.placement, skillEvent);
  const elapsed = raceElapsed - start;
  const facePoint = getStableHorseFacePoint(runner);
  const forward = new THREE.Vector3(1, 0, 0);
  const laneSideSign = getTracksideCameraSign(runner.mesh.position.z);
  const side = new THREE.Vector3(-forward.z, 0, forward.x).normalize().multiplyScalar(laneSideSign);
  const cameraSide = side.lengthSq() > 0 ? side : new THREE.Vector3(0, 0, laneSideSign);
  const closeOffset = forward
    .clone()
    .multiplyScalar(width < 760 ? 5.4 : 4.8)
    .add(cameraSide.clone().multiplyScalar(width < 760 ? 1.4 : 1.05))
    .add(new THREE.Vector3(0, width < 760 ? 1.02 : 0.72, 0));

  if (elapsed < 0.88) {
    return {
      position: facePoint.clone().add(closeOffset),
      target: facePoint.clone().add(new THREE.Vector3(-0.35, 0.08, 0)),
      phase: 'cinematic',
      alpha: 0.34
    };
  }

  const runnerPoint = runner.mesh.position.clone();
  return {
    position: runnerPoint
      .clone()
      .add(new THREE.Vector3(width < 760 ? -6.4 : -5.1, width < 760 ? 3.6 : 2.8, laneSideSign * (width < 760 ? 7.2 : 5.4))),
    target: runnerPoint.clone().add(new THREE.Vector3(1.5, 1.2, 0)),
    phase: 'cinematic',
    alpha: 0.24
  };
}

function getDefaultCameraView(width: number): CameraView {
  if (selectedCameraEntryId === 'overview') {
    return getOverviewCameraView(width);
  }

  return getFocusedCameraView(width);
}

function getFocusedCameraView(width: number): CameraView {
  const leadRunner = getCameraFocusRunner();

  if (!leadRunner) {
    return {
      position: width < 760 ? new THREE.Vector3(startX - 11, 10.4, 18.4) : new THREE.Vector3(startX - 9, 7.4, 13.2),
      target: new THREE.Vector3(startX + 12, 1.12, 0),
      phase: raceStarted ? 'tracking' : 'pre-race'
    };
  }

  const leadPoint = leadRunner.mesh.position.clone();
  const clampedX = clampNumber(leadPoint.x, startX + 4, finishX - 5);
  const focusPoint = new THREE.Vector3(clampedX, leadPoint.y, leadPoint.z);
  const laneSideSign = getTracksideCameraSign(focusPoint.z);
  const positionOffset = width < 760
    ? new THREE.Vector3(-8.4, 5.9, laneSideSign * 11.8)
    : new THREE.Vector3(-5.8, 3.7, laneSideSign * 7.8);
  const targetOffset = width < 760 ? new THREE.Vector3(4.2, 1.08, 0) : new THREE.Vector3(3.6, 1.02, 0);

  return {
    position: focusPoint.clone().add(positionOffset),
    target: focusPoint.clone().add(targetOffset),
    phase: 'tracking',
    alpha: 0.15
  };
}

function getTracksideCameraSign(z: number) {
  return z < 0 ? -1 : 1;
}

function getOverviewCameraView(width: number): CameraView {
  const leadRunner = getLeadRunner();

  if (!leadRunner) {
    return {
      position: width < 760 ? new THREE.Vector3(startX - 11, 10.4, 18.4) : new THREE.Vector3(startX - 9, 7.6, 13.8),
      target: new THREE.Vector3(startX + 13, 1.12, 0),
      phase: 'pre-race',
      alpha: 0.12
    };
  }

  const mobile = width < 760;
  const zoomScale = 1 / overviewCameraZoom;
  const phase = getBroadcastCameraPhase(leadRunner);

  if (phase === 'pre-race') {
    return {
      position: mobile ? new THREE.Vector3(startX - 11, 10.4, 18.4) : new THREE.Vector3(startX - 9, 7.6, 13.8),
      target: new THREE.Vector3(startX + 13, 1.12, 0),
      phase,
      alpha: 0.12
    };
  }

  const packFocus = getBroadcastPackFocus(leadRunner);
  const leadX = clampNumber(leadRunner.mesh.position.x, startX + 8, finishX - 4);
  const packX = clampNumber(packFocus.x, startX + 3, finishX - 4);
  const laneBias = clampNumber(packFocus.z * 0.18, -2.6, 2.6);
  let centerX: number;
  let targetX: number;
  let height: number;
  let depth: number;
  let targetY = 1.08;
  let alpha = 0.13;

  if (phase === 'early') {
    centerX = mobile
      ? clampNumber(packX - 9.4 * zoomScale, startX - 1, startX + 42)
      : clampNumber(packX - 7.2 * zoomScale, startX - 1, startX + 52);
    targetX = mobile
      ? clampNumber(packX + 5.8 * zoomScale, startX + 8, finishX - 8)
      : clampNumber(packX + 7.4 * zoomScale, startX + 10, finishX - 7);
    height = (mobile ? 13.6 : 9.4) + Math.max(0, zoomScale - 1) * (mobile ? 2.2 : 1.3);
    depth = (mobile ? 26.8 : 18.8) + Math.max(0, zoomScale - 1) * (mobile ? 2.6 : 1.8);
    targetY = mobile ? 1.04 : 0.92;
    alpha = 0.1;
  } else if (phase === 'final-stretch') {
    const finalLaneBias = clampNumber(leadRunner.mesh.position.z * 0.22, -2.8, 2.8);
    const finalCameraSide = 1;
    const leadProgress = getRunnerTrackProgress(leadRunner);
    const stretchProgress = smoothStep(clampNumber((leadProgress - 0.76) / 0.22, 0, 1));
    const centerFinishBias = stretchProgress * (mobile ? 0.34 : 0.3);
    const targetFinishBias = stretchProgress * (mobile ? 0.44 : 0.38);
    centerX = mobile
      ? lerpNumber(clampNumber(leadX - 8.4 * zoomScale, startX + 12, finishX - 10), finishX - 15.6, centerFinishBias)
      : lerpNumber(clampNumber(leadX - 7.8 * zoomScale, startX + 14, finishX - 10), finishX - 15.2, centerFinishBias);
    targetX = mobile
      ? lerpNumber(clampNumber(leadX + 3.2 * zoomScale, startX + 16, finishX + 1.2), finishX + 0.8, targetFinishBias)
      : lerpNumber(clampNumber(leadX + 3.8 * zoomScale, startX + 18, finishX + 1.6), finishX + 1.15, targetFinishBias);
    height = (mobile ? 15.4 : 11.8) + Math.max(0, zoomScale - 1) * (mobile ? 2.5 : 1.6);
    depth = (mobile ? 32.5 : 25.2) + Math.max(0, zoomScale - 1) * (mobile ? 3.2 : 2.1);
    targetY = mobile ? 1.16 : 1.02;
    alpha = 0.17;
    return {
      position: new THREE.Vector3(centerX, height, finalCameraSide * depth + finalLaneBias * 0.32),
      target: new THREE.Vector3(targetX, targetY, finalLaneBias),
      phase,
      alpha
    };
  } else if (phase === 'finish') {
    const finishRunner = getFinishShotRunner() ?? leadRunner;
    const finishLaneBias = clampNumber(finishRunner.mesh.position.z * 0.28, -3.2, 3.2);
    const finishCameraSide = finishRunner.mesh.position.z < 0 ? -1 : 1;
    centerX = mobile ? finishX - 10.8 : finishX - 8.4;
    targetX = mobile ? finishX + 0.6 : finishX + 0.95;
    height = (mobile ? 12.8 : 8.8) + Math.max(0, zoomScale - 1) * (mobile ? 2 : 1.2);
    depth = (mobile ? 24.8 : 18.6) + Math.max(0, zoomScale - 1) * (mobile ? 2.4 : 1.5);
    targetY = 1.42;
    alpha = 0.22;
    return {
      position: new THREE.Vector3(centerX, height, finishCameraSide * depth + finishLaneBias * 0.24),
      target: new THREE.Vector3(targetX, targetY, finishLaneBias),
      phase,
      alpha
    };
  } else if (phase === 'winner') {
    const winnerRunner = getFinishShotRunner() ?? leadRunner;
    const winnerLaneFocus = clampNumber(winnerRunner.mesh.position.z, -(trackVisualWidth / 2 - 2.4), trackVisualWidth / 2 - 2.4);
    const winnerCameraSide = winnerRunner.mesh.position.z < 0 ? -1 : 1;
    const winnerX = clampNumber(winnerRunner.mesh.position.x, finishX - 1.4, finishX + 1.8);
    centerX = mobile ? winnerX - 8.8 : winnerX - 7.6;
    targetX = winnerX + (mobile ? 0.55 : 0.35);
    height = (mobile ? 8.6 : 6.45) + Math.max(0, zoomScale - 1) * (mobile ? 1.3 : 0.8);
    depth = (mobile ? 17.8 : 14.2) + Math.max(0, zoomScale - 1) * (mobile ? 1.8 : 1.1);
    targetY = mobile ? 2.05 : 1.94;
    alpha = 0.16;
    return {
      position: new THREE.Vector3(centerX, height, winnerLaneFocus + winnerCameraSide * depth),
      target: new THREE.Vector3(targetX, targetY, winnerLaneFocus),
      phase,
      alpha
    };
  } else {
    centerX = mobile
      ? clampNumber(packX - 6.8 * zoomScale, startX + 3, finishX - 12)
      : clampNumber(packX - 4.2 * zoomScale, startX + 3, finishX - 12);
    targetX = mobile
      ? clampNumber(leadX + 0.8 * zoomScale, startX + 5, finishX - 1)
      : clampNumber(leadX + 3.2 * zoomScale, startX + 6, finishX - 1);
    height = (mobile ? 15.2 : 10.8) + Math.max(0, zoomScale - 1) * (mobile ? 2.8 : 1.8);
    depth = (mobile ? 30.2 : 21.2) + Math.max(0, zoomScale - 1) * (mobile ? 3.4 : 2.2);
    targetY = mobile ? targetY : 0.96;
  }

  return {
    position: new THREE.Vector3(centerX, height, depth + laneBias * 0.35),
    target: new THREE.Vector3(targetX, targetY, laneBias),
    phase,
    alpha
  };
}

function getBroadcastCameraPhase(leadRunner: VisualRunner): RaceCameraSequencePhase {
  if (!raceStarted) {
    return 'pre-race';
  }

  if (raceFinished) {
    const race = getCurrentRace();

    if (
      race?.isFinal &&
      getWinnerPlacements(race).length > 0 &&
      raceElapsed >= getRaceFinishPresentationStart(race) + winnerPresentationDelaySeconds
    ) {
      return 'winner';
    }

    return 'finish';
  }

  const progress = getRunnerTrackProgress(leadRunner);

  if (progress < 0.24) {
    return 'early';
  }

  if (progress < 0.76) {
    return 'mid';
  }

  return 'final-stretch';
}

function getRaceFinishPresentationStart(race: RaceResult) {
  if (race.placements.length === 0) {
    return 0;
  }

  return Math.max(...race.placements.map((placement) => placement.finishSeconds)) + 0.8;
}

function getFinishShotRunner() {
  const race = getCurrentRace();
  const winner = race ? getWinnerPlacements(race)[0] : null;

  if (winner) {
    const winnerRunner = visualRunners.find((runner) => runner.placement.entry.id === winner.entry.id);

    if (winnerRunner) {
      return winnerRunner;
    }
  }

  return getLeadRunner();
}

function getBroadcastPackFocus(leadRunner: VisualRunner) {
  const activeRunners = visualRunners.filter((runner) => !runner.eliminated);
  const candidates = (activeRunners.length > 0 ? activeRunners : visualRunners)
    .sort((left, right) => right.mesh.position.x - left.mesh.position.x)
    .slice(0, Math.min(6, Math.max(1, visualRunners.length)));

  if (candidates.length === 0) {
    return leadRunner.mesh.position;
  }

  const sum = candidates.reduce(
    (total, runner) => {
      total.x += runner.mesh.position.x;
      total.z += runner.mesh.position.z;
      return total;
    },
    { x: 0, z: 0 }
  );

  return new THREE.Vector3(sum.x / candidates.length, leadRunner.mesh.position.y, sum.z / candidates.length).lerp(leadRunner.mesh.position, 0.38);
}

function getRunnerTrackProgress(runner: VisualRunner) {
  return clampNumber((runner.mesh.position.x - startX) / (finishX - startX), 0, 1);
}

function getCameraFocusRunner() {
  if (selectedCameraEntryId !== 'overview') {
    const selectedRunner = visualRunners.find((runner) => runner.placement.entry.id === selectedCameraEntryId);

    if (selectedRunner) {
      return selectedRunner;
    }
  }

  return getLeadRunner();
}

function snapCameraToLeader() {
  const view = getDefaultCameraView(raceCanvas.clientWidth);
  camera.position.copy(view.position);
  cameraLookTarget.copy(view.target);
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

function initializeCaptureControls() {
  const supported = isVideoCaptureSupported();
  raceStage.dataset.recording = supported ? 'idle' : 'unsupported';
  raceStage.dataset.recordingFormat = supported ? 'mp4' : 'unsupported';
  toggleRecordingButton.disabled = !supported;
  toggleRecordingButton.title = supported ? 'MP4 영상 캡처' : 'MP4 영상 캡처 미지원';
}

function isVideoCaptureSupported() {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function' &&
    getSupportedRecordingMimeType() !== ''
  );
}

function toggleRaceRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    stopRaceRecording();
    return;
  }

  startRaceRecording();
}

function startRaceRecording() {
  if (!isVideoCaptureSupported()) {
    raceStage.dataset.recording = 'unsupported';
    return;
  }

  const mimeType = getSupportedRecordingMimeType();
  if (!mimeType) {
    raceStage.dataset.recording = 'unsupported';
    raceStage.dataset.recordingFormat = 'unsupported';
    return;
  }

  const stream = createRecordingStream();
  const recorder = new MediaRecorder(stream, { mimeType });

  recordingMimeType = mimeType;
  recordedVideoChunks = [];
  recordingStartTime = performance.now();
  mediaRecorder = recorder;

  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) {
      recordedVideoChunks.push(event.data);
    }
  });

  recorder.addEventListener('stop', () => {
    const durationMs = performance.now() - recordingStartTime;
    stopRecordingCompositeLoop();
    stream.getTracks().forEach((track) => track.stop());
    const chunks = recordedVideoChunks;
    const mime = recordingMimeType;
    recordedVideoChunks = [];
    mediaRecorder = null;
    setRecordingActive(false);

    if (chunks.length === 0) {
      return;
    }

    const blob = new Blob(chunks, { type: mime });
    fixMp4Duration(blob, durationMs).then((fixed) => {
      downloadBlob(fixed, makeDownloadFilename('race-capture', 'mp4'));
    });
  });

  recorder.start(500);
  setRecordingActive(true);
}

function createRecordingStream() {
  recordingCanvas = document.createElement('canvas');
  recordingContext = recordingCanvas.getContext('2d');
  syncRecordingCanvasSize();
  drawRecordingCompositeFrame();
  return recordingCanvas.captureStream(60);
}

function stopRaceRecording() {
  const recorder = mediaRecorder;

  if (!recorder || recorder.state === 'inactive') {
    return;
  }

  if (recorder.state === 'recording') {
    recorder.requestData();
  }

  recorder.stop();
}

function setRecordingActive(active: boolean) {
  raceStage.dataset.recording = active ? 'active' : 'idle';
  toggleRecordingButton.classList.toggle('recording', active);
  toggleRecordingButton.setAttribute('aria-pressed', String(active));
  toggleRecordingButton.title = active ? 'MP4 영상 캡처 중지' : 'MP4 영상 캡처';
}

function syncRecordingCanvasSize() {
  if (!recordingCanvas) {
    return;
  }

  recordingCanvas.width = Math.max(1, raceCanvas.width);
  recordingCanvas.height = Math.max(1, raceCanvas.height);
}

function drawRecordingCompositeFrame() {
  if (!recordingCanvas || !recordingContext) {
    return;
  }

  if (recordingCanvas.width !== raceCanvas.width || recordingCanvas.height !== raceCanvas.height) {
    syncRecordingCanvasSize();
  }

  recordingContext.clearRect(0, 0, recordingCanvas.width, recordingCanvas.height);
  recordingContext.drawImage(raceCanvas, 0, 0, recordingCanvas.width, recordingCanvas.height);
  raceStage.dataset.recordingRunnerLabels = String(drawRunnerNameLabels(recordingContext, recordingCanvas.width, recordingCanvas.height));
  raceStage.dataset.recordingWinnerBanner = drawWinnerPresentationCaptureBanner(
    recordingContext,
    recordingCanvas.width,
    recordingCanvas.height,
    getCurrentRace()
  )
    ? 'active'
    : 'idle';
  recordingFrameRequest = window.requestAnimationFrame(drawRecordingCompositeFrame);
}

function stopRecordingCompositeLoop() {
  if (recordingFrameRequest) {
    window.cancelAnimationFrame(recordingFrameRequest);
    recordingFrameRequest = 0;
  }

  recordingCanvas = null;
  recordingContext = null;
  raceStage.dataset.recordingRunnerLabels = '0';
  raceStage.dataset.recordingWinnerBanner = 'idle';
}

function getSupportedRecordingMimeType() {
  const mimeTypes = ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4'];
  return mimeTypes.find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? '';
}

// Chrome MediaRecorder가 MP4 moov/mvhd duration을 첫 청크 기준으로만 기록하는 버그 패치
async function fixMp4Duration(blob: Blob, durationMs: number): Promise<Blob> {
  try {
    const buf = await blob.arrayBuffer();
    const view = new DataView(buf);
    let offset = 0;

    while (offset + 8 <= buf.byteLength) {
      const boxSize = view.getUint32(offset);
      const boxType = String.fromCharCode(
        view.getUint8(offset + 4), view.getUint8(offset + 5),
        view.getUint8(offset + 6), view.getUint8(offset + 7),
      );

      if (boxType === 'moov') {
        let inner = offset + 8;
        while (inner + 8 <= offset + boxSize) {
          const innerSize = view.getUint32(inner);
          const innerType = String.fromCharCode(
            view.getUint8(inner + 4), view.getUint8(inner + 5),
            view.getUint8(inner + 6), view.getUint8(inner + 7),
          );

          if (innerType === 'mvhd') {
            const version = view.getUint8(inner + 8);
            if (version === 0) {
              const timescale = view.getUint32(inner + 20);
              view.setUint32(inner + 24, Math.round(durationMs / 1000 * timescale));
            } else {
              const timescale = view.getUint32(inner + 28);
              const ticks = BigInt(Math.round(durationMs / 1000 * timescale));
              view.setBigUint64(inner + 32, ticks);
            }
            break;
          }

          if (innerSize < 8) break;
          inner += innerSize;
        }
        break;
      }

      if (boxSize < 8) break;
      offset += boxSize;
    }

    return new Blob([buf], { type: blob.type });
  } catch {
    return blob;
  }
}

function downloadResultScreenshot() {
  renderer.render(scene, camera);
  const screenshot = createResultScreenshotCanvas();
  screenshot.toBlob((blob) => {
    if (!blob) {
      return;
    }

    downloadBlob(blob, makeDownloadFilename('result', 'png'));
  }, 'image/png');
}

function createResultScreenshotCanvas() {
  const width = Math.max(1, raceCanvas.width);
  const height = Math.max(1, raceCanvas.height);
  const screenshot = document.createElement('canvas');
  screenshot.width = width;
  screenshot.height = height;
  const context = screenshot.getContext('2d');

  if (!context) {
    return screenshot;
  }

  context.drawImage(raceCanvas, 0, 0, width, height);
  raceStage.dataset.lastScreenshotRunnerLabels = String(drawRunnerNameLabels(context, width, height));
  raceStage.dataset.lastScreenshotWinnerBanner = drawWinnerPresentationCaptureBanner(context, width, height, getCurrentRace())
    ? 'active'
    : 'idle';
  drawResultScreenshotOverlay(context, width, height);
  return screenshot;
}

function drawRunnerNameLabels(context: CanvasRenderingContext2D, width: number, height: number) {
  const canvasRect = raceCanvas.getBoundingClientRect();
  const scaleX = width / Math.max(1, canvasRect.width);
  const scaleY = height / Math.max(1, canvasRect.height);
  let drawnCount = 0;

  context.save();
  context.scale(scaleX, scaleY);

  visualRunners.forEach((runner) => {
    const label = runner.label;
    const labelRect = label.getBoundingClientRect();
    const labelStyle = window.getComputedStyle(label);
    const opacity = Number(labelStyle.opacity);

    if (
      opacity <= 0.03 ||
      labelRect.width <= 0 ||
      labelRect.height <= 0 ||
      labelRect.right < canvasRect.left ||
      labelRect.left > canvasRect.right ||
      labelRect.bottom < canvasRect.top ||
      labelRect.top > canvasRect.bottom
    ) {
      return;
    }

    const x = labelRect.left - canvasRect.left;
    const y = labelRect.top - canvasRect.top;
    const radius = Math.min(labelRect.height / 2, 999);

    context.save();
    context.globalAlpha = opacity;
    context.shadowColor = 'rgba(15, 28, 24, 0.18)';
    context.shadowBlur = 14;
    context.shadowOffsetY = 4;
    context.fillStyle = labelStyle.backgroundColor || 'rgba(255, 255, 255, 0.92)';
    fillRoundedRect(context, x, y, labelRect.width, labelRect.height, radius);
    context.shadowColor = 'transparent';
    context.shadowBlur = 0;
    context.shadowOffsetY = 0;
    context.fillStyle = labelStyle.color || '#0f1c18';
    context.font = labelStyle.font;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(fitCanvasText(context, label.textContent ?? '', labelRect.width - 16), x + labelRect.width / 2, y + labelRect.height / 2);
    context.restore();
    drawnCount += 1;
  });

  context.restore();
  return drawnCount;
}

function drawWinnerPresentationCaptureBanner(context: CanvasRenderingContext2D, width: number, height: number, race: RaceResult | null) {
  const winners = race && raceFinished && race.isFinal ? getWinnerPlacements(race) : [];

  if (!race || winners.length === 0) {
    return false;
  }

  const scale = Math.max(0.72, Math.min(1.72, width / 1440));
  const margin = 20 * scale;
  const bannerWidth = Math.min(width - margin * 2, 600 * scale);
  const bannerHeight = 110 * scale;
  const bannerX = (width - bannerWidth) / 2;
  const bannerY = Math.max(margin, Math.min(92 * scale, height - bannerHeight - margin));
  const winnerText = winners.map((placement) => placement.entry.name).join(', ');
  const detailText = winners.length > 1
    ? `결승 상위 ${winners.length}명 / ${race.options.seed}`
    : `결승 ${winners[0]?.finishSeconds.toFixed(2)}초 / ${race.options.seed}`;

  context.save();
  context.shadowColor = 'rgba(9, 18, 22, 0.34)';
  context.shadowBlur = 42 * scale;
  context.shadowOffsetY = 18 * scale;
  context.fillStyle = 'rgba(9, 22, 20, 0.82)';
  fillRoundedRect(context, bannerX, bannerY, bannerWidth, bannerHeight, 8 * scale);
  context.shadowColor = 'transparent';
  context.shadowBlur = 0;
  context.shadowOffsetY = 0;
  context.strokeStyle = 'rgba(242, 201, 76, 0.74)';
  context.lineWidth = Math.max(1, 1.2 * scale);
  strokeRoundedRect(context, bannerX, bannerY, bannerWidth, bannerHeight, 8 * scale);

  context.textAlign = 'center';
  context.textBaseline = 'top';
  context.fillStyle = '#f2c94c';
  context.font = `900 ${12 * scale}px Inter, sans-serif`;
  context.fillText('최종 우승', bannerX + bannerWidth / 2, bannerY + 17 * scale);

  context.fillStyle = '#ffffff';
  context.font = `900 ${34 * scale}px Inter, sans-serif`;
  context.fillText(fitCanvasText(context, winnerText, bannerWidth - 48 * scale), bannerX + bannerWidth / 2, bannerY + 38 * scale);

  context.fillStyle = '#c9e4ef';
  context.font = `800 ${13 * scale}px Inter, sans-serif`;
  context.fillText(fitCanvasText(context, detailText, bannerWidth - 48 * scale), bannerX + bannerWidth / 2, bannerY + 80 * scale);
  context.restore();

  return true;
}

function drawResultScreenshotOverlay(context: CanvasRenderingContext2D, width: number, height: number) {
  const race = getCurrentRace();
  const scale = Math.max(0.72, Math.min(2.25, width / 1440));
  const margin = 24 * scale;
  const padding = 18 * scale;
  const columns = width < 1100 ? 2 : 4;
  const rows = getResultScreenshotRows(race);
  const rowHeight = 42 * scale;
  const gridRows = Math.max(1, Math.ceil(rows.length / columns));
  const panelWidth = Math.min(width - margin * 2, 1060 * scale);
  const panelHeight = padding * 2 + 44 * scale + gridRows * rowHeight;
  const panelX = (width - panelWidth) / 2;
  const panelY = height - panelHeight - margin;

  context.save();
  context.fillStyle = 'rgba(9, 22, 20, 0.72)';
  fillRoundedRect(context, panelX, panelY, panelWidth, panelHeight, 12 * scale);

  context.fillStyle = '#ffffff';
  context.font = `900 ${22 * scale}px Inter, sans-serif`;
  context.textBaseline = 'top';
  context.fillText(getResultScreenshotTitle(race), panelX + padding, panelY + padding);

  context.fillStyle = '#c9e4ef';
  context.font = `800 ${12 * scale}px Inter, sans-serif`;
  context.fillText(getResultScreenshotSubtitle(race), panelX + padding, panelY + padding + 28 * scale);

  const gridX = panelX + padding;
  const gridY = panelY + padding + 50 * scale;
  const gap = 8 * scale;
  const cellWidth = (panelWidth - padding * 2 - gap * (columns - 1)) / columns;

  rows.forEach((row, index) => {
    const column = index % columns;
    const rowIndex = Math.floor(index / columns);
    const x = gridX + column * (cellWidth + gap);
    const y = gridY + rowIndex * rowHeight;

    context.fillStyle = row.eliminated ? 'rgba(255, 77, 77, 0.26)' : row.qualified ? 'rgba(111, 207, 151, 0.24)' : 'rgba(255, 255, 255, 0.12)';
    fillRoundedRect(context, x, y, cellWidth, rowHeight - 6 * scale, 8 * scale);

    context.fillStyle = '#f2c94c';
    context.beginPath();
    context.arc(x + 16 * scale, y + 18 * scale, 12 * scale, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = '#112019';
    context.font = `900 ${12 * scale}px Inter, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(String(row.rank), x + 16 * scale, y + 18 * scale);

    context.textAlign = 'left';
    context.textBaseline = 'top';
    context.fillStyle = '#ffffff';
    context.font = `900 ${13 * scale}px Inter, sans-serif`;
    context.fillText(fitCanvasText(context, row.name, cellWidth - 48 * scale), x + 36 * scale, y + 7 * scale);

    context.fillStyle = '#c9e4ef';
    context.font = `800 ${10 * scale}px Inter, sans-serif`;
    context.fillText(fitCanvasText(context, row.detail, cellWidth - 48 * scale), x + 36 * scale, y + 23 * scale);
  });

  context.restore();
}

function getResultScreenshotTitle(race: RaceResult | null) {
  if (!race) {
    return '경기 결과';
  }

  if (raceFinished) {
    return race.isFinal ? '최종 우승 결과' : `${race.round}라운드 ${race.group}조 결과`;
  }

  return raceStarted ? '실시간 순위' : '출발 대기';
}

function getResultScreenshotSubtitle(race: RaceResult | null) {
  if (!race) {
    return '말발광 레이스';
  }

  const raceNumber = tournament ? `${currentRaceIndex + 1}/${tournament.races.length}` : '1/1';
  return `경기 ${raceNumber} / ${race.options.seed}`;
}

function getResultScreenshotRows(race: RaceResult | null) {
  if (!race) {
    return [];
  }

  if (raceStarted && !raceFinished && visualRunners.length > 0) {
    return [...visualRunners]
      .sort((left, right) => right.mesh.position.x - left.mesh.position.x)
      .slice(0, 8)
      .map((runner, index) => ({
        rank: index + 1,
        name: runner.placement.entry.name,
        detail: '',
        qualified: false,
        eliminated: runner.eliminated
      }));
  }

  return race.placements.slice(0, 8).map((placement) => ({
    rank: placement.rank || race.placements.indexOf(placement) + 1,
    name: placement.entry.name,
    detail: raceFinished ? resultDetail(placement) : '',
    qualified: placement.qualified,
    eliminated: placement.eliminatedByHelicopter
  }));
}

function traceRoundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const clampedRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + clampedRadius, y);
  context.lineTo(x + width - clampedRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + clampedRadius);
  context.lineTo(x + width, y + height - clampedRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - clampedRadius, y + height);
  context.lineTo(x + clampedRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - clampedRadius);
  context.lineTo(x, y + clampedRadius);
  context.quadraticCurveTo(x, y, x + clampedRadius, y);
  context.closePath();
}

function fillRoundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  traceRoundedRect(context, x, y, width, height, radius);
  context.fill();
}

function strokeRoundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  traceRoundedRect(context, x, y, width, height, radius);
  context.stroke();
}

function fitCanvasText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (context.measureText(text).width <= maxWidth) {
    return text;
  }

  let end = text.length;

  while (end > 1 && context.measureText(`${text.slice(0, end)}...`).width > maxWidth) {
    end -= 1;
  }

  return `${text.slice(0, end)}...`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function makeDownloadFilename(kind: string, extension: string) {
  const race = getCurrentRace();
  const raceId = race?.id ?? 'race';
  const seed = sanitizeFilename(seedInput.value || 'seed');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `run-hoban-run-${raceId}-${seed}-${kind}-${timestamp}.${extension}`;
}

function sanitizeFilename(value: string) {
  return value
    .trim()
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'race';
}

function animate() {
  const delta = clock.getDelta();
  resize();
  updateRace(delta);
  renderLeaderboard();
  renderer.render(scene, camera);
  completeBootLoader();
  requestAnimationFrame(animate);
}

sample20Button.addEventListener('click', () => {
  participantInput.value = createSampleParticipants(20).join('\n');
  saveRecentParticipants();
  syncOptionBounds({ preferMaxFieldSize: true });
  prepareTournament();
});

sample64Button.addEventListener('click', () => {
  participantInput.value = createSampleParticipants(64).join('\n');
  saveRecentParticipants();
  syncOptionBounds({ preferMaxFieldSize: true });
  prepareTournament();
});

participantInput.addEventListener('input', () => {
  saveRecentParticipants();
  syncOptionBounds();
  refreshCrowdBanners();
});
fieldSizeInput.addEventListener('input', () => syncOptionBounds());
startButton.addEventListener('click', startTournament);
randomSeedButton.addEventListener('click', reshuffleOrder);
leaderboardList.addEventListener('click', (event) => {
  if (suppressLeaderboardClick) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  const target = event.target instanceof Element ? event.target.closest<HTMLLIElement>('li[data-entry-id]') : null;

  if (target) {
    selectCameraEntry(target.dataset.entryId ?? '');
  }
});
leaderboardList.addEventListener('wheel', scrollLeaderboardFromWheel, { passive: false });
leaderboardList.addEventListener('pointerdown', startLeaderboardDrag);
leaderboardList.addEventListener('pointermove', moveLeaderboardDrag);
leaderboardList.addEventListener('pointerup', endLeaderboardDrag);
leaderboardList.addEventListener('pointercancel', endLeaderboardDrag);
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
toggleFullscreenButton.addEventListener('click', () => {
  void toggleRaceFullscreen();
});
toggleRecordingButton.addEventListener('click', toggleRaceRecording);
downloadResultShotButton.addEventListener('click', downloadResultScreenshot);
replayButton.addEventListener('click', () => {
  raceStarted = true;
  setCurrentRace(currentRaceIndex);
});
nextButton.addEventListener('click', () => {
  raceStarted = true;
  setCurrentRace(currentRaceIndex + 1);
});
raceStage.addEventListener(
  'wheel',
  (event) => {
    if (event.target instanceof Element && event.target.closest('#leaderboard')) {
      return;
    }

    if (cameraSelectionLocked) {
      return;
    }

    event.preventDefault();
    adjustOverviewCameraZoom(event.deltaY < 0 ? 0.08 : -0.08);
  },
  { passive: false }
);
raceStage.addEventListener(
  'touchstart',
  (event) => {
    activePinchDistance = getTouchDistance(event.touches);
  },
  { passive: true }
);
raceStage.addEventListener(
  'touchmove',
  (event) => {
    const nextDistance = getTouchDistance(event.touches);

    if (nextDistance === null || activePinchDistance === null || cameraSelectionLocked) {
      activePinchDistance = nextDistance;
      return;
    }

    const delta = (nextDistance - activePinchDistance) / 180;
    if (Math.abs(delta) >= 0.015) {
      event.preventDefault();
      adjustOverviewCameraZoom(delta);
      activePinchDistance = nextDistance;
    }
  },
  { passive: false }
);
raceStage.addEventListener('touchend', (event) => {
  activePinchDistance = getTouchDistance(event.touches);
});
raceStage.addEventListener('touchcancel', () => {
  activePinchDistance = null;
});
window.addEventListener('beforeunload', () => {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
});
window.addEventListener('resize', resize);
document.addEventListener('fullscreenchange', syncFullscreenButton);

syncFullscreenButton();
initializeCaptureControls();
raceStage.dataset.helicopterAsset = 'generated';
raceStage.dataset.helicopterAssetUrl = 'generated';
installHelicopterFallback(helicopterAssetSlot);
applyGraphicsQuality();
syncVisualStyleState();
void ensureRacerAssetLoading();
syncRacePaceState();
prepareTournament();
animate();
