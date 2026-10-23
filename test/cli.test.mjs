// CLI 参数与退出码回归测试：参数错误必须是退出码 2，不能和「执行失败」混在一起。
// 运行：node --test test/cli.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cli = path.join(projectRoot, 'bin', 'doubao-checkin.mjs');

/** 跑一次 CLI，返回 { status, stdout, stderr }。 */
function runCli(args) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 60000 });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

test('--help 退出码 0 且打印用法', () => {
  const { status, stdout } = runCli(['--help']);
  assert.equal(status, 0);
  assert.match(stdout, /用法/);
});

test('--port 非数字 -> 退出码 2', () => {
  const { status, stderr } = runCli(['--port', 'abc']);
  assert.equal(status, 2);
  assert.match(stderr, /--port/);
});

test('--port 越界 -> 退出码 2', () => {
  assert.equal(runCli(['--port', '0']).status, 2);
  assert.equal(runCli(['--port', '70000']).status, 2);
});

test('--port 缺值 -> 退出码 2', () => {
  const { status, stderr } = runCli(['--port']);
  assert.equal(status, 2);
  assert.match(stderr, /缺少参数值/);
});

test('--timeout 非数字 -> 退出码 2（不能被静默吞掉）', () => {
  const { status, stderr } = runCli(['--timeout', 'abc']);
  assert.equal(status, 2);
  assert.match(stderr, /--timeout/);
});

test('--timeout 负数 -> 退出码 2', () => {
  assert.equal(runCli(['--timeout', '-5']).status, 2);
});

test('未知参数 -> 退出码 2', () => {
  const { status, stderr } = runCli(['--nope']);
  assert.equal(status, 2);
  assert.match(stderr, /未知参数/);
});
