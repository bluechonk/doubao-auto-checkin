# 第三方组件与授权声明

本仓库主体代码采用 MIT 许可证（见根目录 `LICENSE`）。
仓库内包含一份**第三方**内容，其许可证与本仓库不同，使用与再分发时请遵守对应条款。

## 1. agent-browser 技能内容（Apache License 2.0）

| 项 | 内容 |
|---|---|
| 组件 | `agent-browser` 技能文件（SKILL.md、skill-data/、LICENSE、SOURCE-NOTES.md） |
| 位置 | `.agents/skills/agent-browser/` |
| 来源仓库 | https://github.com/vercel-labs/agent-browser |
| 来源版本 | 0.38.2（本地安装包 `agent-browser@0.38.2`） |
| 上游快照 | commit `dac13bb`（浅克隆 HEAD，2026-10-18 获取） |
| 许可证 | Apache License 2.0 |
| 版权 | Copyright 2025 Vercel Inc. |
| 许可证全文 | `.agents/skills/agent-browser/LICENSE` |
| 修改情况 | **未做任何修改**，按原样复制 |

### 为什么仓库里有这份内容

本项目的排障与手工复现流程依赖 `agent-browser` 的官方技能说明，
为让克隆本仓库的机器在离线、或未安装该技能的环境下也能照做，故将其原样内置。

### Apache-2.0 合规要点（本仓库已做的部分）

1. **保留版权与许可声明**：上游 `LICENSE` 原文随内容一并保留在
   `.agents/skills/agent-browser/LICENSE`，未删改。
2. **标注修改**：本仓库未修改该内容，已在本文档与本目录 `SOURCE-NOTES.md` 中声明。
3. **NOTICE 文件**：上游仓库未随技能内容提供 `NOTICE` 文件；
   如上游后续补充，再分发时应一并保留。
4. **商标**：`agent-browser` 名称与标识归其权利人所有，本项目仅作来源说明，不代表背书。

## 2. 运行时依赖

本项目**零 npm 依赖**：`package.json` 中没有 `dependencies` / `devDependencies`。
运行时只使用 Node.js 内置能力（`fetch`、`WebSocket`、`node:test`）与 Windows 自带命令。

`agent-browser` 属于**可选的排障工具**，不是运行依赖：

- 日常执行 `node bin/doubao-checkin.mjs` 不需要它；
- 仅当需要人工按 `SKILL.md` 复现节点探查时才需要安装。

## 3. 商标与免责

- 「豆包」「Doubao」是字节跳动相关公司的商标，本项目为个人自动化脚本，
  与商标权利人无任何关联，也未获得其背书。
- 本项目只做本机客户端的界面点击，不伪造接口签名、不修改服务端数据、不绕过登录。
- 使用本脚本产生的任何后果（包括账号风控、额度变动、客户端异常）由使用者自行承担。
