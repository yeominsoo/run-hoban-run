import QRCode from 'qrcode';
import './room-invite.css';

export const ROOM_SHARE_RETURN_EVENT = 'run-hoban-run:room-share-return';

type ShareOptions = {
  url: string;
  title: string;
  text: string;
  btn: HTMLButtonElement;
};

async function copyUrl(url: string, btn: HTMLButtonElement) {
  try {
    await navigator.clipboard.writeText(url);
    const original = btn.textContent ?? '링크 복사';
    btn.textContent = '복사됨!';
    setTimeout(() => { btn.textContent = original; }, 1500);
  } catch {
    window.prompt('아래 링크를 복사해서 공유하세요', url);
  }
}

async function shareViaSystem(opts: ShareOptions) {
  const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
  if (!nav.share) {
    await copyUrl(opts.url, opts.btn);
    return;
  }

  let leftPage = false;
  const trackVisibility = () => {
    if (document.visibilityState === 'hidden') leftPage = true;
  };
  document.addEventListener('visibilitychange', trackVisibility);

  try {
    await nav.share({ title: opts.title, text: opts.text, url: opts.url });
  } catch (error) {
    if ((error as Error)?.name !== 'AbortError') await copyUrl(opts.url, opts.btn);
  } finally {
    document.removeEventListener('visibilitychange', trackVisibility);
    if (leftPage) window.dispatchEvent(new Event(ROOM_SHARE_RETURN_EVENT));
  }
}

function roomCodeFromUrl(url: string) {
  try {
    return new URL(url, location.href).searchParams.get('room')?.toUpperCase() ?? '';
  } catch {
    return '';
  }
}

/** 초대 URL에서는 방 코드 입력 단계를 숨기고 닉네임 확인으로 곧장 이어준다. */
export function prepareRoomInviteEntry(
  roomCodeInput: HTMLInputElement,
  joinButton: HTMLButtonElement,
  rawRoomCode: string,
) {
  const roomCode = rawRoomCode.trim().toUpperCase().slice(0, 6);
  roomCodeInput.value = roomCode;
  roomCodeInput.classList.add('hidden');
  roomCodeInput.labels?.forEach((label) => label.classList.add('hidden'));

  const note = document.createElement('p');
  note.className = 'room-invite-entry-note';
  note.textContent = `초대받은 방 ${roomCode}`;
  joinButton.before(note);
  joinButton.textContent = '닉네임 확인 후 참가하기';

  const section = roomCodeInput.closest<HTMLElement>('.entry-section');
  const nicknameInput = section?.querySelector<HTMLInputElement>('input:not(.room-code-input)');
  nicknameInput?.focus();
}

/** QR·시스템 공유·링크 복사를 한 화면에서 제공한다. */
export async function shareRoomLink(opts: ShareOptions) {
  document.querySelector('.room-invite-backdrop')?.remove();

  const backdrop = document.createElement('div');
  backdrop.className = 'room-invite-backdrop';
  backdrop.innerHTML = `
    <section class="room-invite-dialog" role="dialog" aria-modal="true" aria-labelledby="room-invite-title">
      <h2 class="room-invite-title" id="room-invite-title">QR로 바로 초대</h2>
      <p class="room-invite-description">휴대폰 카메라로 스캔하면 방 코드가 자동 입력됩니다.</p>
      <div class="room-invite-qr-frame">
        <canvas class="room-invite-qr" aria-label="방 초대 QR 코드"></canvas>
      </div>
      <strong class="room-invite-code"></strong>
      <div class="room-invite-actions">
        <button type="button" class="room-invite-action primary" data-action="share">다른 앱으로 공유</button>
        <button type="button" class="room-invite-action" data-action="copy">링크 복사</button>
        <button type="button" class="room-invite-action close" data-action="close">닫기</button>
      </div>
    </section>
  `;
  document.body.appendChild(backdrop);

  const canvas = backdrop.querySelector<HTMLCanvasElement>('.room-invite-qr')!;
  const code = backdrop.querySelector<HTMLElement>('.room-invite-code')!;
  const actions = backdrop.querySelector<HTMLElement>('.room-invite-actions')!;
  const shareBtn = backdrop.querySelector<HTMLButtonElement>('[data-action="share"]')!;
  const copyBtn = backdrop.querySelector<HTMLButtonElement>('[data-action="copy"]')!;
  const closeBtn = backdrop.querySelector<HTMLButtonElement>('[data-action="close"]')!;
  const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
  code.textContent = `방 코드 ${roomCodeFromUrl(opts.url)}`;
  shareBtn.classList.toggle('hidden', !nav.share);
  actions.classList.toggle('copy-only', !nav.share);

  const close = () => {
    document.removeEventListener('keydown', onKeyDown);
    backdrop.remove();
    opts.btn.focus();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') close();
  };

  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close();
  });
  copyBtn.addEventListener('click', () => { void copyUrl(opts.url, copyBtn); });
  shareBtn.addEventListener('click', () => { void shareViaSystem({ ...opts, btn: shareBtn }); });
  document.addEventListener('keydown', onKeyDown);

  try {
    await QRCode.toCanvas(canvas, opts.url, {
      width: 240,
      margin: 1,
      color: { dark: '#3d2d3a', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    });
    closeBtn.focus();
  } catch {
    close();
    await shareViaSystem(opts);
  }
}
