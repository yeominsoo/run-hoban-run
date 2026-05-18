import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  chooseCameraFocus,
  createEmptyCameraFocus,
  getFocusedRacer,
} from "./game/focusDirector";
import type { FocusReason } from "./game/focusDirector";
import { colorForRacer } from "./game/racerColors";
import {
  LAP_COUNT_OPTIONS,
  MAX_PARTICIPANTS,
  RACE_DURATION_SECONDS,
  RACE_GROUP_SIZE_OPTIONS,
  RACE_GROUP_STAGE_SECONDS,
  TRACK_TYPES,
  findFrame,
  getRaceDisplayDurationSeconds,
  getRaceGroupCount,
  rankFrame,
  toRankingCsv,
} from "./game/raceEngine";
import type { RaceResult, RankedFrameRacer, TrackId } from "./game/raceEngine";
import {
  PLAYBACK_SPEED_OPTIONS,
  useRaceStore,
  participantCountFromText,
} from "./stores/raceStore";
import { RaceScene } from "./components/RaceScene";

type RaceIntroPhase = "showcase" | "overview" | "countdown";

interface RaceIntroView {
  phase: RaceIntroPhase;
  racer: RankedFrameRacer | null;
  racerIndex: number;
  racerCount: number;
  label: string;
  subLabel: string;
}

const INTRO_SHOWCASE_SECONDS = 1.5;
const INTRO_OVERVIEW_SECONDS = 0.7;
const INTRO_COUNTDOWN_SECONDS = 0.72;
const INTRO_COUNTDOWN_LABELS = ["3", "2", "1", "출발!"] as const;

export default function App() {
  const {
    participantText,
    passStart,
    passEnd,
    selectedTrackId,
    lapCount,
    groupSize,
    speed,
    selectedRacerId,
    race,
    playbackTime,
    isRunning,
    status,
    isError,
    openPanel,
    setParticipantText,
    setPassRange,
    setTrack,
    setLapCount,
    setGroupSize,
    setSpeed,
    setSelectedRacer,
    setPanel,
    generateSample,
    prepareRace,
    startRace,
    resetRace,
    setPlaybackFromClock,
  } = useRaceStore();
  const shellRef = useRef<HTMLElement | null>(null);
  const focusStateRef = useRef(createEmptyCameraFocus());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [introStartedAt, setIntroStartedAt] = useState<number | null>(null);
  const [introNow, setIntroNow] = useState(0);
  const [controlsCollapsed, setControlsCollapsed] = useState(false);

  useEffect(() => {
    focusStateRef.current = createEmptyCameraFocus(performance.now() / 1000);
  }, [race]);

  useEffect(() => {
    prepareRace();
  }, [prepareRace]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  useEffect(() => {
    if (!isRunning) {
      return undefined;
    }

    let frameId = 0;
    const tick = (now: number) => {
      useRaceStore.getState().setPlaybackFromClock(now);
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [isRunning, setPlaybackFromClock]);

  useEffect(() => {
    if (introStartedAt === null) {
      return undefined;
    }

    let frameId = 0;
    const tick = () => {
      setIntroNow(performance.now() / 1000);
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [introStartedAt]);

  const currentFrame = useMemo(() => {
    return race ? findFrame(race, playbackTime) : null;
  }, [race, playbackTime]);

  const rankedFrame = useMemo<RankedFrameRacer[]>(() => {
    return race && currentFrame ? rankFrame(race, currentFrame) : [];
  }, [race, currentFrame]);

  const raceGroup = useMemo(() => {
    return race ? getRaceGroupInfo(race, playbackTime, groupSize) : null;
  }, [groupSize, race, playbackTime]);

  const groupFrame = useMemo(() => {
    if (!race || !raceGroup) {
      return currentFrame;
    }

    return findFrame(race, raceGroup.localTime);
  }, [currentFrame, race, raceGroup]);

  const groupRankedFrame = useMemo<RankedFrameRacer[]>(() => {
    if (!race || !groupFrame || !raceGroup) {
      return [];
    }

    return rankGroupFrame(race, groupFrame, raceGroup.racerIds);
  }, [groupFrame, race, raceGroup]);
  const introRacers = useMemo(() => {
    return groupRankedFrame.slice().sort((a, b) => a.id - b.id);
  }, [groupRankedFrame]);
  const introView = useMemo(
    () => createRaceIntroView(introStartedAt, introNow, introRacers),
    [introNow, introRacers, introStartedAt],
  );
  const introDurationSeconds = useMemo(
    () => getRaceIntroDurationSeconds(introRacers.length),
    [introRacers.length],
  );

  useEffect(() => {
    if (introStartedAt === null || groupRankedFrame.length === 0) {
      return;
    }

    if (introNow - introStartedAt < introDurationSeconds) {
      return;
    }

    setIntroStartedAt(null);
    startRace(performance.now());
  }, [
    groupRankedFrame.length,
    introDurationSeconds,
    introNow,
    introStartedAt,
    startRace,
  ]);

  const participantCount = participantCountFromText(participantText);
  const playbackDuration = race
    ? getRaceDisplayDurationSeconds(race.participants.length, groupSize)
    : RACE_DURATION_SECONDS;
  const timePercent = Math.min(100, (playbackTime / playbackDuration) * 100);
  const groupTimePercent = raceGroup
    ? Math.min(100, (raceGroup.localTime / RACE_DURATION_SECONDS) * 100)
    : timePercent;
  const scenePlaybackTime = raceGroup?.localTime ?? playbackTime;
  const helicopterStatusCue = useMemo(
    () => getHelicopterStatusCue(race, raceGroup, scenePlaybackTime),
    [race, raceGroup, scenePlaybackTime],
  );
  const panelRankedFrame =
    playbackTime >= playbackDuration ? rankedFrame : groupRankedFrame;
  const track =
    race?.track ??
    TRACK_TYPES.find((candidate) => candidate.id === selectedTrackId) ??
    TRACK_TYPES[0];
  focusStateRef.current = chooseCameraFocus({
    racers: groupRankedFrame,
    selectedRacerId,
    nowSeconds: performance.now() / 1000,
    current: focusStateRef.current,
  });
  const focusRacer = introView
    ? null
    : getFocusedRacer(groupRankedFrame, focusStateRef.current);
  const introRacer = introView?.phase === "showcase" ? introView.racer : null;
  const sceneFocusRacer = introRacer ?? focusRacer;
  const handleRaceStart = () => {
    if (introStartedAt !== null) {
      return;
    }

    if (!useRaceStore.getState().race) {
      prepareRace();
    }

    if (!useRaceStore.getState().race) {
      return;
    }

    const now = performance.now() / 1000;
    setPanel(null);
    setControlsCollapsed(true);
    setIntroNow(now);
    setIntroStartedAt(now);
  };
  const handleResetRace = () => {
    setIntroStartedAt(null);
    setControlsCollapsed(false);
    resetRace();
  };
  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }

    void shellRef.current?.requestFullscreen();
  };

  return (
    <main
      ref={shellRef}
      className={`app-shell${controlsCollapsed ? " is-controls-collapsed" : ""}`}
    >
      <button
        className="controls-toggle"
        type="button"
        onClick={() => setControlsCollapsed((value) => !value)}
        aria-expanded={!controlsCollapsed}
      >
        {controlsCollapsed ? "메뉴" : "접기"}
      </button>
      <header className="top-bar">
        <div className="brand-block">
          <p className="eyebrow">경마 추첨 웹게임</p>
          <h1>달려라 검단호수공원 호반써밋</h1>
        </div>

        <div className="race-toolbar" aria-label="레이스 조작">
          <button type="button" onClick={() => setPanel("settings")}>
            설정
          </button>
          <button type="button" onClick={() => setPanel("results")}>
            결과
          </button>
          <button className="secondary" type="button" onClick={prepareRace}>
            규칙 갱신
          </button>
          <button
            className="primary"
            type="button"
            onClick={handleRaceStart}
            disabled={introStartedAt !== null}
          >
            {introStartedAt === null ? "레이스 시작" : "소개 중"}
          </button>
          <button type="button" onClick={handleResetRace}>
            새 레이스
          </button>
          <button type="button" onClick={() => exportCsv(race)}>
            CSV
          </button>
          <button type="button" onClick={toggleFullscreen}>
            {isFullscreen ? "창모드" : "전체화면"}
          </button>
        </div>

        <p className={`status-line${isError ? " is-error" : ""}`}>{status}</p>
      </header>

      <section className="race-panel" aria-label="레이스 화면">
        <div className="race-header">
          <div>
            <p className="eyebrow">조별 {RACE_DURATION_SECONDS}초 레이스</p>
            <h2>{track.name}</h2>
            <p>
              조별 {formatTime(RACE_DURATION_SECONDS)} 규칙 · 코스 길이{" "}
              {race?.lapCount ?? lapCount}x · 헬기 탈락{" "}
              {race?.summary.helicopterStrikeCount ?? 0}명 · 화면 진행{" "}
              {formatTime(playbackDuration)} · 통과{" "}
              {race?.passRange.start ?? passStart}등-
              {race?.passRange.end ?? passEnd}등
            </p>
            {raceGroup && (
              <div className="group-chip" aria-label="현재 경주 그룹">
                <strong>
                  그룹 {raceGroup.groupIndex + 1}/{raceGroup.groupCount}
                </strong>
                <span>{raceGroup.participantCount}마리 순차 출발</span>
              </div>
            )}
          </div>
          <div className="time-box">
            <span>{formatTime(playbackTime)}</span>
            {raceGroup && (
              <small>
                조 진행 {formatTime(raceGroup.localTime)} ·{" "}
                {Math.round(groupTimePercent)}%
              </small>
            )}
            <div className="time-track">
              <span style={{ width: `${timePercent}%` }} />
            </div>
          </div>
        </div>

        <div className="track-surface" data-terrain={track.terrain}>
          <RaceScene
            race={race}
            racers={groupRankedFrame}
            playbackTime={scenePlaybackTime}
            focusRacer={sceneFocusRacer}
            introPhase={introView?.phase ?? null}
            introRacer={introRacer}
            raceStarted={isRunning && !introView}
          />
          <div className="race-overlay">
            {helicopterStatusCue && (
              <div className="helicopter-cue helicopter-status-cue">
                {helicopterStatusCue}
              </div>
            )}
            <StrikeStrip race={race} />
            {introView && <RaceIntroOverlay intro={introView} />}
            <TrackLeaderList
              racers={groupRankedFrame.slice(0, 5)}
              selectedRacerId={selectedRacerId}
              onSelect={(racerId) =>
                setSelectedRacer(selectedRacerId === racerId ? null : racerId)
              }
            />
            {focusRacer && (
              <FocusBadge
                racer={focusRacer}
                reason={focusStateRef.current.reason}
              />
            )}
          </div>
        </div>
      </section>

      <div
        className={`panel-backdrop${openPanel ? " is-open" : ""}`}
        hidden={!openPanel}
        onClick={() => setPanel(null)}
      />

      <SettingsPanel
        isOpen={openPanel === "settings"}
        participantText={participantText}
        participantCount={participantCount}
        passStart={passStart}
        passEnd={passEnd}
        speed={speed}
        groupSize={groupSize}
        selectedTrackId={selectedTrackId}
        lapCount={lapCount}
        onClose={() => setPanel(null)}
        onParticipantText={setParticipantText}
        onPassRange={setPassRange}
        onSpeed={setSpeed}
        onGroupSize={setGroupSize}
        onTrack={setTrack}
        onLapCount={setLapCount}
        onGenerate={generateSample}
        onApply={() => {
          prepareRace();
          setPanel(null);
        }}
      />

      <ResultsPanel
        isOpen={openPanel === "results"}
        race={race}
        racers={panelRankedFrame}
        onClose={() => setPanel(null)}
      />
    </main>
  );
}

function SettingsPanel({
  isOpen,
  participantText,
  participantCount,
  passStart,
  passEnd,
  speed,
  groupSize,
  selectedTrackId,
  lapCount,
  onClose,
  onParticipantText,
  onPassRange,
  onSpeed,
  onGroupSize,
  onTrack,
  onLapCount,
  onGenerate,
  onApply,
}: {
  isOpen: boolean;
  participantText: string;
  participantCount: number;
  passStart: number;
  passEnd: number;
  speed: number;
  groupSize: number;
  selectedTrackId: TrackId;
  lapCount: number;
  onClose: () => void;
  onParticipantText: (value: string) => void;
  onPassRange: (start: number, end: number) => void;
  onSpeed: (speed: number) => void;
  onGroupSize: (groupSize: number) => void;
  onTrack: (trackId: TrackId) => void;
  onLapCount: (lapCount: number) => void;
  onGenerate: (count: number) => void;
  onApply: () => void;
}) {
  return (
    <section
      className={`control-panel layer-panel settings-layer${isOpen ? " is-open" : ""}`}
      aria-label="설정 패널"
      aria-hidden={!isOpen}
    >
      <div className="layer-head">
        <div>
          <p className="eyebrow">설정</p>
          <h2>참가자와 규칙</h2>
        </div>
        <button
          className="icon-button"
          type="button"
          onClick={onClose}
          aria-label="설정 닫기"
        >
          ×
        </button>
      </div>

      <div className="field-row">
        <label htmlFor="participantInput">참가자</label>
        <span
          className={`count-pill${participantCount > MAX_PARTICIPANTS ? " is-over" : ""}`}
        >
          {participantCount}/{MAX_PARTICIPANTS}
        </span>
      </div>
      <textarea
        id="participantInput"
        spellCheck={false}
        value={participantText}
        onChange={(event) => onParticipantText(event.target.value)}
      />

      <div className="quick-actions" aria-label="참가자 샘플 생성">
        {[10, 80, 180, 800].map((count) => (
          <button key={count} type="button" onClick={() => onGenerate(count)}>
            {count}명
          </button>
        ))}
      </div>

      <div className="field-group">
        <label>트랙</label>
        <div className="track-options">
          {TRACK_TYPES.map((track) => (
            <button
              key={track.id}
              className={`track-option${track.id === selectedTrackId ? " is-active" : ""}`}
              type="button"
              onClick={() => onTrack(track.id)}
            >
              <span>{track.name}</span>
              <small>{track.description}</small>
            </button>
          ))}
        </div>
      </div>

      <div className="field-group">
        <label>코스 길이</label>
        <div className="lap-options">
          {LAP_COUNT_OPTIONS.map((count) => (
            <button
              key={count}
              className={`lap-option${count === lapCount ? " is-active" : ""}`}
              type="button"
              onClick={() => onLapCount(count)}
            >
              {count}x
            </button>
          ))}
        </div>
      </div>

      <div className="range-grid">
        <label>
          <span>통과 시작</span>
          <input
            type="number"
            min="1"
            value={passStart}
            onChange={(event) =>
              onPassRange(Number.parseInt(event.target.value, 10) || 1, passEnd)
            }
          />
        </label>
        <label>
          <span>통과 종료</span>
          <input
            type="number"
            min="1"
            value={passEnd}
            onChange={(event) =>
              onPassRange(
                passStart,
                Number.parseInt(event.target.value, 10) || 1,
              )
            }
          />
        </label>
      </div>

      <div className="field-group">
        <label>그룹당 마리 수</label>
        <div
          className="group-size-options"
          role="group"
          aria-label="그룹당 마리 수"
        >
          {RACE_GROUP_SIZE_OPTIONS.map((option) => (
            <button
              key={option}
              className={`group-size-option${option === groupSize ? " is-active" : ""}`}
              type="button"
              onClick={() => onGroupSize(option)}
            >
              {option}마리
            </button>
          ))}
        </div>
      </div>

      <div className="field-group">
        <label>재생 속도</label>
        <div className="speed-options" role="group" aria-label="재생 속도">
          {PLAYBACK_SPEED_OPTIONS.map((option) => (
            <button
              key={option}
              className={`speed-option${option === speed ? " is-active" : ""}`}
              type="button"
              onClick={() => onSpeed(option)}
            >
              {option}x
            </button>
          ))}
        </div>
      </div>

      <div className="drawer-actions">
        <button className="secondary" type="button" onClick={onClose}>
          닫기
        </button>
        <button className="primary" type="button" onClick={onApply}>
          규칙 갱신
        </button>
      </div>
    </section>
  );
}

function ResultsPanel({
  isOpen,
  race,
  racers,
  onClose,
}: {
  isOpen: boolean;
  race: RaceResult | null;
  racers: RankedFrameRacer[];
  onClose: () => void;
}) {
  return (
    <aside
      className={`result-panel layer-panel result-layer${isOpen ? " is-open" : ""}`}
      aria-label="결과 패널"
      aria-hidden={!isOpen}
    >
      <div className="layer-head">
        <div>
          <p className="eyebrow">결과</p>
          <h2>순위와 통과자</h2>
        </div>
        <button
          className="icon-button"
          type="button"
          onClick={onClose}
          aria-label="결과 닫기"
        >
          ×
        </button>
      </div>

      <div className="stats-grid">
        <Stat label="참가" value={race?.summary.participantCount ?? 0} />
        <Stat label="통과" value={race?.summary.passCount ?? 0} />
        <Stat label="스킬" value={race?.summary.skillTriggeredCount ?? 0} />
        <Stat label="탈락" value={race?.summary.helicopterStrikeCount ?? 0} />
      </div>

      <section className="rank-section">
        <h2>실시간 순위</h2>
        <ol className="live-rank">
          {racers.slice(0, 10).map((racer) => (
            <RankListItem key={racer.id} racer={racer} />
          ))}
        </ol>
      </section>

      <section className="rank-section">
        <h2>통과자</h2>
        <ol className="passers-list">
          {race?.passers.slice(0, 220).map((racer) => {
            const color = colorForRacer(racer.id);
            return (
              <li
                key={racer.id}
                style={
                  {
                    "--runner-color": color.base,
                    "--runner-ink": color.ink,
                  } as CSSProperties
                }
              >
                <strong>{racer.rank}등</strong>
                <span>{racer.name}</span>
              </li>
            );
          })}
          {race && race.passers.length > 220 && (
            <li className="list-more">외 {race.passers.length - 220}명</li>
          )}
        </ol>
      </section>

      <section className="rank-section table-section">
        <h2>최종 상위 40</h2>
        <table>
          <thead>
            <tr>
              <th>순위</th>
              <th>이름</th>
              <th>거리</th>
              <th>상태</th>
              <th>스킬</th>
            </tr>
          </thead>
          <tbody>
            {race?.ranking.slice(0, 40).map((racer) => {
              const color = colorForRacer(racer.id);
              return (
                <tr
                  key={racer.id}
                  className={racer.passed ? "is-passed" : ""}
                  style={
                    {
                      "--runner-color": color.base,
                      "--runner-ink": color.ink,
                    } as CSSProperties
                  }
                >
                  <td>{racer.rank}</td>
                  <td>{racer.name}</td>
                  <td>{racer.distance.toLocaleString("ko-KR")}m</td>
                  <td>{racer.eliminated ? "탈락" : "주행"}</td>
                  <td>{racer.skillTriggered ? "발동" : "-"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </aside>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>
        {typeof value === "number" ? value.toLocaleString("ko-KR") : value}
      </strong>
    </div>
  );
}

function StrikeStrip({ race }: { race: RaceResult | null }) {
  if (!race || race.helicopterStrikeEvents.length === 0) {
    return null;
  }

  return (
    <div className="obstacle-strip strike-strip" aria-label="헬기 탈락 지점">
      {race.helicopterStrikeEvents.map((event) => {
        const left = (event.time / RACE_DURATION_SECONDS) * 100;
        return (
          <span
            key={event.id}
            className="obstacle-marker strike-marker"
            style={{ left: `${left}%` }}
            title={`${event.id}. 헬기 사냥 지점`}
          />
        );
      })}
    </div>
  );
}

function TrackLeaderList({
  racers,
  selectedRacerId,
  onSelect,
}: {
  racers: RankedFrameRacer[];
  selectedRacerId: number | null;
  onSelect: (racerId: number) => void;
}) {
  return (
    <ol className="track-leader-list" aria-label="줌인 대상 선택">
      {racers.map((racer) => (
        <RankListItem
          key={racer.id}
          racer={racer}
          isSelected={racer.id === selectedRacerId}
          onSelect={onSelect}
        />
      ))}
    </ol>
  );
}

function RankListItem({
  racer,
  isSelected = false,
  onSelect,
}: {
  racer: RankedFrameRacer;
  isSelected?: boolean;
  onSelect?: (racerId: number) => void;
}) {
  const color = colorForRacer(racer.id);
  const stateText = racer.eliminated
    ? "탈락"
    : racer.skillActive
      ? "스킬"
      : racer.slowed
        ? "감속"
        : `${Math.round(racer.position)}m`;

  return (
    <li
      className={isSelected ? "is-selected" : ""}
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onClick={() => onSelect?.(racer.id)}
      onKeyDown={(event) => {
        if (!onSelect) {
          return;
        }

        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(racer.id);
        }
      }}
      style={
        {
          "--runner-color": color.base,
          "--runner-ink": color.ink,
        } as CSSProperties
      }
    >
      <strong>{racer.rank}</strong>
      <span>{racer.name}</span>
      <em>{isSelected ? "선택" : stateText}</em>
    </li>
  );
}

function FocusBadge({
  racer,
  reason,
}: {
  racer: RankedFrameRacer;
  reason: FocusReason | null;
}) {
  const label = racer.eliminated
    ? "헬기 탈락"
    : reason === "selected"
      ? "사용자 선택 줌인"
      : reason === "skill"
        ? "부스터 줌인"
        : "집중";
  const color = colorForRacer(racer.id);

  return (
    <div
      className="focus-badge"
      style={
        {
          "--runner-color": color.base,
          "--runner-ink": color.ink,
        } as CSSProperties
      }
    >
      <strong>{label}</strong>
      <span>
        {racer.rank}위 · {racer.name}
      </span>
    </div>
  );
}

function RaceIntroOverlay({ intro }: { intro: RaceIntroView }) {
  const isCountdown = intro.phase === "countdown";

  return (
    <div
      className={`race-intro-overlay is-${intro.phase}`}
      aria-label="레이스 시작 연출"
    >
      <strong>{intro.label}</strong>
      <span>{intro.subLabel}</span>
      {!isCountdown && (
        <small>
          {intro.racerIndex + 1}/{intro.racerCount}
        </small>
      )}
    </div>
  );
}

interface RaceGroupInfo {
  groupIndex: number;
  groupCount: number;
  localTime: number;
  racerIds: Set<number>;
  participantCount: number;
}

function getRaceGroupInfo(
  race: RaceResult,
  playbackTime: number,
  groupSize: number,
): RaceGroupInfo {
  const groupCount = getRaceGroupCount(race.participants.length, groupSize);
  const playbackDuration = getRaceDisplayDurationSeconds(
    race.participants.length,
    groupSize,
  );
  const safePlaybackTime = Math.min(
    playbackDuration,
    Math.max(0, playbackTime),
  );
  const groupIndex = Math.min(
    groupCount - 1,
    Math.floor(safePlaybackTime / RACE_GROUP_STAGE_SECONDS),
  );
  const groupStart = groupIndex * groupSize;
  const groupParticipants = race.participants.slice(
    groupStart,
    groupStart + groupSize,
  );
  const elapsedInGroup = Math.min(
    RACE_GROUP_STAGE_SECONDS,
    Math.max(0, safePlaybackTime - groupIndex * RACE_GROUP_STAGE_SECONDS),
  );
  const localTime = Math.min(
    RACE_DURATION_SECONDS,
    (elapsedInGroup / RACE_GROUP_STAGE_SECONDS) * RACE_DURATION_SECONDS,
  );

  return {
    groupIndex,
    groupCount,
    localTime,
    racerIds: new Set(groupParticipants.map((participant) => participant.id)),
    participantCount: groupParticipants.length,
  };
}

function getHelicopterStatusCue(
  race: RaceResult | null,
  raceGroup: RaceGroupInfo | null,
  localTime: number,
): string | null {
  if (!race || !raceGroup) {
    return null;
  }

  const groupEvents = race.helicopterStrikeEvents
    .filter((event) => raceGroup.racerIds.has(event.targetId))
    .sort((a, b) => a.time - b.time || a.impactTime - b.impactTime);
  const currentEvent = groupEvents.find(
    (event) => localTime >= event.time && localTime <= event.impactTime,
  );

  if (currentEvent) {
    const secondsToImpact = currentEvent.impactTime - localTime;

    if (secondsToImpact > 16) {
      return "헬기 접근 · 누굴 맞출까?";
    }

    if (secondsToImpact > 7) {
      return "저격수 조준 · 누굴 맞출까?";
    }

    return "총격 임박 · 누굴 맞출까?";
  }

  const latestEvent = groupEvents
    .slice()
    .reverse()
    .find((event) => localTime > event.impactTime);

  return latestEvent ? `${latestEvent.targetName} 탈락!` : null;
}

function rankGroupFrame(
  race: RaceResult,
  frame: ReturnType<typeof findFrame>,
  racerIds: Set<number>,
): RankedFrameRacer[] {
  return rankFrame(race, frame)
    .filter((racer) => racerIds.has(racer.id))
    .map((racer, index) => ({
      ...racer,
      rank: index + 1,
    }));
}

function createRaceIntroView(
  startedAt: number | null,
  now: number,
  racers: RankedFrameRacer[],
): RaceIntroView | null {
  if (startedAt === null || racers.length === 0) {
    return null;
  }

  const elapsed = Math.max(0, now - startedAt);
  const showcaseDuration = racers.length * INTRO_SHOWCASE_SECONDS;

  if (elapsed < showcaseDuration) {
    const racerIndex = Math.min(
      racers.length - 1,
      Math.floor(elapsed / INTRO_SHOWCASE_SECONDS),
    );
    const racer = racers[racerIndex];

    return {
      phase: "showcase",
      racer,
      racerIndex,
      racerCount: racers.length,
      label: "게임준비!",
      subLabel: `${racer.id}번 게이트 · ${racer.name}`,
    };
  }

  const elapsedAfterShowcase = elapsed - showcaseDuration;

  if (elapsedAfterShowcase < INTRO_OVERVIEW_SECONDS) {
    return {
      phase: "overview",
      racer: null,
      racerIndex: racers.length - 1,
      racerCount: racers.length,
      label: "전체 시점",
      subLabel: "출발선 정렬 완료",
    };
  }

  const countdownElapsed = elapsedAfterShowcase - INTRO_OVERVIEW_SECONDS;
  const countdownIndex = Math.min(
    INTRO_COUNTDOWN_LABELS.length - 1,
    Math.floor(countdownElapsed / INTRO_COUNTDOWN_SECONDS),
  );
  const label = INTRO_COUNTDOWN_LABELS[countdownIndex];

  return {
    phase: "countdown",
    racer: null,
    racerIndex: racers.length - 1,
    racerCount: racers.length,
    label,
    subLabel: label === "출발!" ? "레이스 시작" : "곧 출발",
  };
}

function getRaceIntroDurationSeconds(racerCount: number): number {
  if (racerCount < 1) {
    return 0;
  }

  return (
    racerCount * INTRO_SHOWCASE_SECONDS +
    INTRO_OVERVIEW_SECONDS +
    INTRO_COUNTDOWN_LABELS.length * INTRO_COUNTDOWN_SECONDS
  );
}

function formatTime(time: number): string {
  return `${time.toFixed(time % 1 === 0 ? 0 : 1)}초`;
}

function exportCsv(race: RaceResult | null): void {
  if (!race) {
    return;
  }

  const blob = new Blob([toRankingCsv(race.ranking)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "run-hoban-run-ranking.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}
