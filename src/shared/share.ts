/** 방 초대 링크를 Web Share API로 공유(모바일에서 카카오톡 등 설치된 앱이 공유 시트에 뜸)하고,
 * 지원하지 않는 환경(대부분의 데스크톱 브라우저)에서는 클립보드 복사로 대체한다. */
export async function shareRoomLink(opts: { url: string; title: string; text: string; btn: HTMLButtonElement }) {
  const { url, title, text, btn } = opts;
  const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };

  if (nav.share) {
    try {
      await nav.share({ title, text, url });
      return;
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return; // 사용자가 공유 시트를 닫음 - 조용히 종료
    }
  }

  try {
    await navigator.clipboard.writeText(url);
    const orig = btn.textContent!;
    btn.textContent = '복사됨!';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  } catch {
    window.prompt('아래 링크를 복사해서 공유하세요', url);
  }
}
