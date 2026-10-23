// 结果呈现：给人看的中文结论 + 给机器看的 JSON。

const LABELS = {
  checked_in: '签到成功',
  already_checked_in: '今日已签到',
  dry_run: '仅探测（未点击）',
  failed: '签到失败',
  error: '执行异常',
};

/** 组装面向用户的结构化摘要。 */
export function buildSummary({ discovery, ensure, result, port, dryRun }) {
  const before = result?.before;
  const after = result?.after;
  const api = result?.api;
  const lines = [];

  lines.push(`客户端      ${discovery?.exePath || '未找到'}`);
  if (discovery?.version) {
    lines.push(`客户端版本  ${discovery.version}${discovery.electronVersion ? `（Electron ${discovery.electronVersion}）` : ''}`);
  }
  lines.push(`发现方式    ${discovery?.source || '-'}`);
  lines.push(`调试端口    ${port}（${ensure?.reused ? '复用已开启的端口' : '本次启动并开启'}）`);
  if (result?.page) {
    lines.push(`签到页      ${result.page.url}（${result.page.opened ? '本次打开' : '已存在'}）`);
  }
  if (before) {
    lines.push(`页面节点    ${before.nodeCount} 个 DOM 节点 / ${before.frameCount} 个 iframe`);
    lines.push(`签到前      ${describeState(before)}`);
  }
  if (after && after !== before) {
    lines.push(`签到后      ${describeState(after)}`);
  }
  if (api) {
    const code = api.code === null || api.code === undefined ? '-' : api.code;
    lines.push(`接口回调    POST /alice/ug/campaign/landing/checkin → HTTP ${api.status ?? '-'}，业务码 ${code}`);
  }
  if (result?.reward && result.reward.delta !== null) {
    lines.push(`额度变化    ${result.reward.pointsBefore} → ${result.reward.pointsAfter}（${formatDelta(result.reward.delta)}）`);
  }
  if (result?.network?.length > 1) {
    lines.push(`关联请求    ${result.network.length} 条（含签到后刷新详情接口）`);
  }
  lines.push(`结论        [${LABELS[result?.status] || result?.status}] ${result?.message || ''}`);

  const status = result?.status;
  const exitCode = status === 'failed' ? 1 : status === 'checked_in' || status === 'already_checked_in' || status === 'dry_run' ? 0 : 1;

  return {
    ok: exitCode === 0,
    exitCode,
    status,
    dryRun: !!dryRun,
    message: result?.message || '',
    lines,
    discovery: discovery
      ? {
          exePath: discovery.exePath,
          appDir: discovery.appDir,
          version: discovery.version,
          electronVersion: discovery.electronVersion,
          source: discovery.source,
          userDataDir: discovery.userDataDir,
          candidates: discovery.candidates?.map((c) => ({ exePath: c.exePath, source: c.source })),
        }
      : null,
    port,
    result,
  };
}

function formatDelta(delta) {
  if (delta === 0) return '无变化';
  return delta > 0 ? `+${delta}` : String(delta);
}

/** 把页面快照描述成一句人话。 */
export function describeState(state) {
  if (!state) return '未知';
  if (!state.hasCard) {
    return state.loginWords ? '未登录（页面要求登录）' : '未找到每日签到卡片';
  }
  if (state.hasButton) {
    const disabled = state.buttonDisabled ? '，按钮不可点击' : '，可点击';
    return `未签到（按钮「${state.buttonText}」${disabled}）`;
  }
  if (state.hasRewardedMark) {
    return '已签到（按钮已被对勾图标替换，页面无签到按钮）';
  }
  return '状态未知（卡片存在但没有按钮）';
}

/** 纯文本报告。 */
export function renderText(summary, { header = '豆包自动签到' } = {}) {
  const bar = '-'.repeat(52);
  return [header, bar, ...summary.lines, bar].join('\n');
}

/** JSON 报告。 */
export function renderJson(summary) {
  const { discovery, ...rest } = summary;
  return JSON.stringify(
    {
      ...rest,
      discovery: discovery
        ? {
            exePath: discovery.exePath,
            version: discovery.version,
            electronVersion: discovery.electronVersion,
            source: discovery.source,
          }
        : null,
    },
    null,
    2,
  );
}
