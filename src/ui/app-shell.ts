export function renderAppShell(app: HTMLElement) {
  app.innerHTML = `
    <main class="shell">
      <section class="race-stage" id="race-stage">
        <canvas id="race-canvas"></canvas>
        <div class="hud hud-top">
          <div class="title-block">
            <p class="eyebrow" id="race-meta">룰 기반 3D 경주</p>
            <h1>말발광 레이스</h1>
          </div>
          <div class="top-actions">
            <a class="icon-button" href="/" aria-label="게임 선택" title="게임 선택">
              <span aria-hidden="true">⌂</span>
            </a>
            <button class="icon-button" id="toggle-panels" type="button" aria-label="패널 열고 닫기">
              <span aria-hidden="true">☰</span>
            </button>
            <button class="icon-button" id="toggle-fullscreen" type="button" aria-label="전체화면" aria-pressed="false" title="전체화면">
              <svg aria-hidden="true" class="icon-svg" viewBox="0 0 24 24" focusable="false">
                <path d="M8.2 4.8H4.8v3.4" />
                <path d="M15.8 4.8h3.4v3.4" />
                <path d="M19.2 15.8v3.4h-3.4" />
                <path d="M4.8 15.8v3.4h3.4" />
                <path d="M9.2 4.8 4.8 9.2" />
                <path d="m14.8 4.8 4.4 4.4" />
                <path d="m19.2 14.8-4.4 4.4" />
                <path d="m4.8 14.8 4.4 4.4" />
              </svg>
            </button>
            <button class="icon-button" id="toggle-recording" type="button" aria-label="MP4 영상 캡처" aria-pressed="false" title="MP4 영상 캡처">
              <svg aria-hidden="true" class="icon-svg" viewBox="0 0 24 24" focusable="false">
                <path d="M4.5 7.5A2.5 2.5 0 0 1 7 5h6.2a2.5 2.5 0 0 1 2.5 2.5v9A2.5 2.5 0 0 1 13.2 19H7a2.5 2.5 0 0 1-2.5-2.5v-9Z" />
                <path d="m15.7 10 3.8-2.2v8.4L15.7 14v-4Z" />
                <circle class="record-dot" cx="10.1" cy="12" r="2.15" />
              </svg>
            </button>
            <button class="icon-button" id="download-result-shot" type="button" aria-label="결과 스크린샷 다운로드" title="결과 스크린샷 다운로드">
              <svg aria-hidden="true" class="icon-svg" viewBox="0 0 24 24" focusable="false">
                <path d="M4.5 8.8A2.3 2.3 0 0 1 6.8 6.5h2.4l1.3-1.7h3l1.3 1.7h2.4a2.3 2.3 0 0 1 2.3 2.3v7.9a2.3 2.3 0 0 1-2.3 2.3H6.8a2.3 2.3 0 0 1-2.3-2.3V8.8Z" />
                <circle cx="12" cy="12.7" r="3.15" />
                <path d="M7.4 9.2h1.2" />
              </svg>
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
              <button id="sample-20" type="button">20</button>
              <button id="sample-64" type="button">64</button>
              <button id="start-tournament" type="button">시작</button>
            </div>
          </div>

          <div class="panel-section option-panel">
            <div class="seed-control option-group">
              <input id="seed-input" type="hidden" value="toris-2026" />
              <button id="random-seed" type="button">순서변경</button>
            </div>
            <div class="option-group">
              <div class="option-group-title">진행 방식</div>
              <div class="option-grid">
                <label>
                  <span>출전</span>
                  <input id="field-size" type="number" min="2" max="20" value="20" />
                </label>
                <label>
                  <span>진출</span>
                  <input id="qualifiers" type="number" min="1" max="19" value="2" />
                </label>
                <label>
                  <span>우승</span>
                  <input id="winner-count" type="number" min="1" max="20" value="1" />
                </label>
              </div>
            </div>
          </div>
        </aside>

        <aside class="race-panel">
          <div class="panel-section">
            <div class="section-title" id="race-title">경기</div>
            <div id="race-summary" class="race-summary"></div>
          </div>
        </aside>

        <div class="hud hud-bottom" aria-label="현재 순위">
          <div class="hud-heading">현재 순위</div>
          <ol id="leaderboard" class="leaderboard"></ol>
        </div>

        <div class="winner-banner" id="winner-banner" aria-live="polite" aria-hidden="true">
          <div class="winner-burst" aria-hidden="true">
            <span></span><span></span><span></span><span></span><span></span><span></span>
            <span></span><span></span><span></span><span></span><span></span><span></span>
          </div>
          <div class="winner-banner-content">
            <span class="winner-kicker">최종 우승</span>
            <strong id="winner-name">-</strong>
            <small id="winner-detail"></small>
          </div>
        </div>

        <div class="race-minimap" id="race-minimap" aria-label="경주 진행도">
          <div class="minimap-track">
            <span class="minimap-start" aria-hidden="true"></span>
            <span class="minimap-finish" aria-hidden="true"></span>
            <div id="minimap-dots" class="minimap-dots"></div>
          </div>
        </div>
      </section>
    </main>
  `;
}

export function query<T extends Element>(selector: string) {
  const element = document.querySelector<T>(selector);

  if (!element) {
    throw new Error(`화면 요소를 찾을 수 없습니다: ${selector}`);
  }

  return element;
}
