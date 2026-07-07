import './center-toast.css';

/** 모든 게임 공용: 화면 중앙 상단에 잠깐 떠오르는 토스트 알림.
 *  텍스트뿐 아니라 HTML(예: 윷가락 이미지)도 담을 수 있고, 같은 호출이 이전 토스트를 대체한다. */

let host: HTMLElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let removeTimer: ReturnType<typeof setTimeout> | null = null;

function ensureHost(): HTMLElement {
  if (host && host.isConnected) return host;
  host = document.createElement('div');
  host.className = 'center-toast-host';
  host.setAttribute('aria-live', 'polite');
  document.body.appendChild(host);
  return host;
}

export interface CenterToastOptions {
  /** 스타일 변형: info(기본)/throw/capture/correct/wrong/warn 등. */
  kind?: string;
  /** content를 HTML로 삽입할지. 기본 false(텍스트). HTML을 넣을 땐 신뢰 가능한 마크업만. */
  html?: boolean;
  /** 표시 시간(ms). 0 이하면 자동으로 사라지지 않는다(다음 호출로 대체될 때까지 유지). */
  duration?: number;
}

/** 화면 중앙 토스트를 띄운다. 이전 토스트가 있으면 즉시 대체한다. */
export function showCenterToast(content: string, opts: CenterToastOptions = {}): void {
  const h = ensureHost();
  const { kind = 'info', html = false, duration = 2200 } = opts;

  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  if (removeTimer) { clearTimeout(removeTimer); removeTimer = null; }

  const el = document.createElement('div');
  el.className = `center-toast ${kind}`;
  if (html) el.innerHTML = content;
  else el.textContent = content;

  h.replaceChildren(el);
  // 진입 트랜지션을 위해 리플로우를 한 번 강제한 뒤 show를 붙인다.
  void el.offsetWidth;
  el.classList.add('show');

  if (duration > 0) {
    hideTimer = setTimeout(() => {
      el.classList.remove('show');
      el.classList.add('leaving');
      removeTimer = setTimeout(() => {
        if (el.parentElement === h) h.removeChild(el);
      }, 240);
    }, duration);
  }
}

/** 현재 떠 있는 중앙 토스트를 즉시 지운다. */
export function clearCenterToast(): void {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  if (removeTimer) { clearTimeout(removeTimer); removeTimer = null; }
  if (host) host.replaceChildren();
}
