# 签到触发链、回调与幂等

## 一、真实请求链路

挂上 `Network.enable` 后点击「立即签到」，抓到的请求：

```
POST https://www.doubao.com/alice/ug/campaign/landing/checkin?<大量客户端参数>
body: {"scene":"pc_incentive_task_mvp_v3"}
→ 200

POST https://www.doubao.com/alice/ug/campaign/v3/detail/?<同上参数>
→ 200（刷新活动详情）
```

`checkin` 的查询串里带着 `pc_version=2.32.6`、`web_id`、`tea_uuid`、`msToken`、`a_bogus` 等。
其中 `a_bogus` 是客户端侧生成的签名，**不要尝试绕过**，脚本走 UI 点击让客户端自己发请求。

## 二、UI 反馈

| 阶段 | 签到卡片 |
|---|---|
| 点击前 | 有 `<button>立即签到</button>`，可点击 |
| 点击瞬间 | 按钮节点被移除（乐观更新，没有 loading 态） |
| 点击后 | 出现 `<div class="rewarded-*"><svg/></div>` 对勾 |

积分数字同步变化：`200 → 400`（`[class*="pointsValue"]` 的文本）。
同页的里程碑按钮从 `disabled` 变为可点（因为额度涨了），可以当作旁证。

## 三、状态机

```
ensureSigninPage
   ├─ 已有 pc/agent-explore 目标 → 复用
   └─ 没有 → 主界面点左下角账号按钮 → 菜单里点「免费领额度」→ 等 webview 目标出现

readSigninState
   ├─ 无卡片 + 有登录字样 → not_logged_in
   ├─ 无卡片              → no_card
   ├─ 有「立即签到」按钮   → pending
   ├─ 有 rewarded 标记     → checked_in
   ├─ 按钮禁用             → disabled
   └─ 其余                 → unknown

pending → clickPoint → 轮询直到 checked_in（默认最多 20s）
       → 读 Network 里的 checkin 响应做旁证
       → 对比积分增量
```

判定优先级：DOM 收敛 > 接口 200 > 积分变化。
接口 200 但 DOM 没刷新时，脚本会报「接口成功、页面未刷新」，提示人工确认，不会假装成功。

## 四、幂等

签到天然每日一次，脚本在三个层面保证幂等：

1. **执行前判定**：`checked_in` 直接返回，不点击。
2. **执行中防护**：点击前重新取一次按钮坐标，取不到就报「按钮已消失，状态可能刚变化」。
3. **接口层**：即使重复点击，服务端也不会重复发额度。

已签到状态下再次「触发」的真实行为（实测）：

- 卡片内 `button` 查询结果为 `null`，无从点击。
- 顶部 banner 的「立即领取」按钮仍可点击，但点击后 **Network 零请求、DOM 零变化、积分不变**。
  它只在未签到时把用户带到签到卡片，签到完成后不再有行为。

## 五、输出约定

成功（本次执行完成签到）：

```
结论        [签到成功] 签到成功，额度 200 → 400
```

已签到（执行前就完成了）：

```
签到前      已签到（按钮已被对勾图标替换，页面无签到按钮）
结论        [今日已签到] 今日已签到，无需重复签到（签到按钮已替换为对勾图标，页面无可点击签到入口）
```

`--json` 会额外给出 `result.network`（签到接口状态与响应体）、`result.reward`（积分前后）、
`result.before/after`（页面快照），便于排障与留证。
