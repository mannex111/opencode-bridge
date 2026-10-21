# 给 Hermes 的指令：用 Hermes 自己的 cron 监控「OMO 是否支持 OpenCode v2」

> 直接把本文件交给 Hermes 执行。

---

## 任务

在 **Hermes 自己的 cron** 里加一个每日任务，监控 GitHub 项目 **`code-yeongyu/oh-my-openagent`**（OMO）**是否已支持 OpenCode v2**；一旦有进展，通过飞书把报告发给我。

## 现成资源（已就绪并实测，请直接用，不要重写）

- **脚本**：`~/.hermes/scripts/omo-v2-watch.sh`（已 `chmod 755`，已实测通过）
  - 检查 3 个信号：① npm 最新版 ② CHANGELOG 的 `### OpenCode v2` 一节 ③ 已合并的 opencode-v2 PR 数
  - **无变化时输出 `[SILENT]`**（Hermes 会据此抑制投递）→ 不会每天打扰
  - **有变化时输出报告文本** → 直接投递到飞书
  - 状态去重文件：`~/.local/state/omo-v2-watch/state.json`
  - 网络：自动走代理 `127.0.0.1:7890`，失败回退直连
- **详细规格**（备查）：`/home/mannex/opencode_workspace/opencode-bridge/scripts/omo-v2-watch-hermes-instruction.md`

## 要建的 job（Hermes cron schema）

参考现有 job（`~/.hermes/cron/jobs.json` 里那几个"银行还款提醒"）的字段：

```jsonc
{
  "id": "<12位hex>",
  "name": "OMO × OpenCode v2 支持监控",
  "prompt": "",
  "script": "omo-v2-watch.sh",      // 必须是 HERMES_HOME/scripts/ 下的相对路径
  "no_agent": true,                  // 不调用模型，直接跑脚本
  "schedule": { "kind": "cron", "expr": "0 9 * * *", "display": "0 9 * * *" },
  "enabled": true,
  "state": "scheduled",
  "deliver": "origin",
  "origin": { "platform": "feishu", "chat_id": "<投递目标群 chat_id>", ... }
}
```

关键点（都已核实）：
- `script` **必须是相对路径**，且位于 `HERMES_HOME/scripts/`（绝对路径 / `~` / 盘符会被 `_validate_cron_script_path` 拒绝——防 prompt 注入）。
- `no_agent: true` → 不走模型，直接执行脚本，**stdout 即投递内容**。
- 脚本首行/末行为 `[SILENT]` 时**抑制投递**（输出仍存本地审计）。
- `deliver: "origin"` → 投递到**创建这个 job 的那个飞书会话**。所以请**在本对话所在的飞书群/会话里**创建它，投递就会回到这里。

## 建议步骤

1. 用 Hermes 自己的 cron 工具（`cronjob_tools` / cronjob 相关 skill）在**当前飞书会话**里创建一个 job：
   - name: `OMO × OpenCode v2 支持监控`
   - script: `omo-v2-watch.sh`
   - no_agent: `true`
   - schedule: cron `0 9 * * *`（每天 09:00）
   - deliver: `origin`
2. 手动跑一次该 job 验证：
   - 预期：飞书收到一条报告（因为状态文件刚被我重置过/或有变化），或若判定无变化则**不投递**（这是正确行为）。
3. 确认 `~/.hermes/cron/jobs.json` 里出现了该 job，且 `~/.hermes/cron/executions.db` 里有执行记录。

## 验收标准

- `~/.hermes/cron/jobs.json` 中存在该 job，`enabled: true`、`state: "scheduled"`、`next_run_at` 指向明天 09:00。
- 手动执行后 `last_status` 为 `ok`，`last_delivery_error` 为空。
- 无变化的日子**不会**在飞书出现消息（`[SILENT]` 生效）。

## 背景（供你理解，不必照做）

- OMO 是跑在 OpenCode 之上的智能体编排插件。
- 截至 2026-10-21（OMO `5.1.40`），**官方仍未支持 OpenCode v2**：CHANGELOG 的 `### OpenCode v2` 一节仍写 "Our answer to it is coming"，已合并的 opencode-v2 PR = 0，v2 适配的 7 个 PR 全部未合并（其中一个分片 PR #10374 在 10-19 被关闭重整）。
- 官方目前建议用 **OmO Native**（独立 `omo` 命令，本机已装 5.1.33）。

## 约束

- **只读监控**：不要改动 OMO / OpenCode / 桥接器 / 任何现有 cron job。
- 不要动现有 4 个"银行还款提醒" job。
