import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACTIVE_RECONNECT_GRACE_MS,
  LOBBY_RECONNECT_GRACE_MS,
  getReconnectGraceMs,
} from './reconnect-policy.mjs';

test('로비 연결은 외부 공유 앱 전환을 위해 5분간 유예한다', () => {
  assert.equal(getReconnectGraceMs({ started: false }), LOBBY_RECONNECT_GRACE_MS);
  assert.equal(LOBBY_RECONNECT_GRACE_MS, 300_000);
});

test('게임 시작 후 연결 유예는 기존 45초를 유지한다', () => {
  assert.equal(getReconnectGraceMs({ started: true }), ACTIVE_RECONNECT_GRACE_MS);
  assert.equal(ACTIVE_RECONNECT_GRACE_MS, 45_000);
});
