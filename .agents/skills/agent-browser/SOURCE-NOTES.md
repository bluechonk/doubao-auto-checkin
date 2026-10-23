# agent-browser 技能 — 来源与许可证

本目录是**第三方内容**，原样内置在本仓库中，不属于本项目 MIT 许可范围。

- 来源仓库：https://github.com/vercel-labs/agent-browser
- 来源版本：`agent-browser@0.38.2`（本机 npm 全局包）
- 上游快照：2026-10-18 浅克隆 HEAD（commit `dac13bb`）
- 许可证：Apache License 2.0，Copyright 2025 Vercel Inc.（全文见本目录 `LICENSE`）
- 修改情况：未做任何修改，逐文件原样复制
- 内置原因：本项目排障与手工复现流程引用该技能说明，内置后克隆即可离线照做

结构说明：

- `SKILL.md` 是官方的「发现桩」，真正的命令参考与工作流由 CLI 下发；
- `skill-data/` 保存 CLI 下发的完整内容（core / electron / slack / dogfood 等子技能），
  便于离线查阅；
- 本仓库对该内容的引用说明见根目录 `THIRD_PARTY_NOTICES.md`。
