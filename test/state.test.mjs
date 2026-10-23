// 状态机单元测试：用实测的两种页面快照校验判定逻辑。
// 运行：node --test test/

import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyState } from '../src/checkin.mjs';

/** 未签到态：卡片里有「立即签到」按钮。 */
const pendingState = {
  hasCard: true,
  cardText: '每日签到+200 额度立即签到',
  hasButton: true,
  buttonText: '立即签到',
  buttonDisabled: false,
  hasRewardedMark: false,
  points: [200],
  signedWords: false,
  loginWords: false,
};

/** 已签到态：按钮被对勾图标替换。 */
const checkedState = {
  hasCard: true,
  cardText: '每日签到+200 额度',
  hasButton: false,
  buttonText: null,
  buttonDisabled: null,
  hasRewardedMark: true,
  points: [400],
  signedWords: false,
  loginWords: false,
};

test('未签到卡片判定为 pending', () => {
  assert.equal(classifyState(pendingState), 'pending');
});

test('按钮被对勾替换后判定为 checked_in', () => {
  assert.equal(classifyState(checkedState), 'checked_in');
});

test('没有卡片且出现登录提示时判定为未登录', () => {
  assert.equal(classifyState({ hasCard: false, loginWords: true }), 'not_logged_in');
});

test('没有卡片且无登录提示时判定为 no_card', () => {
  assert.equal(classifyState({ hasCard: false, loginWords: false }), 'no_card');
});

test('按钮禁用时判定为 disabled', () => {
  assert.equal(
    classifyState({ ...pendingState, buttonDisabled: true }),
    'disabled',
  );
});

test('卡片存在但既无按钮也无对勾时判定为 unknown', () => {
  assert.equal(
    classifyState({ ...checkedState, hasRewardedMark: false, signedWords: false }),
    'unknown',
  );
});

test('已签到文案出现且无按钮时判定为 checked_in', () => {
  assert.equal(
    classifyState({ ...checkedState, hasRewardedMark: false, signedWords: true }),
    'checked_in',
  );
});
