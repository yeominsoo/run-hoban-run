import {
  MAX_PARTICIPANTS,
  RACE_DURATION_SECONDS,
  TRACK_TYPES,
  createSampleParticipants,
  createSeed,
  simulateRace,
  toRankingCsv
} from "./raceEngine.js";

const RACER_COLORS = [
  { base: "#f05d5e", dark: "#8f2528", ink: "#ffffff" },
  { base: "#2b9eb3", dark: "#11515d", ink: "#ffffff" },
  { base: "#f4b63f", dark: "#7a4c06", ink: "#21180a" },
  { base: "#7c5cff", dark: "#34208f", ink: "#ffffff" },
  { base: "#2fbf71", dark: "#14633a", ink: "#ffffff" },
  { base: "#ff7f50", dark: "#8e361d", ink: "#ffffff" },
  { base: "#3f88c5", dark: "#1b4a73", ink: "#ffffff" },
  { base: "#d45087", dark: "#76284b", ink: "#ffffff" },
  { base: "#6a994e", dark: "#395a29", ink: "#ffffff" },
  { base: "#f77f00", dark: "#7c4000", ink: "#21180a" },
  { base: "#00a896", dark: "#04584f", ink: "#ffffff" },
  { base: "#9b5de5", dark: "#4d2484", ink: "#ffffff" },
  { base: "#ef476f", dark: "#84213a", ink: "#ffffff" },
  { base: "#118ab2", dark: "#08455a", ink: "#ffffff" },
  { base: "#8ac926", dark: "#42630d", ink: "#172000" },
  { base: "#ffca3a", dark: "#80620c", ink: "#21180a" },
  { base: "#1982c4", dark: "#0d4366", ink: "#ffffff" },
  { base: "#6f4e37", dark: "#332014", ink: "#ffffff" }
];

const state = {
  race: null,
  selectedTrackId: TRACK_TYPES[0].id,
  animationFrame: null,
  startedAt: null,
  playbackTime: 0,
  lastPaint: 0
};

const elements = {
  settingsButton: document.querySelector("#settingsButton"),
  resultButton: document.querySelector("#resultButton"),
  panelBackdrop: document.querySelector("#panelBackdrop"),
  settingsPanel: document.querySelector("#settingsPanel"),
  resultPanel: document.querySelector("#resultPanel"),
  closePanelButtons: document.querySelectorAll("[data-close-panel]"),
  applySettingsButtons: document.querySelectorAll("[data-apply-settings]"),
  participantInput: document.querySelector("#participantInput"),
  participantCount: document.querySelector("#participantCount"),
  passStart: document.querySelector("#passStart"),
  passEnd: document.querySelector("#passEnd"),
  seedInput: document.querySelector("#seedInput"),
  speedInput: document.querySelector("#speedInput"),
  speedValue: document.querySelector("#speedValue"),
  trackOptions: document.querySelector("#trackOptions"),
  generateButtons: document.querySelectorAll("[data-generate]"),
  prepareButton: document.querySelector("#prepareButton"),
  startButton: document.querySelector("#startButton"),
  resetButton: document.querySelector("#resetButton"),
  csvButton: document.querySelector("#csvButton"),
  statusLine: document.querySelector("#statusLine"),
  timeValue: document.querySelector("#timeValue"),
  timeBar: document.querySelector("#timeBar"),
  trackName: document.querySelector("#trackName"),
  trackMeta: document.querySelector("#trackMeta"),
  trackSurface: document.querySelector("#trackSurface"),
  lanes: document.querySelector("#lanes"),
  liveRank: document.querySelector("#liveRank"),
  obstacleStrip: document.querySelector("#obstacleStrip"),
  statParticipants: document.querySelector("#statParticipants"),
  statPassers: document.querySelector("#statPassers"),
  statSkills: document.querySelector("#statSkills"),
  statObstacles: document.querySelector("#statObstacles"),
  passersList: document.querySelector("#passersList"),
  finalRank: document.querySelector("#finalRank")
};

boot();

function boot() {
  renderTrackOptions();
  elements.participantInput.value = createSampleParticipants(180).join("\n");
  elements.passStart.value = 55;
  elements.passEnd.value = 155;
  elements.seedInput.value = createSeed();
  updateParticipantCount();
  bindEvents();
  prepareRace();
}

function bindEvents() {
  elements.participantInput.addEventListener("input", updateParticipantCount);
  elements.speedInput.addEventListener("input", () => {
    elements.speedValue.textContent = `${elements.speedInput.value}x`;
  });

  elements.generateButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const count = Number.parseInt(button.dataset.generate, 10);
      elements.participantInput.value = createSampleParticipants(count).join("\n");
      const endRank = Math.min(count, Math.max(1, Number.parseInt(elements.passEnd.value, 10) || 1));
      elements.passStart.value = Math.min(endRank, Number.parseInt(elements.passStart.value, 10) || 1);
      elements.passEnd.value = endRank;
      updateParticipantCount();
      prepareRace();
    });
  });

  elements.prepareButton.addEventListener("click", prepareRace);
  elements.startButton.addEventListener("click", startRace);
  elements.resetButton.addEventListener("click", resetRace);
  elements.csvButton.addEventListener("click", exportCsv);
  elements.settingsButton.addEventListener("click", () => openPanel(elements.settingsPanel));
  elements.resultButton.addEventListener("click", () => openPanel(elements.resultPanel));
  elements.panelBackdrop.addEventListener("click", closePanels);
  elements.closePanelButtons.forEach((button) => {
    button.addEventListener("click", closePanels);
  });
  elements.applySettingsButtons.forEach((button) => {
    button.addEventListener("click", () => {
      prepareRace();
      closePanels();
    });
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closePanels();
    }
  });
}

function renderTrackOptions() {
  elements.trackOptions.innerHTML = TRACK_TYPES.map((track) => {
    return `
      <button class="track-option${track.id === state.selectedTrackId ? " is-active" : ""}" type="button" data-track="${track.id}">
        <span>${track.name}</span>
        <small>${track.description}</small>
      </button>
    `;
  }).join("");

  elements.trackOptions.querySelectorAll("[data-track]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedTrackId = button.dataset.track;
      renderTrackOptions();
      prepareRace();
    });
  });
}

function updateParticipantCount() {
  const count = readParticipantNames().length;
  elements.participantCount.textContent = `${count}/${MAX_PARTICIPANTS}`;
  elements.participantCount.classList.toggle("is-over", count > MAX_PARTICIPANTS);
}

function prepareRace() {
  stopAnimation();

  try {
    const seed = elements.seedInput.value.trim() || createSeed();
    elements.seedInput.value = seed;
    state.race = simulateRace({
      participantNames: readParticipantNames(),
      trackId: state.selectedTrackId,
      passStart: elements.passStart.value,
      passEnd: elements.passEnd.value,
      seed
    });
    state.playbackTime = 0;
    elements.trackSurface.dataset.terrain = state.race.track.terrain;
    renderStaticRace();
    renderFrame(state.race.frames[0], true);
    setStatus("레이스 준비 완료");
  } catch (error) {
    state.race = null;
    setStatus(error.message, true);
  }
}

function startRace() {
  if (!state.race) {
    prepareRace();
  }

  if (!state.race) {
    return;
  }

  stopAnimation();
  state.startedAt = performance.now() - (state.playbackTime * 1000) / getPlaybackSpeed();
  setStatus("레이스 진행 중");
  tick();
}

function resetRace() {
  stopAnimation();
  elements.seedInput.value = createSeed();
  prepareRace();
}

function tick(now = performance.now()) {
  const elapsed = ((now - state.startedAt) / 1000) * getPlaybackSpeed();
  state.playbackTime = Math.min(RACE_DURATION_SECONDS, elapsed);

  if (now - state.lastPaint > 80 || state.playbackTime >= RACE_DURATION_SECONDS) {
    state.lastPaint = now;
    renderFrame(findFrame(state.playbackTime));
  }

  if (state.playbackTime < RACE_DURATION_SECONDS) {
    state.animationFrame = requestAnimationFrame(tick);
    return;
  }

  stopAnimation();
  renderFinalResults();
  openPanel(elements.resultPanel);
  setStatus("레이스 종료");
}

function stopAnimation() {
  if (state.animationFrame) {
    cancelAnimationFrame(state.animationFrame);
    state.animationFrame = null;
  }
}

function renderStaticRace() {
  const race = state.race;
  elements.trackName.textContent = race.track.name;
  elements.trackMeta.textContent = `60초 · 장애물 ${race.obstacleCount}회 · 통과 ${race.passRange.start}등-${race.passRange.end}등`;
  elements.statParticipants.textContent = race.summary.participantCount.toLocaleString("ko-KR");
  elements.statPassers.textContent = race.summary.passCount.toLocaleString("ko-KR");
  elements.statSkills.textContent = race.summary.skillTriggeredCount.toLocaleString("ko-KR");
  elements.statObstacles.textContent = `${race.summary.obstaclePassCount.toLocaleString("ko-KR")} / ${race.summary.obstacleFailCount.toLocaleString("ko-KR")}`;
  elements.obstacleStrip.innerHTML = race.obstacleEvents.map((event) => {
    const left = (event.time / RACE_DURATION_SECONDS) * 100;
    return `<span class="obstacle-marker" style="left: ${left}%" title="${event.id}. ${event.name}"></span>`;
  }).join("");
  elements.passersList.innerHTML = "";
  elements.finalRank.innerHTML = "";
}

function renderFrame(frame, immediate = false) {
  if (!state.race || !frame) {
    return;
  }

  const timePercent = (frame.time / RACE_DURATION_SECONDS) * 100;
  elements.timeValue.textContent = `${frame.time.toFixed(frame.time % 1 === 0 ? 0 : 1)}초`;
  elements.timeBar.style.width = `${timePercent}%`;

  const rankedFrame = rankFrame(frame);
  renderLanes(rankedFrame.slice(0, 18), immediate);
  renderLiveRank(rankedFrame.slice(0, 10));
  highlightCurrentObstacle(frame.time);
}

function renderLanes(racers, immediate) {
  elements.lanes.innerHTML = racers.map((racer) => {
    const status = racer.skillActive ? "skill" : racer.slowed ? "slow" : "run";
    const colorStyle = styleForRacer(racer.id);
    return `
      <div class="lane-row" data-status="${status}" style="${colorStyle}">
        <div class="lane-label">
          <strong>${racer.rank}</strong>
          <span>${escapeHtml(racer.name)}</span>
        </div>
        <div class="lane-line">
          <div class="runner ${status}${immediate ? " no-motion" : ""}" style="left: ${racer.progress}%">
            <span class="runner-name">${escapeHtml(racer.name)}</span>
            <span class="runner-icon" aria-hidden="true"></span>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

function renderLiveRank(racers) {
  elements.liveRank.innerHTML = racers.map((racer) => {
    return `
      <li style="${styleForRacer(racer.id)}">
        <strong>${racer.rank}</strong>
        <span>${escapeHtml(racer.name)}</span>
        <em>${Math.round(racer.position)}m</em>
      </li>
    `;
  }).join("");
}

function renderFinalResults() {
  const race = state.race;
  const passersToShow = race.passers.slice(0, 220);
  const hasMorePassers = race.passers.length > passersToShow.length;

  elements.passersList.innerHTML = passersToShow.map((racer) => {
    return `
      <li style="${styleForRacer(racer.id)}">
        <strong>${racer.rank}등</strong>
        <span>${escapeHtml(racer.name)}</span>
      </li>
    `;
  }).join("") + (hasMorePassers ? `<li class="list-more">외 ${race.passers.length - passersToShow.length}명</li>` : "");

  elements.finalRank.innerHTML = race.ranking.slice(0, 40).map((racer) => {
    return `
      <tr class="${racer.passed ? "is-passed" : ""}" style="${styleForRacer(racer.id)}">
        <td>${racer.rank}</td>
        <td>${escapeHtml(racer.name)}</td>
        <td>${racer.distance.toLocaleString("ko-KR")}m</td>
        <td>${racer.obstaclePasses}/${racer.obstacleFails}</td>
        <td>${racer.skillTriggered ? "발동" : "-"}</td>
      </tr>
    `;
  }).join("");
}

function highlightCurrentObstacle(time) {
  const markers = elements.obstacleStrip.querySelectorAll(".obstacle-marker");
  state.race.obstacleEvents.forEach((event, index) => {
    const marker = markers[index];
    marker.classList.toggle("is-done", event.time <= time);
    marker.classList.toggle("is-hot", Math.abs(event.time - time) <= 0.6);
  });
}

function rankFrame(frame) {
  const racerById = new Map(state.race.participants.map((racer) => [racer.id, racer]));
  return frame.racers
    .map((racer) => ({
      ...racer,
      name: racerById.get(racer.id).name
    }))
    .sort((a, b) => b.position - a.position || a.id - b.id)
    .map((racer, index) => ({
      ...racer,
      rank: index + 1
    }));
}

function findFrame(time) {
  const index = Math.min(
    state.race.frames.length - 1,
    Math.max(0, Math.round(time / 0.5))
  );

  return state.race.frames[index];
}

function exportCsv() {
  if (!state.race) {
    return;
  }

  const blob = new Blob([toRankingCsv(state.race.ranking)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "run-hoban-run-ranking.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

function openPanel(panel) {
  [elements.settingsPanel, elements.resultPanel].forEach((candidate) => {
    const isOpen = candidate === panel;
    candidate.classList.toggle("is-open", isOpen);
    candidate.setAttribute("aria-hidden", String(!isOpen));
  });
  elements.panelBackdrop.hidden = false;
  elements.panelBackdrop.classList.add("is-open");
}

function closePanels() {
  [elements.settingsPanel, elements.resultPanel].forEach((panel) => {
    panel.classList.remove("is-open");
    panel.setAttribute("aria-hidden", "true");
  });
  elements.panelBackdrop.classList.remove("is-open");
  elements.panelBackdrop.hidden = true;
}

function getPlaybackSpeed() {
  return Number.parseFloat(elements.speedInput.value) || 1;
}

function readParticipantNames() {
  return elements.participantInput.value
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean);
}

function setStatus(message, isError = false) {
  elements.statusLine.textContent = message;
  elements.statusLine.classList.toggle("is-error", isError);
}

function styleForRacer(id) {
  const color = RACER_COLORS[(id - 1) % RACER_COLORS.length];
  return `--runner-color: ${color.base}; --runner-dark: ${color.dark}; --runner-ink: ${color.ink};`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
