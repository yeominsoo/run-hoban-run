import { Clone, Html, Line, useAnimations, useGLTF } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties } from "react";
import { CuboidCollider, Physics, RigidBody } from "@react-three/rapier";
import * as THREE from "three";
import {
  HELICOPTER_MODEL,
  SNIPER_RIFLE_MODEL,
} from "../game/combatAssetManifest";
import {
  QUATERNIUS_HORSE_MODEL,
  type HorseAnimationKey,
} from "../game/horseModelManifest";
import { colorForRacer } from "../game/racerColors";
import type {
  HelicopterStrikeEvent,
  RaceResult,
  RankedFrameRacer,
  Terrain,
} from "../game/raceEngine";
import { TRACK_RENDER_LANE_COUNT } from "../game/raceEngine";

const MAX_VISIBLE_RACERS = TRACK_RENDER_LANE_COUNT;
const DEFAULT_TRACK_LANE_COUNT = 8;
const TRACK_LANE_WIDTH = 4.9;
const MIN_TRACK_HALF_WIDTH = 12;
const COURSE_START_X = -320;
const COURSE_END_X = 320;
const TRACK_SAMPLE_SEGMENTS = 320;
const TRACK_LANE_HEIGHT = 0.64;
const JUMP_WINDOW_SECONDS = 0.92;
const HTML_Z_INDEX_RANGE: [number, number] = [8, 0];
const STRIKE_TRIGGER_LOOKBACK_SECONDS = 0.75;
const STRIKE_ENTER_SECONDS = 0.45;
const STRIKE_FRONT_SECONDS = 0.45;
const STRIKE_BACK_SECONDS = 0.35;
const STRIKE_THIRD_PERSON_SECONDS = 0.9;
const STRIKE_CINEMATIC_SECONDS =
  STRIKE_ENTER_SECONDS +
  STRIKE_FRONT_SECONDS +
  STRIKE_BACK_SECONDS +
  STRIKE_THIRD_PERSON_SECONDS;

interface TrackLayout {
  laneCount: number;
  halfWidth: number;
}

interface RaceSceneProps {
  race: RaceResult | null;
  racers: RankedFrameRacer[];
  playbackTime: number;
  focusRacer: RankedFrameRacer | null;
  introPhase: "showcase" | "overview" | "countdown" | null;
  introRacer: RankedFrameRacer | null;
  raceStarted: boolean;
}

interface HorseProps {
  racer: RankedFrameRacer;
  laneIndex: number;
  terrain: Terrain;
  layout: TrackLayout;
  jumpAmount: number;
  raceStarted: boolean;
  cinematicLocked: boolean;
}

type RacerPalette = ReturnType<typeof colorForRacer>;
type StrikePhase = "enter" | "sniper-front" | "sniper-back" | "third-person";

interface ActiveStrike {
  event: HelicopterStrikeEvent;
  target: RankedFrameRacer | null;
  laneIndex: number;
  startedAtSeconds: number;
}

const TERRAIN_THEME: Record<
  Terrain,
  {
    sky: string;
    fog: string;
    grass: string;
    track: string;
    rail: string;
    accent: string;
  }
> = {
  lake: {
    sky: "#b8e0ef",
    fog: "#d9efe9",
    grass: "#2f8050",
    track: "#9a6337",
    rail: "#f7f0dd",
    accent: "#1d7184",
  },
  hill: {
    sky: "#d8d2bd",
    fog: "#ece4cf",
    grass: "#557a41",
    track: "#8f633a",
    rail: "#f8ead0",
    accent: "#a46d2d",
  },
  forest: {
    sky: "#b9d7c2",
    fog: "#d8ead8",
    grass: "#2e6d46",
    track: "#7c5a34",
    rail: "#e9f0d8",
    accent: "#1f5f3c",
  },
};

useGLTF.preload(QUATERNIUS_HORSE_MODEL.url);
useGLTF.preload(HELICOPTER_MODEL.url);
useGLTF.preload(SNIPER_RIFLE_MODEL.url);

function createTrackLayout(racerCount: number): TrackLayout {
  const laneCount = Math.max(
    1,
    Math.min(MAX_VISIBLE_RACERS, racerCount || DEFAULT_TRACK_LANE_COUNT),
  );

  return {
    laneCount,
    halfWidth: Math.max(
      MIN_TRACK_HALF_WIDTH,
      (laneCount * TRACK_LANE_WIDTH) / 2,
    ),
  };
}

function getGroupLaneIndex(index: number, layout: TrackLayout): number {
  return Math.min(layout.laneCount - 1, Math.max(0, index));
}

export function RaceScene({
  race,
  racers,
  playbackTime,
  focusRacer,
  introPhase,
  introRacer,
  raceStarted,
}: RaceSceneProps) {
  const terrain = race?.track.terrain ?? "lake";
  const theme = TERRAIN_THEME[terrain];
  const renderedRacers = useMemo(() => {
    const stableRacers = racers.slice(0, MAX_VISIBLE_RACERS);

    if (
      focusRacer &&
      !stableRacers.some((racer) => racer.id === focusRacer.id)
    ) {
      stableRacers.push(focusRacer);
    }

    return stableRacers;
  }, [focusRacer, racers]);
  const layout = useMemo(
    () => createTrackLayout(renderedRacers.length),
    [renderedRacers.length],
  );
  const laneIndexByRacerId = useMemo(() => {
    const stableLaneRacers = renderedRacers.slice().sort((a, b) => a.id - b.id);

    return new Map(
      stableLaneRacers.map((racer, index) => [
        racer.id,
        getGroupLaneIndex(index, layout),
      ]),
    );
  }, [layout, renderedRacers]);
  const focusLaneIndex =
    focusRacer && laneIndexByRacerId.has(focusRacer.id)
      ? laneIndexByRacerId.get(focusRacer.id)
      : null;
  const jumpByRacerId = useMemo(
    () => buildJumpByRacerId(race, renderedRacers, playbackTime),
    [playbackTime, race, renderedRacers],
  );
  const activeStrike = useActiveStrike(
    race,
    renderedRacers,
    laneIndexByRacerId,
    playbackTime,
  );

  return (
    <Canvas
      className="race-canvas"
      dpr={[1, 2]}
      shadows
      camera={{ fov: 42, position: [0, 112, 142], near: 0.1, far: 1000 }}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
    >
      <color attach="background" args={[theme.sky]} />
      <fog attach="fog" args={[theme.fog, 130, 290]} />
      <hemisphereLight args={["#f8fbff", "#4e3422", 1.55]} />
      <directionalLight
        castShadow
        position={[-28, 58, 34]}
        intensity={2.2}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-360}
        shadow-camera-right={360}
        shadow-camera-top={92}
        shadow-camera-bottom={-92}
      />
      <RaceCamera
        focusRacer={focusRacer}
        focusLaneIndex={focusLaneIndex ?? null}
        introPhase={introPhase}
        introRacer={introRacer}
        activeStrike={activeStrike}
        terrain={terrain}
        layout={layout}
      />
      <Suspense fallback={null}>
        <Physics gravity={[0, -9.81, 0]}>
          <TrackPhysicsLayer layout={layout} />
          <TrackWorld terrain={terrain} layout={layout} />
        </Physics>
      </Suspense>
      <HelicopterAmbush
        activeStrike={activeStrike}
        terrain={terrain}
        layout={layout}
      />
      {renderedRacers.map((racer) => (
        <Horse
          key={racer.id}
          racer={racer}
          laneIndex={laneIndexByRacerId.get(racer.id) ?? 0}
          terrain={terrain}
          layout={layout}
          jumpAmount={jumpByRacerId.get(racer.id) ?? 0}
          raceStarted={raceStarted}
          cinematicLocked={Boolean(activeStrike)}
        />
      ))}
    </Canvas>
  );
}

function useActiveStrike(
  race: RaceResult | null,
  racers: RankedFrameRacer[],
  laneIndexByRacerId: Map<number, number>,
  playbackTime: number,
): ActiveStrike | null {
  const [activeStrike, setActiveStrike] = useState<ActiveStrike | null>(null);
  const seenEventKeys = useRef<Set<string>>(new Set());
  const raceKey = race?.seed ?? "no-race";

  useEffect(() => {
    seenEventKeys.current.clear();
    setActiveStrike(null);
  }, [raceKey]);

  useEffect(() => {
    if (!race) {
      setActiveStrike(null);
      return;
    }

    const nowSeconds = performance.now() / 1000;

    setActiveStrike((current) => {
      if (
        current &&
        nowSeconds - current.startedAtSeconds < STRIKE_CINEMATIC_SECONDS
      ) {
        return {
          ...current,
          target:
            racers.find((racer) => racer.id === current.event.targetId) ??
            current.target,
          laneIndex:
            laneIndexByRacerId.get(current.event.targetId) ?? current.laneIndex,
        };
      }

      const visibleIds = new Set(racers.map((racer) => racer.id));
      const event = race.helicopterStrikeEvents.find((candidate) => {
        const key = `${race.seed}:${candidate.id}`;

        return (
          visibleIds.has(candidate.targetId) &&
          !seenEventKeys.current.has(key) &&
          candidate.time <= playbackTime + 0.001 &&
          candidate.time >= playbackTime - STRIKE_TRIGGER_LOOKBACK_SECONDS &&
          candidate.impactTime > playbackTime + 0.25
        );
      });

      if (!event) {
        return current &&
          nowSeconds - current.startedAtSeconds >= STRIKE_CINEMATIC_SECONDS
          ? null
          : current;
      }

      const eventKey = `${race.seed}:${event.id}`;

      seenEventKeys.current.add(eventKey);

      return {
        event,
        target: racers.find((racer) => racer.id === event.targetId) ?? null,
        laneIndex: laneIndexByRacerId.get(event.targetId) ?? event.laneIndex,
        startedAtSeconds: nowSeconds,
      };
    });
  }, [laneIndexByRacerId, playbackTime, race, racers]);

  useEffect(() => {
    if (!activeStrike) {
      return undefined;
    }

    const elapsedSeconds =
      performance.now() / 1000 - activeStrike.startedAtSeconds;
    const timeoutId = window.setTimeout(
      () => {
        setActiveStrike((current) =>
          current?.event.id === activeStrike.event.id ? null : current,
        );
      },
      Math.max(0, STRIKE_CINEMATIC_SECONDS - elapsedSeconds) * 1000,
    );

    return () => window.clearTimeout(timeoutId);
  }, [activeStrike]);

  return activeStrike;
}

function RaceCamera({
  focusRacer,
  focusLaneIndex,
  introPhase,
  introRacer,
  activeStrike,
  terrain,
  layout,
}: {
  focusRacer: RankedFrameRacer | null;
  focusLaneIndex: number | null;
  introPhase: "showcase" | "overview" | "countdown" | null;
  introRacer: RankedFrameRacer | null;
  activeStrike: ActiveStrike | null;
  terrain: Terrain;
  layout: TrackLayout;
}) {
  const { camera } = useThree();
  const target = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, delta) => {
    if (introRacer) {
      const pose = trackPose(
        introRacer.progress,
        focusLaneIndex ?? Math.floor(layout.laneCount / 2),
        terrain,
        layout,
      );

      target.set(
        pose.x + Math.cos(pose.yaw) * 9.5,
        pose.y + 5.1,
        pose.z - Math.sin(pose.yaw) * 9.5,
      );
      camera.position.lerp(target, 1 - Math.exp(-delta * 5.2));
      camera.lookAt(pose.x, pose.y + 2.65, pose.z);
      return;
    }

    if (introPhase === "overview" || introPhase === "countdown") {
      const pose = trackPose(
        0,
        focusLaneIndex ?? Math.floor(layout.laneCount / 2),
        terrain,
        layout,
      );

      target.set(pose.x - 46, pose.y + 42, pose.z + 72);
      camera.position.lerp(target, 1 - Math.exp(-delta * 2.6));
      camera.lookAt(pose.x + 18, pose.y + 2.1, pose.z);
      return;
    }

    if (activeStrike) {
      const timing = getStrikeTiming(activeStrike);

      if (timing.active) {
        const targetPose = getStrikeTargetPose(activeStrike, terrain, layout);
        const helicopterPose = getHelicopterPose(
          activeStrike,
          timing,
          terrain,
          layout,
        );
        const cameraBackOffset =
          timing.phase === "enter"
            ? 28
            : timing.phase === "sniper-front"
              ? 20
              : 14;
        const cameraSideOffset =
          timing.phase === "third-person"
            ? 9
            : timing.phase === "sniper-back"
              ? 6
              : 12;
        const forwardX = Math.sin(helicopterPose.yaw);
        const forwardZ = Math.cos(helicopterPose.yaw);
        const sideX = Math.cos(helicopterPose.yaw);
        const sideZ = -Math.sin(helicopterPose.yaw);

        target.set(
          helicopterPose.x -
            forwardX * cameraBackOffset +
            sideX * cameraSideOffset,
          helicopterPose.y + 5.8,
          helicopterPose.z -
            forwardZ * cameraBackOffset +
            sideZ * cameraSideOffset,
        );
        camera.position.lerp(target, 1 - Math.exp(-delta * 4.1));
        camera.lookAt(targetPose.x, targetPose.y + 2.4, targetPose.z);
        return;
      }
    }

    if (focusRacer) {
      const pose = trackPose(
        focusRacer.progress,
        focusLaneIndex ?? Math.floor(layout.laneCount / 2),
        terrain,
        layout,
      );
      const cameraDistance = 13;
      const cameraHeight = 17;
      target.set(
        pose.x - Math.cos(pose.yaw) * cameraDistance,
        pose.y + cameraHeight,
        pose.z + Math.sin(pose.yaw) * cameraDistance,
      );
      camera.position.lerp(target, 1 - Math.exp(-delta * 2.8));
      camera.lookAt(pose.x, pose.y + 1.5, pose.z);
      return;
    }

    target.set(0, 112, 142);
    camera.position.lerp(target, 1 - Math.exp(-delta * 1.8));
    camera.lookAt(0, 0, 0);
  });

  return null;
}

function TrackPhysicsLayer({ layout }: { layout: TrackLayout }) {
  return (
    <RigidBody type="fixed" colliders={false}>
      <CuboidCollider
        args={[(COURSE_END_X - COURSE_START_X) / 2, 0.2, layout.halfWidth + 3]}
        position={[0, -0.28, 0]}
      />
    </RigidBody>
  );
}

function TrackWorld({
  terrain,
  layout,
}: {
  terrain: Terrain;
  layout: TrackLayout;
}) {
  const theme = TERRAIN_THEME[terrain];

  return (
    <group>
      <mesh receiveShadow position={[0, -0.25, 0]}>
        <boxGeometry args={[720, 0.4, 230]} />
        <meshStandardMaterial color={theme.grass} roughness={0.82} />
      </mesh>
      <TrackRibbonMesh color={theme.track} terrain={terrain} layout={layout} />
      <LaneLines color="#fff8df" terrain={terrain} layout={layout} />
      <TrackSurfaceBands terrain={terrain} layout={layout} />
      <Rails color={theme.rail} terrain={terrain} layout={layout} />
      <StartFinish accent={theme.accent} terrain={terrain} layout={layout} />
      <Venue terrain={terrain} layout={layout} />
    </group>
  );
}

function TrackRibbonMesh({
  color,
  terrain,
  layout,
}: {
  color: string;
  terrain: Terrain;
  layout: TrackLayout;
}) {
  const geometry = useMemo(
    () => createTrackRibbonGeometry(terrain, layout),
    [layout, terrain],
  );

  return (
    <mesh receiveShadow geometry={geometry}>
      <meshStandardMaterial
        color={color}
        roughness={0.92}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function LaneLines({
  color,
  terrain,
  layout,
}: {
  color: string;
  terrain: Terrain;
  layout: TrackLayout;
}) {
  const lanes = useMemo(() => {
    return Array.from(
      { length: Math.max(0, layout.laneCount - 1) },
      (_, index) => {
        const laneRatio = (index + 1) / layout.laneCount;
        return trackLinePoints(laneRatio, terrain, 0.34, layout);
      },
    );
  }, [layout, terrain]);

  return (
    <group>
      {lanes.map((points, index) => (
        <Line
          key={index}
          points={points}
          color={color}
          transparent
          opacity={0.34}
          lineWidth={1}
        />
      ))}
    </group>
  );
}

function TrackSurfaceBands({
  terrain,
  layout,
}: {
  terrain: Terrain;
  layout: TrackLayout;
}) {
  const bands = useMemo(() => {
    const count = terrain === "lake" ? 16 : terrain === "hill" ? 22 : 18;

    return Array.from({ length: count }, (_, index) => {
      const progress = 2.5 + (index / Math.max(1, count - 1)) * 95;
      const jitter =
        Math.sin(index * 1.73) *
        (terrain === "hill" ? 0.9 : terrain === "forest" ? 0.36 : 0.35);
      const inner = trackPoseForLaneRatio(
        progress + jitter,
        0.04,
        terrain,
        layout,
      );
      const outer = trackPoseForLaneRatio(
        progress + jitter,
        0.96,
        terrain,
        layout,
      );

      return [
        [inner.x, inner.y + 0.39, inner.z],
        [outer.x, outer.y + 0.39, outer.z],
      ] satisfies Array<[number, number, number]>;
    });
  }, [layout, terrain]);
  const bandColor =
    terrain === "lake"
      ? "#7b4f2d"
      : terrain === "forest"
        ? "#68513d"
        : "#5f4027";
  const opacity = terrain === "lake" ? 0.1 : terrain === "forest" ? 0.12 : 0.14;

  return (
    <group>
      {bands.map((points, index) => (
        <Line
          key={index}
          points={points}
          color={bandColor}
          transparent
          opacity={opacity}
          lineWidth={terrain === "hill" ? 2.2 : 1.6}
        />
      ))}
    </group>
  );
}

function Rails({
  color,
  terrain,
  layout,
}: {
  color: string;
  terrain: Terrain;
  layout: TrackLayout;
}) {
  const innerRail = useMemo(
    () => trackLinePoints(0, terrain, 1.12, layout),
    [layout, terrain],
  );
  const outerRail = useMemo(
    () => trackLinePoints(1, terrain, 1.12, layout),
    [layout, terrain],
  );
  const posts = useMemo(() => {
    return [0, 1].flatMap((laneRatio) => {
      return Array.from({ length: 38 }, (_, index) => {
        const progress = (index / 37) * 100;
        return trackPoseForLaneRatio(progress, laneRatio, terrain, layout);
      });
    });
  }, [layout, terrain]);

  return (
    <group>
      <Line points={innerRail} color={color} lineWidth={4} />
      <Line points={outerRail} color={color} lineWidth={4} />
      {posts.map((post) => (
        <mesh
          key={`${post.x}-${post.z}`}
          position={[post.x, post.y + 0.75, post.z]}
        >
          <cylinderGeometry args={[0.12, 0.14, 1.8, 12]} />
          <meshStandardMaterial
            color={color}
            metalness={0.05}
            roughness={0.45}
          />
        </mesh>
      ))}
    </group>
  );
}

function StartFinish({
  accent,
  terrain,
  layout,
}: {
  accent: string;
  terrain: Terrain;
  layout: TrackLayout;
}) {
  return (
    <group>
      <CourseGate
        accent={accent}
        label="START"
        progress={0}
        terrain={terrain}
        layout={layout}
      />
      <CourseGate
        accent={accent}
        label="FINISH"
        progress={100}
        terrain={terrain}
        layout={layout}
      />
    </group>
  );
}

function CourseGate({
  accent,
  label,
  progress,
  terrain,
  layout,
}: {
  accent: string;
  label: string;
  progress: number;
  terrain: Terrain;
  layout: TrackLayout;
}) {
  const inner = trackPoseForLaneRatio(progress, 0, terrain, layout);
  const outer = trackPoseForLaneRatio(progress, 1, terrain, layout);
  const middle = trackPoseForLaneRatio(progress, 0.5, terrain, layout);

  return (
    <group>
      <Line
        points={[
          [inner.x, inner.y + 0.52, inner.z],
          [outer.x, outer.y + 0.52, outer.z],
        ]}
        color="#f7f7ec"
        lineWidth={7}
      />
      {[inner, outer].map((post, index) => (
        <mesh key={`${label}-${index}`} position={[post.x, post.y + 5, post.z]}>
          <boxGeometry args={[1.2, 9.2, 1.2]} />
          <meshStandardMaterial
            color={accent}
            metalness={0.15}
            roughness={0.38}
          />
        </mesh>
      ))}
      <Line
        points={[
          [inner.x, inner.y + 9.65, inner.z],
          [outer.x, outer.y + 9.65, outer.z],
        ]}
        color={accent}
        lineWidth={9}
      />
      <Html
        position={[middle.x, middle.y + 10.55, middle.z]}
        center
        distanceFactor={22}
        transform
        sprite
        zIndexRange={HTML_Z_INDEX_RANGE}
      >
        <div className="gate-label">{label}</div>
      </Html>
    </group>
  );
}

function Venue({ terrain, layout }: { terrain: Terrain; layout: TrackLayout }) {
  const theme = TERRAIN_THEME[terrain];
  const trees = useMemo(() => {
    const count = terrain === "forest" ? 76 : 48;
    return Array.from({ length: count }, (_, index) => {
      const side = index % 2 === 0 ? -1 : 1;
      return {
        id: index,
        x: -304 + ((index * 23) % 608),
        z: side * (76 + ((index * 7) % 20)),
        height: 4.5 + (index % 5) * 0.55,
      };
    });
  }, [terrain]);

  return (
    <group>
      <group position={[-24, 1, -62]} rotation={[0, -0.06, 0]}>
        <mesh position={[0, 3.5, 0]}>
          <boxGeometry args={[46, 7, 9]} />
          <meshStandardMaterial color="#eef2f0" roughness={0.65} />
        </mesh>
        {Array.from({ length: 4 }, (_, row) => (
          <mesh key={row} position={[0, 2 + row * 1.1, -3.2 + row * 1.3]}>
            <boxGeometry args={[42, 0.55, 1.4]} />
            <meshStandardMaterial color="#dfb64f" roughness={0.7} />
          </mesh>
        ))}
        <mesh position={[0, 8, -0.8]}>
          <boxGeometry args={[50, 1, 11]} />
          <meshStandardMaterial color="#bb3d2d" roughness={0.5} />
        </mesh>
      </group>
      <mesh position={[4, 6.1, -56.8]}>
        <boxGeometry args={[30, 2.2, 0.3]} />
        <meshStandardMaterial color={theme.accent} roughness={0.5} />
      </mesh>
      {trees.map((tree) => (
        <group key={tree.id} position={[tree.x, 0, tree.z]}>
          <mesh position={[0, tree.height / 2, 0]}>
            <cylinderGeometry args={[0.22, 0.34, tree.height, 9]} />
            <meshStandardMaterial color="#6b4223" roughness={0.85} />
          </mesh>
          <mesh position={[0, tree.height + 1.6, 0]}>
            <coneGeometry args={[1.9 + (tree.id % 3) * 0.22, 4.6, 10]} />
            <meshStandardMaterial color={theme.grass} roughness={0.7} />
          </mesh>
        </group>
      ))}
      {terrain === "lake" && <Lake />}
      {terrain === "hill" && <Hills color={theme.grass} />}
      {terrain === "forest" && (
        <>
          <ForestCliffRun layout={layout} />
          <mesh position={[0, 6, 82]}>
            <boxGeometry args={[300, 9, 0.35]} />
            <meshStandardMaterial
              color="#d9ead8"
              transparent
              opacity={0.26}
              roughness={1}
            />
          </mesh>
        </>
      )}
    </group>
  );
}

function ForestCliffRun({ layout }: { layout: TrackLayout }) {
  const ledges = useMemo(() => {
    return Array.from({ length: 22 }, (_, index) => {
      const progress = 8 + index * 4;
      const pose = trackPoseForExtendedLaneRatio(
        progress,
        1.22,
        "forest",
        layout,
      );

      return {
        id: index,
        x: pose.x,
        y: pose.y,
        z: pose.z,
        yaw: pose.yaw,
        width: 4.8 + (index % 4) * 0.8,
      };
    });
  }, [layout]);
  const steppingStones = useMemo(() => {
    return Array.from({ length: 18 }, (_, index) => {
      const progress = 16 + index * 4.2;
      const pose = trackPoseForExtendedLaneRatio(
        progress,
        1.34 + Math.sin(index * 1.2) * 0.08,
        "forest",
        layout,
      );

      return {
        id: index,
        x: pose.x,
        y: pose.y,
        z: pose.z,
        yaw: pose.yaw,
        scale: 0.72 + (index % 4) * 0.08,
      };
    });
  }, [layout]);

  return (
    <group>
      {ledges.map((ledge) => (
        <group
          key={ledge.id}
          position={[ledge.x, ledge.y - 0.55, ledge.z]}
          rotation={[0, ledge.yaw, 0]}
        >
          <mesh receiveShadow position={[0, -0.15, 0]}>
            <boxGeometry args={[ledge.width, 0.72, 2.2]} />
            <meshStandardMaterial color="#6a503c" roughness={0.9} />
          </mesh>
          <mesh receiveShadow position={[0, -1.45, 1.55]}>
            <boxGeometry args={[ledge.width * 0.92, 1.8, 1.9]} />
            <meshStandardMaterial color="#2b3327" roughness={0.98} />
          </mesh>
        </group>
      ))}
      {steppingStones.map((stone) => (
        <mesh
          key={stone.id}
          receiveShadow
          position={[stone.x, stone.y + 0.12, stone.z]}
          rotation={[0, stone.yaw + Math.PI / 12, 0]}
          scale={[stone.scale * 1.12, 0.14, stone.scale * 0.72]}
        >
          <dodecahedronGeometry args={[1.05, 0]} />
          <meshStandardMaterial color="#aaa28f" roughness={0.88} />
        </mesh>
      ))}
    </group>
  );
}

function Lake() {
  return (
    <group>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        scale={[1.9, 0.76, 1]}
        position={[-92, 0.1, 68]}
      >
        <circleGeometry args={[13, 64]} />
        <meshStandardMaterial
          color="#2c95ad"
          emissive="#0a5564"
          emissiveIntensity={0.18}
          roughness={0.22}
          metalness={0.08}
          transparent
          opacity={0.9}
        />
      </mesh>
      <mesh
        rotation={[Math.PI / 2, 0, 0]}
        scale={[1.9, 0.76, 1]}
        position={[-92, 0.18, 68]}
      >
        <torusGeometry args={[13.2, 0.2, 10, 72]} />
        <meshStandardMaterial color="#eaf7ef" roughness={0.55} />
      </mesh>
    </group>
  );
}

function Hills({ color }: { color: string }) {
  return (
    <group>
      {[-122, -76, -28, 32, 82, 126].map((x, index) => (
        <mesh
          key={x}
          receiveShadow
          scale={[1.4, 0.28, 0.9]}
          position={[x, 2.2, 72 + (index % 2) * 6]}
        >
          <sphereGeometry args={[10 + index * 1.8, 22, 10]} />
          <meshStandardMaterial color={color} roughness={0.88} />
        </mesh>
      ))}
    </group>
  );
}

function HelicopterAmbush({
  activeStrike,
  terrain,
  layout,
}: {
  activeStrike: ActiveStrike | null;
  terrain: Terrain;
  layout: TrackLayout;
}) {
  const group = useRef<THREE.Group>(null);

  useFrame(() => {
    if (!group.current || !activeStrike) {
      return;
    }

    group.current.visible = getStrikeTiming(activeStrike).active;
  });

  if (!activeStrike) {
    return null;
  }

  const timing = getStrikeTiming(activeStrike);

  if (!timing.active) {
    return null;
  }

  const helicopterPose = getHelicopterPose(
    activeStrike,
    timing,
    terrain,
    layout,
  );
  const targetPose = getStrikeTargetPose(activeStrike, terrain, layout);
  const beamVisible =
    timing.phase === "sniper-back" || timing.phase === "third-person";
  const cue =
    timing.phase === "enter"
      ? "헬기 등장!"
      : timing.phase === "sniper-front"
        ? "정면 조준"
        : timing.phase === "sniper-back"
          ? "시점 전환"
          : `${activeStrike.event.targetName} 탈락!`;

  return (
    <group ref={group}>
      <group
        position={[helicopterPose.x, helicopterPose.y, helicopterPose.z]}
        rotation={[0, helicopterPose.yaw, 0]}
      >
        <Suspense fallback={<ProceduralHelicopter />}>
          <CombatHelicopter phase={timing.phase} />
        </Suspense>
        <Html
          position={[0, 5.9, 0]}
          center
          distanceFactor={18}
          transform
          sprite
          zIndexRange={HTML_Z_INDEX_RANGE}
        >
          <div className="helicopter-cue">{cue}</div>
        </Html>
      </group>
      {beamVisible && (
        <Line
          points={[
            [helicopterPose.x, helicopterPose.y - 0.2, helicopterPose.z],
            [targetPose.x, targetPose.y + 2.6, targetPose.z],
          ]}
          color="#fff1a6"
          transparent
          opacity={timing.phase === "third-person" ? 0.85 : 0.52}
          lineWidth={timing.phase === "third-person" ? 3.4 : 2}
        />
      )}
      {timing.phase === "third-person" && (
        <EliminationBurst
          position={[targetPose.x, targetPose.y + 3.6, targetPose.z]}
          label={`${activeStrike.event.targetName} 탈락`}
        />
      )}
    </group>
  );
}

function CombatHelicopter({ phase }: { phase: StrikePhase }) {
  const group = useRef<THREE.Group>(null);
  const helicopter = useGLTF(HELICOPTER_MODEL.url);
  const rifle = useGLTF(SNIPER_RIFLE_MODEL.url);

  useLayoutEffect(() => {
    group.current?.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
        object.frustumCulled = false;
      }
    });
  }, []);

  return (
    <group ref={group}>
      <group scale={HELICOPTER_MODEL.scale} position={[0, -2.6, 0]}>
        <Clone object={helicopter.scene} castShadow receiveShadow />
      </group>
      <mesh castShadow position={[2.4, 0.2, -0.35]} scale={[1.7, 0.9, 1.15]}>
        <sphereGeometry args={[1, 18, 12]} />
        <meshStandardMaterial
          color="#86d7ff"
          transparent
          opacity={0.52}
          roughness={0.22}
          metalness={0.04}
        />
      </mesh>
      <group
        position={[0.45, 0.9, -1.1]}
        rotation={[0, Math.PI, phase === "sniper-front" ? -0.08 : 0.08]}
        scale={1.22}
      >
        <SniperOperator />
        <group position={[1.05, 0.58, 0]} rotation={[0.05, Math.PI / 2, -0.05]}>
          <Clone object={rifle.scene} scale={SNIPER_RIFLE_MODEL.scale} />
        </group>
      </group>
      <RotorDisc y={2.55} radius={5.7} />
      <RotorDisc y={0.9} x={-5.35} radius={1.45} vertical />
      <CombatPods />
    </group>
  );
}

function ProceduralHelicopter() {
  return (
    <group scale={0.55}>
      <mesh castShadow position={[0, 0, 0]} scale={[4.8, 1.45, 1.7]}>
        <capsuleGeometry args={[1, 2.2, 10, 16]} />
        <meshStandardMaterial color="#2f4858" roughness={0.52} />
      </mesh>
      <mesh castShadow position={[4.2, 0.1, 0]} scale={[1.3, 0.75, 0.86]}>
        <sphereGeometry args={[1, 18, 12]} />
        <meshStandardMaterial color="#86d7ff" roughness={0.28} />
      </mesh>
      <mesh castShadow position={[-5.4, 0.05, 0]} scale={[4.2, 0.22, 0.24]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#26343d" roughness={0.6} />
      </mesh>
      <RotorDisc y={2.1} radius={4.5} />
    </group>
  );
}

function SniperOperator() {
  return (
    <group>
      <mesh castShadow position={[0, 0.65, 0]} scale={[0.36, 0.54, 0.3]}>
        <capsuleGeometry args={[0.34, 0.42, 8, 16]} />
        <meshStandardMaterial color="#1f2937" roughness={0.48} />
      </mesh>
      <mesh castShadow position={[0.18, 1.24, 0]} scale={[0.28, 0.28, 0.25]}>
        <sphereGeometry args={[1, 16, 12]} />
        <meshStandardMaterial color="#f0c29a" roughness={0.5} />
      </mesh>
      <mesh castShadow position={[0.1, 1.42, 0]} scale={[0.34, 0.15, 0.28]}>
        <sphereGeometry args={[1, 16, 8]} />
        <meshStandardMaterial color="#111827" roughness={0.4} />
      </mesh>
      {[-0.22, 0.22].map((z) => (
        <mesh
          key={`operator-arm-${z}`}
          castShadow
          position={[0.4, 0.76, z]}
          rotation={[0, 0.12 * Math.sign(z), -1.15]}
        >
          <capsuleGeometry args={[0.06, 0.52, 6, 10]} />
          <meshStandardMaterial color="#e8eef4" roughness={0.5} />
        </mesh>
      ))}
    </group>
  );
}

function RotorDisc({
  y,
  x = 0,
  radius,
  vertical = false,
}: {
  y: number;
  x?: number;
  radius: number;
  vertical?: boolean;
}) {
  const ref = useRef<THREE.Mesh>(null);

  useFrame((_, delta) => {
    if (!ref.current) {
      return;
    }

    ref.current.rotation[vertical ? "x" : "y"] += delta * 22;
  });

  return (
    <mesh
      ref={ref}
      position={[x, y, 0]}
      rotation={vertical ? [Math.PI / 2, 0, 0] : [0, 0, 0]}
    >
      <cylinderGeometry args={[radius, radius, 0.1, 44]} />
      <meshStandardMaterial
        color="#dff5ff"
        transparent
        opacity={0.28}
        emissive="#86d7ff"
        emissiveIntensity={0.18}
        roughness={0.3}
      />
    </mesh>
  );
}

function CombatPods() {
  return (
    <group>
      {[-1.85, 1.85].map((z) => (
        <mesh
          key={`pod-${z}`}
          castShadow
          position={[0.58, -0.65, z]}
          scale={[1.5, 0.34, 0.34]}
        >
          <capsuleGeometry args={[1, 2.2, 8, 14]} />
          <meshStandardMaterial
            color="#202a33"
            metalness={0.12}
            roughness={0.42}
          />
        </mesh>
      ))}
    </group>
  );
}

function EliminationBurst({
  position,
  label,
}: {
  position: [number, number, number];
  label: string;
}) {
  return (
    <group position={position}>
      {[0, 1, 2].map((index) => (
        <mesh
          key={index}
          rotation={[Math.PI / 2, 0, index * 0.72]}
          scale={1.5 + index * 0.55}
        >
          <torusGeometry args={[1, 0.035, 8, 48]} />
          <meshStandardMaterial
            color={index === 0 ? "#ffffff" : "#ffd95a"}
            emissive="#f59e0b"
            emissiveIntensity={0.34}
            transparent
            opacity={0.6 - index * 0.12}
          />
        </mesh>
      ))}
      <Html
        position={[0, 1.8, 0]}
        center
        distanceFactor={12}
        transform
        sprite
        zIndexRange={HTML_Z_INDEX_RANGE}
      >
        <div className="elimination-bubble">{label}</div>
      </Html>
    </group>
  );
}

function Horse({
  racer,
  laneIndex,
  terrain,
  layout,
  jumpAmount,
  raceStarted,
  cinematicLocked,
}: HorseProps) {
  const group = useRef<THREE.Group>(null);
  const visual = useRef<THREE.Group>(null);
  const color = colorForRacer(racer.id);
  const targetPosition = useMemo(() => new THREE.Vector3(), []);
  const pose = trackPose(racer.progress, laneIndex, terrain, layout);
  const maneColor = color.dark;
  const saddleColor = racer.rank <= 3 ? "#ffd95a" : "#f9f3df";
  const effectsEnabled = raceStarted && !cinematicLocked;
  const skillActive = effectsEnabled && racer.skillActive;
  const effectiveJumpAmount = effectsEnabled ? jumpAmount : 0;

  useFrame((_, delta) => {
    if (!group.current) {
      return;
    }

    targetPosition.set(
      pose.x,
      pose.y +
        TRACK_LANE_HEIGHT +
        (skillActive ? 0.18 : 0) +
        (!raceStarted || racer.eliminated ? 0 : effectiveJumpAmount * 2.35),
      pose.z,
    );
    group.current.position.lerp(targetPosition, 1 - Math.exp(-delta * 9));
    const bounce =
      !raceStarted || racer.eliminated
        ? 0
        : Math.abs(Math.sin(performance.now() * 0.008 + racer.id)) * 0.08;
    group.current.rotation.y = pose.yaw;
    const eliminationTilt = racer.eliminated ? -0.32 : 0;
    group.current.rotation.z =
      effectiveJumpAmount > 0.02 ? effectiveJumpAmount * 0.22 : eliminationTilt;

    if (visual.current) {
      visual.current.position.y = bounce;
    }
  });

  return (
    <group
      ref={group}
      position={[pose.x, pose.y + TRACK_LANE_HEIGHT, pose.z]}
      rotation={[0, pose.yaw, 0]}
      scale={1.28}
    >
      <group ref={visual}>
        <HorseVisual
          racer={racer}
          color={color}
          maneColor={maneColor}
          saddleColor={saddleColor}
          animation={selectHorseAnimation(
            racer,
            effectiveJumpAmount,
            raceStarted,
          )}
          skillActive={skillActive}
          paused={!raceStarted}
        />
      </group>
      {effectsEnabled && (skillActive || racer.rank <= 3) && (
        <RaceAura boosted={skillActive} />
      )}
      <NoseSteam
        active={
          effectsEnabled &&
          !racer.eliminated &&
          (skillActive || racer.rank <= 5)
        }
        racerId={racer.id}
        boosted={skillActive}
      />
      {effectsEnabled && skillActive && <SkillBoostEffect />}
      {effectsEnabled && racer.slowed && <SlowEffect />}
      {effectsEnabled && effectiveJumpAmount > 0.04 && (
        <JumpEffect amount={effectiveJumpAmount} />
      )}
      <RacerBillboard racer={racer} color={color} />
      {racer.eliminated && <EliminatedEffect />}
    </group>
  );
}

function HorseVisual({
  racer,
  color,
  maneColor,
  saddleColor,
  animation,
  skillActive,
  paused,
}: {
  racer: RankedFrameRacer;
  color: RacerPalette;
  maneColor: string;
  saddleColor: string;
  animation: HorseAnimationKey;
  skillActive: boolean;
  paused: boolean;
}) {
  return (
    <group>
      <Suspense
        fallback={
          <PrimitiveHorseBody
            racerId={racer.id}
            color={color}
            maneColor={maneColor}
            saddleColor={saddleColor}
            paused={paused}
          />
        }
      >
        <RiggedHorseVisual
          racerId={racer.id}
          color={color}
          saddleColor={saddleColor}
          animation={animation}
          skillActive={skillActive}
          paused={paused}
        />
      </Suspense>
      <ProceduralJockey
        racerId={racer.id}
        color={color}
        skillActive={skillActive}
        paused={paused}
      />
    </group>
  );
}

function RiggedHorseVisual({
  racerId,
  color,
  saddleColor,
  animation,
  skillActive,
  paused,
}: {
  racerId: number;
  color: RacerPalette;
  saddleColor: string;
  animation: HorseAnimationKey;
  skillActive: boolean;
  paused: boolean;
}) {
  return (
    <group>
      <RiggedHorseModel
        racerId={racerId}
        color={color}
        animation={animation}
        skillActive={skillActive}
        paused={paused}
      />
      <RiggedSaddle color={color} saddleColor={saddleColor} />
    </group>
  );
}

function RiggedHorseModel({
  racerId,
  color,
  animation,
  skillActive,
  paused,
}: {
  racerId: number;
  color: RacerPalette;
  animation: HorseAnimationKey;
  skillActive: boolean;
  paused: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const { scene, animations } = useGLTF(QUATERNIUS_HORSE_MODEL.url);
  const { actions } = useAnimations(animations, group);
  const clipName = QUATERNIUS_HORSE_MODEL.clips[animation];
  const timeScale = getHorseAnimationTimeScale(animation, skillActive);

  useLayoutEffect(() => {
    if (!group.current) {
      return;
    }

    tintRiggedHorse(group.current, color);
  }, [color]);

  useEffect(() => {
    const action = resolveAnimationAction(actions, clipName);

    if (!action) {
      return undefined;
    }

    Object.values(actions).forEach((candidate) => {
      if (candidate && candidate !== action) {
        candidate.fadeOut(0.12);
      }
    });

    action.enabled = true;
    action.timeScale = paused ? 0 : timeScale;
    action.reset();
    action.time = paused ? 0 : (racerId % 7) * 0.11;
    action.fadeIn(0.16).play();

    return () => {
      action.fadeOut(0.12);
    };
  }, [actions, clipName, paused, racerId, timeScale]);

  return (
    <group
      ref={group}
      rotation={[0, QUATERNIUS_HORSE_MODEL.rotationY, 0]}
      scale={QUATERNIUS_HORSE_MODEL.scale}
    >
      <Clone object={scene} castShadow receiveShadow />
    </group>
  );
}

function RiggedSaddle({
  color,
  saddleColor,
}: {
  color: RacerPalette;
  saddleColor: string;
}) {
  return (
    <group>
      <mesh castShadow position={[0.1, 2.72, 0]} scale={[1.06, 0.14, 0.6]}>
        <sphereGeometry args={[1, 18, 10]} />
        <meshStandardMaterial color={saddleColor} roughness={0.55} />
      </mesh>
      {[-0.5, 0.5].map((side) => (
        <mesh
          key={`rigged-saddle-cloth-${side}`}
          castShadow
          position={[0.1, 2.4, side]}
          scale={[0.72, 0.24, 0.05]}
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color={color.dark} roughness={0.52} />
        </mesh>
      ))}
    </group>
  );
}

function ProceduralJockey({
  racerId,
  color,
  skillActive,
  paused,
}: {
  racerId: number;
  color: RacerPalette;
  skillActive: boolean;
  paused: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const helmetColor = racerId % 3 === 0 ? "#ffffff" : color.base;
  const suitColor = racerId % 2 === 0 ? color.dark : "#243447";

  useFrame(() => {
    if (!group.current) {
      return;
    }

    const stride = paused
      ? 0
      : Math.sin(performance.now() * (skillActive ? 0.012 : 0.008) + racerId);
    group.current.rotation.z = -0.16 + stride * 0.035;
    group.current.position.y = 3.18 + Math.abs(stride) * 0.055;
  });

  return (
    <group ref={group} position={[0.05, 3.18, 0]} rotation={[0, 0, -0.16]}>
      <mesh castShadow position={[0, 0.42, 0]} scale={[0.34, 0.56, 0.28]}>
        <capsuleGeometry args={[0.32, 0.48, 8, 16]} />
        <meshStandardMaterial color={suitColor} roughness={0.48} />
      </mesh>
      <mesh castShadow position={[0.08, 1.1, 0]} scale={[0.28, 0.3, 0.25]}>
        <sphereGeometry args={[1, 16, 12]} />
        <meshStandardMaterial color="#f0c29a" roughness={0.48} />
      </mesh>
      <mesh castShadow position={[0.05, 1.34, 0]} scale={[0.34, 0.17, 0.28]}>
        <sphereGeometry args={[1, 18, 8]} />
        <meshStandardMaterial color={helmetColor} roughness={0.36} />
      </mesh>
      <mesh castShadow position={[0.36, 1.08, 0]} scale={[0.15, 0.06, 0.22]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#111827" roughness={0.38} />
      </mesh>
      {[-0.24, 0.24].map((z) => (
        <group
          key={`jockey-arm-${z}`}
          position={[0.24, 0.7, z]}
          rotation={[0, 0.18 * Math.sign(z), -0.86]}
        >
          <mesh castShadow>
            <capsuleGeometry args={[0.055, 0.5, 6, 10]} />
            <meshStandardMaterial color="#f8fafc" roughness={0.54} />
          </mesh>
        </group>
      ))}
      {[-0.16, 0.16].map((z) => (
        <group
          key={`jockey-leg-${z}`}
          position={[-0.08, 0.04, z]}
          rotation={[0, 0, -0.32]}
        >
          <mesh castShadow>
            <capsuleGeometry args={[0.065, 0.56, 6, 10]} />
            <meshStandardMaterial color="#1f2937" roughness={0.55} />
          </mesh>
          <mesh
            castShadow
            position={[0.16, -0.34, 0]}
            scale={[0.24, 0.06, 0.09]}
          >
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial color="#0f172a" roughness={0.5} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function PrimitiveHorseBody({
  racerId,
  color,
  maneColor,
  saddleColor,
  paused,
}: {
  racerId: number;
  color: RacerPalette;
  maneColor: string;
  saddleColor: string;
  paused: boolean;
}) {
  return (
    <group>
      <mesh castShadow position={[0, 1.1, 0]} scale={[2.05, 0.66, 0.62]}>
        <sphereGeometry args={[1, 24, 16]} />
        <meshStandardMaterial color={color.base} roughness={0.48} />
      </mesh>
      <mesh castShadow position={[0.12, 1.68, 0]} scale={[1.26, 0.2, 0.72]}>
        <sphereGeometry args={[1, 18, 10]} />
        <meshStandardMaterial color={saddleColor} roughness={0.55} />
      </mesh>
      {[-0.62, 0.62].map((side) => (
        <mesh
          key={`saddle-cloth-${side}`}
          castShadow
          position={[0.04, 1.38, side]}
          scale={[0.82, 0.32, 0.06]}
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color={color.dark} roughness={0.52} />
        </mesh>
      ))}
      <mesh
        castShadow
        position={[1.2, 1.38, 0]}
        rotation={[0, 0, -0.42]}
        scale={[0.42, 0.98, 0.4]}
      >
        <capsuleGeometry args={[0.38, 0.72, 8, 16]} />
        <meshStandardMaterial color={color.base} roughness={0.48} />
      </mesh>
      <mesh castShadow position={[2.06, 1.54, 0]} scale={[0.8, 0.48, 0.42]}>
        <sphereGeometry args={[1, 24, 14]} />
        <meshStandardMaterial color={color.base} roughness={0.46} />
      </mesh>
      <mesh castShadow position={[2.72, 1.43, 0]} scale={[0.38, 0.29, 0.3]}>
        <sphereGeometry args={[1, 16, 10]} />
        <meshStandardMaterial color={color.dark} roughness={0.5} />
      </mesh>
      <mesh castShadow position={[2.37, 1.69, 0]} scale={[0.08, 0.34, 0.08]}>
        <sphereGeometry args={[1, 10, 8]} />
        <meshStandardMaterial color="#f9f3df" roughness={0.6} />
      </mesh>
      {[-0.24, 0.24].map((eyeZ) => (
        <mesh
          key={`eye-${eyeZ}`}
          castShadow
          position={[2.56, 1.67, eyeZ]}
          scale={[0.06, 0.08, 0.045]}
        >
          <sphereGeometry args={[1, 8, 8]} />
          <meshStandardMaterial color="#10100f" roughness={0.35} />
        </mesh>
      ))}
      {[-0.18, 0.18].map((earZ) => (
        <mesh
          key={earZ}
          castShadow
          position={[1.86, 2.08, earZ]}
          rotation={[0.15, 0, -0.18]}
        >
          <coneGeometry args={[0.14, 0.48, 8]} />
          <meshStandardMaterial color={color.dark} roughness={0.52} />
        </mesh>
      ))}
      {Array.from({ length: 7 }, (_, index) => (
        <mesh
          key={index}
          castShadow
          position={[1.12 - index * 0.16, 1.94 - index * 0.045, 0]}
          rotation={[0, 0, -0.32]}
        >
          <coneGeometry args={[0.14, 0.58, 7]} />
          <meshStandardMaterial color={maneColor} roughness={0.58} />
        </mesh>
      ))}
      <mesh
        castShadow
        position={[-2.02, 1.1, 0]}
        rotation={[0, 0, Math.PI / 2.7]}
        scale={[0.58, 1.12, 0.58]}
      >
        <coneGeometry args={[0.34, 1.2, 14]} />
        <meshStandardMaterial color={color.dark} roughness={0.56} />
      </mesh>
      {[-1.22, 1.06].map((legX) =>
        [-0.36, 0.36].map((legZ) => (
          <AnimatedLeg
            key={`${legX}-${legZ}`}
            racerId={racerId}
            x={legX}
            z={legZ}
            paused={paused}
          />
        )),
      )}
    </group>
  );
}

function selectHorseAnimation(
  racer: RankedFrameRacer,
  jumpAmount: number,
  raceStarted: boolean,
): HorseAnimationKey {
  if (!raceStarted) {
    return "idle";
  }

  if (racer.eliminated) {
    return "brake";
  }

  if (jumpAmount > 0.08) {
    return "jump";
  }

  if (racer.slowed) {
    return "walk";
  }

  return "gallop";
}

function getHorseAnimationTimeScale(
  animation: HorseAnimationKey,
  skillActive: boolean,
): number {
  if (animation === "walk") {
    return 0.9;
  }

  if (animation === "gallop") {
    return skillActive ? 1.45 : 1.12;
  }

  return 1;
}

function resolveAnimationAction(
  actions: Record<string, THREE.AnimationAction | null>,
  clipName: string,
): THREE.AnimationAction | null {
  return (
    actions[clipName] ??
    actions[`AnimalArmature|${clipName}`] ??
    Object.entries(actions).find(([name]) =>
      name.endsWith(`|${clipName}`),
    )?.[1] ??
    null
  );
}

function tintRiggedHorse(root: THREE.Object3D, color: RacerPalette) {
  const lightColor = new THREE.Color(color.base).lerp(
    new THREE.Color("#f5e1bd"),
    0.42,
  );

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }

    object.castShadow = true;
    object.receiveShadow = true;
    object.frustumCulled = false;
    object.material = Array.isArray(object.material)
      ? object.material.map((material) =>
          cloneTintedHorseMaterial(material, color, lightColor),
        )
      : cloneTintedHorseMaterial(object.material, color, lightColor);
  });
}

function cloneTintedHorseMaterial(
  material: THREE.Material,
  color: RacerPalette,
  lightColor: THREE.Color,
): THREE.Material {
  const next = material.clone();

  if (next instanceof THREE.MeshStandardMaterial) {
    const name = material.name.toLowerCase();

    if (name.includes("hair") || name.includes("dark")) {
      next.color.set(color.dark);
    } else if (name.includes("light") || name.includes("muzzle")) {
      next.color.copy(lightColor);
    } else if (name.includes("hoof")) {
      next.color.set("#181411");
    } else if (name.includes("main")) {
      next.color.set(color.base);
    }

    next.roughness = Math.max(0.46, next.roughness);
  }

  return next;
}

function SlowEffect() {
  return (
    <Html
      position={[-0.25, 6.62, 0]}
      center
      distanceFactor={13}
      transform
      sprite
      zIndexRange={HTML_Z_INDEX_RANGE}
    >
      <div className="slow-bubble">으앙 느려진다</div>
    </Html>
  );
}

function EliminatedEffect() {
  return (
    <group>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0.08, 0]}>
        <torusGeometry args={[2.32, 0.04, 8, 56]} />
        <meshStandardMaterial
          color="#111827"
          emissive="#ffd95a"
          emissiveIntensity={0.22}
          transparent
          opacity={0.42}
        />
      </mesh>
      <Html
        position={[0.18, 6.72, 0]}
        center
        distanceFactor={13}
        transform
        sprite
        zIndexRange={HTML_Z_INDEX_RANGE}
      >
        <div className="eliminated-bubble">탈락!</div>
      </Html>
    </group>
  );
}

function JumpEffect({ amount }: { amount: number }) {
  return (
    <group>
      <mesh
        position={[-0.2, 0.08, 0]}
        rotation={[Math.PI / 2, 0, 0]}
        scale={[1 + amount * 0.8, 0.68 + amount * 0.4, 1]}
      >
        <torusGeometry args={[1.48, 0.03, 8, 48]} />
        <meshStandardMaterial
          color="#ffffff"
          emissive="#ffd95a"
          emissiveIntensity={0.28}
          transparent
          opacity={0.2 + amount * 0.42}
        />
      </mesh>
      <mesh position={[-1.45, 0.72, 0]} rotation={[0, 0, 0.38]}>
        <boxGeometry args={[1.42, 0.08, 0.08]} />
        <meshStandardMaterial
          color="#ffd95a"
          emissive="#d69a1e"
          emissiveIntensity={0.25}
          transparent
          opacity={0.38 + amount * 0.36}
        />
      </mesh>
    </group>
  );
}

function RaceAura({ boosted }: { boosted: boolean }) {
  return (
    <group>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0.08, 0]}>
        <torusGeometry
          args={[boosted ? 2.28 : 1.94, boosted ? 0.045 : 0.024, 8, 64]}
        />
        <meshStandardMaterial
          color={boosted ? "#ffd95a" : "#ffffff"}
          emissive={boosted ? "#d69a1e" : "#1d7184"}
          emissiveIntensity={boosted ? 0.45 : 0.18}
          transparent
          opacity={boosted ? 0.7 : 0.28}
        />
      </mesh>
    </group>
  );
}

function AnimatedLeg({
  racerId,
  x,
  z,
  paused,
}: {
  racerId: number;
  x: number;
  z: number;
  paused: boolean;
}) {
  const ref = useRef<THREE.Group>(null);

  useFrame(() => {
    if (!ref.current) {
      return;
    }

    const stride = paused
      ? 0
      : Math.sin(performance.now() * 0.01 + racerId + x + z);
    ref.current.rotation.z = (stride * Math.PI) / 12;
  });

  return (
    <group ref={ref} position={[x, 0.5, z]}>
      <mesh castShadow>
        <cylinderGeometry args={[0.13, 0.15, 1.08, 8]} />
        <meshStandardMaterial color="#2a211a" roughness={0.62} />
      </mesh>
      <mesh castShadow position={[0.04, -0.58, 0]} scale={[0.28, 0.12, 0.22]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#11100e" roughness={0.58} />
      </mesh>
    </group>
  );
}

function NoseSteam({
  active,
  racerId,
  boosted,
}: {
  active: boolean;
  racerId: number;
  boosted: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const particles = useMemo(() => {
    const count = boosted ? 12 : 6;
    return Array.from({ length: count }, (_, index) => ({
      id: index,
      delay: index * (boosted ? 0.18 : 0.32),
      side: index % 2 === 0 ? -1 : 1,
      lift: index % 3,
      scale:
        (boosted ? 0.34 : 0.22) +
        ((racerId + index) % 3) * (boosted ? 0.08 : 0.05),
    }));
  }, [boosted, racerId]);

  useFrame((_, delta) => {
    if (!group.current) {
      return;
    }

    group.current.visible = active;
    group.current.children.forEach((child, index) => {
      const particle = particles[index];
      const cycle = boosted ? 1.05 : 1.7;
      const age =
        (performance.now() * (boosted ? 0.0018 : 0.001) + particle.delay) %
        cycle;
      const normalizedAge = age / cycle;
      child.position.set(
        3 + normalizedAge * (boosted ? 3 : 1.5),
        1.55 + normalizedAge * (boosted ? 1.05 : 0.72) + particle.lift * 0.04,
        particle.side * (0.18 + normalizedAge * (boosted ? 0.45 : 0.12)),
      );
      child.scale.setScalar(
        particle.scale + normalizedAge * (boosted ? 0.72 : 0.38),
      );
      child.rotation.y += delta * (boosted ? 2.4 : 1);
    });
  });

  return (
    <group ref={group} visible={active}>
      {particles.map((particle) => (
        <mesh key={particle.id}>
          <sphereGeometry args={[0.32, 10, 10]} />
          <meshStandardMaterial
            color={boosted ? "#fff7d7" : "#f1f7ef"}
            emissive={boosted ? "#d69a1e" : "#000000"}
            emissiveIntensity={boosted ? 0.22 : 0}
            transparent
            opacity={boosted ? 0.56 : 0.42}
            roughness={0.95}
          />
        </mesh>
      ))}
    </group>
  );
}

function SkillBoostEffect() {
  return (
    <group>
      <group position={[3.15, 1.58, 0]}>
        {Array.from({ length: 6 }, (_, index) => {
          const z = (index - 2.5) * 0.18;
          const y = (index % 3) * 0.16 - 0.12;
          return (
            <mesh key={index} castShadow position={[0.58 + index * 0.1, y, z]}>
              <boxGeometry args={[1.08, 0.08, 0.08]} />
              <meshStandardMaterial
                color={index % 2 === 0 ? "#ffd95a" : "#ffffff"}
                emissive="#d69a1e"
                emissiveIntensity={0.35}
                roughness={0.45}
              />
            </mesh>
          );
        })}
      </group>
      <Html
        position={[0.25, 6.9, 0]}
        center
        distanceFactor={14}
        transform
        sprite
        zIndexRange={HTML_Z_INDEX_RANGE}
      >
        <div className="skill-bubble">스킬 사용!</div>
      </Html>
    </group>
  );
}

function RacerBillboard({
  racer,
  color,
}: {
  racer: RankedFrameRacer;
  color: ReturnType<typeof colorForRacer>;
}) {
  return (
    <Html
      position={[0.2, 7.15, 0]}
      center
      distanceFactor={16}
      transform
      sprite
      zIndexRange={HTML_Z_INDEX_RANGE}
    >
      <div
        className="racer-billboard"
        data-racer-id={racer.id}
        data-progress={racer.progress.toFixed(2)}
        style={
          {
            "--runner-color": color.base,
            "--runner-ink": color.ink,
          } as CSSProperties
        }
      >
        <strong>{racer.rank}</strong>
        <span>{racer.name}</span>
      </div>
    </Html>
  );
}

interface StrikeTiming {
  active: boolean;
  elapsed: number;
  phase: StrikePhase;
  phaseProgress: number;
}

interface ScenePose {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

function getStrikeTiming(activeStrike: ActiveStrike): StrikeTiming {
  const elapsed = Math.max(
    0,
    performance.now() / 1000 - activeStrike.startedAtSeconds,
  );

  if (elapsed < STRIKE_ENTER_SECONDS) {
    return {
      active: true,
      elapsed,
      phase: "enter",
      phaseProgress: elapsed / STRIKE_ENTER_SECONDS,
    };
  }

  if (elapsed < STRIKE_ENTER_SECONDS + STRIKE_FRONT_SECONDS) {
    return {
      active: true,
      elapsed,
      phase: "sniper-front",
      phaseProgress: (elapsed - STRIKE_ENTER_SECONDS) / STRIKE_FRONT_SECONDS,
    };
  }

  if (
    elapsed <
    STRIKE_ENTER_SECONDS + STRIKE_FRONT_SECONDS + STRIKE_BACK_SECONDS
  ) {
    return {
      active: true,
      elapsed,
      phase: "sniper-back",
      phaseProgress:
        (elapsed - STRIKE_ENTER_SECONDS - STRIKE_FRONT_SECONDS) /
        STRIKE_BACK_SECONDS,
    };
  }

  return {
    active: elapsed <= STRIKE_CINEMATIC_SECONDS,
    elapsed,
    phase: "third-person",
    phaseProgress: clamp(
      (elapsed -
        STRIKE_ENTER_SECONDS -
        STRIKE_FRONT_SECONDS -
        STRIKE_BACK_SECONDS) /
        STRIKE_THIRD_PERSON_SECONDS,
      0,
      1,
    ),
  };
}

function getHelicopterPose(
  activeStrike: ActiveStrike,
  timing: StrikeTiming,
  terrain: Terrain,
  layout: TrackLayout,
): ScenePose {
  const targetPose = getStrikeTargetPose(activeStrike, terrain, layout);
  const finishPose = trackPose(100, activeStrike.laneIndex, terrain, layout);
  const direction = activeStrike.event.id % 2 === 0 ? 1 : -1;
  const entry =
    1 - easeOutCubic(clamp(timing.elapsed / STRIKE_ENTER_SECONDS, 0, 1));
  const x = finishPose.x + 10 - entry * 34;
  const z = finishPose.z + direction * (24 + entry * 34);
  const y =
    finishPose.y +
    22 +
    Math.sin(timing.elapsed * 6 + activeStrike.event.id) * 0.46;
  const yaw = Math.atan2(targetPose.x - x, targetPose.z - z);

  return { x, y, z, yaw };
}

function getStrikeTargetPose(
  activeStrike: ActiveStrike,
  terrain: Terrain,
  layout: TrackLayout,
): ScenePose {
  return trackPose(
    activeStrike.target?.progress ?? activeStrike.event.trackProgress,
    activeStrike.laneIndex,
    terrain,
    layout,
  );
}

function easeOutCubic(value: number): number {
  const t = clamp(value, 0, 1);
  return 1 - (1 - t) ** 3;
}

function createTrackRibbonGeometry(
  terrain: Terrain,
  layout: TrackLayout,
): THREE.BufferGeometry {
  const segments = TRACK_SAMPLE_SEGMENTS;
  const vertices: number[] = [];
  const indices: number[] = [];

  for (let index = 0; index <= segments; index += 1) {
    const progress = (index / segments) * 100;
    const inner = trackPoseForLaneRatio(progress, 0, terrain, layout);
    const outer = trackPoseForLaneRatio(progress, 1, terrain, layout);
    vertices.push(inner.x, inner.y + 0.05, inner.z);
    vertices.push(outer.x, outer.y + 0.05, outer.z);

    if (index < segments) {
      const start = index * 2;
      indices.push(start, start + 1, start + 2);
      indices.push(start + 1, start + 3, start + 2);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function trackLinePoints(
  laneRatio: number,
  terrain: Terrain,
  yOffset: number,
  layout: TrackLayout,
): Array<[number, number, number]> {
  return Array.from({ length: TRACK_SAMPLE_SEGMENTS + 1 }, (_, index) => {
    const progress = (index / TRACK_SAMPLE_SEGMENTS) * 100;
    const pose = trackPoseForLaneRatio(progress, laneRatio, terrain, layout);
    return [pose.x, pose.y + yOffset, pose.z];
  });
}

function trackPose(
  progress: number,
  laneIndex: number,
  terrain: Terrain,
  layout: TrackLayout,
) {
  const laneRatio =
    (clampLaneIndex(laneIndex, layout) + 0.5) / layout.laneCount;
  return trackPoseForLaneRatio(progress, laneRatio, terrain, layout);
}

function trackPoseForLaneRatio(
  progress: number,
  laneRatio: number,
  terrain: Terrain,
  layout: TrackLayout,
) {
  return trackPoseForLooseLaneRatio(
    progress,
    clamp(laneRatio, 0, 1),
    terrain,
    layout,
  );
}

function trackPoseForExtendedLaneRatio(
  progress: number,
  laneRatio: number,
  terrain: Terrain,
  layout: TrackLayout,
) {
  return trackPoseForLooseLaneRatio(
    progress,
    clamp(laneRatio, -0.65, 1.65),
    terrain,
    layout,
  );
}

function trackPoseForLooseLaneRatio(
  progress: number,
  laneRatio: number,
  terrain: Terrain,
  layout: TrackLayout,
) {
  const t = clamp(progress, 0, 100) / 100;
  const center = courseCenterPoint(t, terrain);
  const before = courseCenterPoint(Math.max(0, t - 0.004), terrain);
  const after = courseCenterPoint(Math.min(1, t + 0.004), terrain);
  const tangentX = after.x - before.x;
  const tangentZ = after.z - before.z;
  const tangentLength = Math.hypot(tangentX, tangentZ) || 1;
  const normalX = -tangentZ / tangentLength;
  const normalZ = tangentX / tangentLength;
  const laneOffset = THREE.MathUtils.lerp(
    -layout.halfWidth,
    layout.halfWidth,
    laneRatio,
  );
  const yaw = Math.atan2(-tangentZ, tangentX);

  return {
    x: center.x + normalX * laneOffset,
    y: center.y,
    z: center.z + normalZ * laneOffset,
    yaw,
  };
}

function courseCenterPoint(t: number, terrain: Terrain) {
  const x = THREE.MathUtils.lerp(COURSE_START_X, COURSE_END_X, t);
  const edgeEase = Math.sin(t * Math.PI);

  if (terrain === "hill") {
    return {
      x,
      y: Math.max(
        0,
        edgeEase *
          (3.1 +
            Math.sin(t * Math.PI * 4 + 0.35) * 1.1 +
            Math.sin(t * Math.PI * 8.5) * 0.38),
      ),
      z: 0,
    };
  }

  if (terrain === "forest") {
    return {
      x,
      y: Math.max(
        0,
        0.34 +
          edgeEase *
            (Math.sin(t * Math.PI * 3.8 + 0.4) * 0.28 +
              Math.sin(t * Math.PI * 7.4) * 0.08),
      ),
      z: 0,
    };
  }

  return {
    x,
    y: edgeEase * Math.max(0, Math.sin(t * Math.PI * 5.2) * 0.14),
    z: 0,
  };
}

function clampLaneIndex(laneIndex: number, layout: TrackLayout): number {
  return Math.max(0, Math.min(layout.laneCount - 1, laneIndex));
}

function buildJumpByRacerId(
  race: RaceResult | null,
  racers: RankedFrameRacer[],
  playbackTime: number,
): Map<number, number> {
  const jumpByRacerId = new Map<number, number>();

  if (!race || racers.length === 0) {
    return jumpByRacerId;
  }

  const visibleIds = new Set(racers.map((racer) => racer.id));

  race.racerObstacleEvents.forEach((event) => {
    if (event.passed !== true || !visibleIds.has(event.racerId)) {
      return;
    }

    const phase =
      (playbackTime - (event.time - JUMP_WINDOW_SECONDS / 2)) /
      JUMP_WINDOW_SECONDS;

    if (phase < 0 || phase > 1) {
      return;
    }

    const amount = Math.sin(phase * Math.PI);
    jumpByRacerId.set(
      event.racerId,
      Math.max(jumpByRacerId.get(event.racerId) ?? 0, amount),
    );
  });

  return jumpByRacerId;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
