export const ACTIVE_RECONNECT_GRACE_MS = 45_000;
export const LOBBY_RECONNECT_GRACE_MS = 5 * 60_000;

/**
 * 공유 앱으로 이동하는 동안에는 브라우저가 로비 소켓을 오래 멈출 수 있다.
 * 게임이 시작된 뒤에는 상대방을 오래 묶지 않도록 기존 45초 정책을 유지한다.
 */
export function getReconnectGraceMs(room) {
  return room?.started ? ACTIVE_RECONNECT_GRACE_MS : LOBBY_RECONNECT_GRACE_MS;
}
