// 对外导出，便于其他脚本复用。

export { discoverDoubao, getRunningProcesses, getRegistryCandidates, isElectronAppDir, resolveAppDir, detectPowerShell } from './discover.mjs';
export { ensureClient, startClient, stopClient, waitForDebugPort } from './launch.mjs';
export { runCheckin, readSigninState, classifyState, ensureSigninPage, ANCHORS } from './checkin.mjs';
export { buildSummary, renderText, renderJson, describeState } from './report.mjs';
export { CdpClient, listTargets, findTarget, evaluate, clickPoint } from './cdp.mjs';
