# 给 Hermes 的指令：建一个 Cron 盯住「Oh My OpenAgent 是否支持 OpenCode v2」

> 直接把本文件（或下面「任务」到「验收」整段）交给 Hermes 执行。

---

## 任务

在 WSL 里创建一个**每日定时任务**，监控 GitHub 项目 **`code-yeongyu/oh-my-openagent`**（简称 OMO）**是否已支持 OpenCode v2**；一旦有进展就**通过飞书通知我**。

## 背景

- OMO 是跑在 OpenCode 之上的智能体编排插件。
- 截至 2026-10-19（OMO `5.1.35`），**官方尚未支持 OpenCode v2**（CHANGELOG 的 `### OpenCode v2` 一节仍写 "coming"）。
- v2 适配正在开发（多个 PR open，未合并），需要**盯着什么时候落地**。
- 本机网络：GitHub/raw 需走代理 `http://127.0.0.1:7890`（WSL → Windows Clash，mirrored 网络下 127.0.0.1 可达）。

## 要监控的三个信号（任一变化 = 有进展）

| # | 信号 | 来源 |
|---|---|---|
| 1 | **npm 最新版本号** | `https://registry.npmjs.org/oh-my-openagent` 的 `dist-tags.latest` |
| 2 | **CHANGELOG 的 `### OpenCode v2` 一节内容** | `https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/CHANGELOG.md` |
| 3 | **已合并的 `opencode v2` PR 数量** | GitHub API：`repo:code-yeongyu/oh-my-openagent is:pr is:merged opencode v2 in:title`（收紧查询：标题须**同时**含 `opencode` 与 `v2`，避免 `memory v2`/`codex V2` 之类噪音） |

**判定「已支持」的强信号**（通知里要标红）：
- CHANGELOG 的 v2 节不再出现 "coming"（或出现 "support"）；
- 出现 merged 的 `OpenCode v2 plugin support` 类 PR；
- 新版本 release notes 提到 v2 支持。

## 交付物

1. 脚本：`~/.local/bin/omo-v2-watch`（内容见下）
2. 状态文件：`~/.local/state/omo-v2-watch/state.json`（首次运行自动创建）
3. 定时任务：**每天 09:00** 跑一次（cron 或 systemd user timer 都行）
4. 飞书通知：见下

## 脚本（已实测可用，直接装）

> 本机已实测：`merged opencode-v2 PRs: 0`、判定 `已支持: no`、二次运行输出「无变化」（去重生效）。
> 也可以直接从 `/home/mannex/.local/bin/omo-v2-watch` 复制。

```bash
#!/bin/bash
# omo-v2-watch — 监控 oh-my-openagent 是否支持 OpenCode v2（变化时飞书通知）
set -u
PROXY="${OMO_WATCH_PROXY:-http://127.0.0.1:7890}"
STATE_DIR="${OMO_WATCH_STATE_DIR:-$HOME/.local/state/omo-v2-watch}"
STATE="$STATE_DIR/state.json"
FEISHU_WEBHOOK="${FEISHU_WEBHOOK:-}"
mkdir -p "$STATE_DIR"
fetch() { curl -s -m25 -x "$PROXY" "$1" 2>/dev/null || curl -s -m25 "$1" 2>/dev/null; }

NPM=$(fetch https://registry.npmjs.org/oh-my-openagent \
      | python3 -c "import sys,json;print(json.load(sys.stdin).get('dist-tags',{}).get('latest',''))" 2>/dev/null)

# CHANGELOG 的 "### OpenCode v2" 一节
CL=$(fetch https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/CHANGELOG.md \
     | awk '/^### OpenCode v2/{f=1;next} /^### /{f=0} f' | tr -d '\r' | tr -s ' ' | head -c 400)

# 已合并的「opencode v2」PR 数（收紧：标题同时含 opencode 与 v2）
MERGED=$(fetch "https://api.github.com/search/issues?q=repo:code-yeongyu/oh-my-openagent+is:pr+is:merged+opencode+v2+in:title&per_page=1" \
         | python3 -c "import sys,json;print(json.load(sys.stdin).get('total_count',0))" 2>/dev/null)

NEW=$(python3 - "$NPM" "$CL" "$MERGED" <<'PY'
import sys,hashlib,json
npm,cl,merged=sys.argv[1],sys.argv[2],sys.argv[3]
print(json.dumps({"npm":npm,"changelog_sha":hashlib.sha256(cl.encode()).hexdigest()[:12],"changelog":cl[:300],"merged_opencode_v2_prs":merged},ensure_ascii=False))
PY
)
OLD=$(cat "$STATE" 2>/dev/null || echo '{}')
if [ "$NEW" = "$OLD" ]; then echo "[omo-v2-watch] 无变化"; exit 0; fi
echo "$NEW" > "$STATE"

# 「已支持」强信号：v2 节不再说 coming；或已有合并的 opencode-v2 PR
SUPPORTED="no"
{ [ -n "$CL" ] && ! echo "$CL" | grep -qiE "coming|until then"; } && SUPPORTED="YES"
[ -n "$MERGED" ] && [ "$MERGED" != "0" ] && SUPPORTED="YES"

MSG="🔔 OMO × OpenCode v2 监控（$(date '+%F %H:%M')）
npm latest: ${NPM:-?}
merged opencode-v2 PRs: ${MERGED:-?}
已支持(疑似): ${SUPPORTED}
CHANGELOG v2 节:
${CL:0:280}"
if [ -n "$FEISHU_WEBHOOK" ]; then
  curl -s -m15 -X POST -H 'Content-Type: application/json' \
    -d "$(python3 -c 'import json,sys;print(json.dumps({"msg_type":"text","content":{"text":sys.argv[1]}}))' "$MSG")" \
    "$FEISHU_WEBHOOK" >/dev/null 2>&1
fi
echo "$MSG"
```

## 飞书通知（二选一）

- **A. 自定义机器人 webhook（最简单，推荐）**
  在目标飞书群 → 群设置 → 群机器人 → 添加「自定义机器人」→ 复制 webhook URL。
  然后把它写进运行环境，例如：
  ```
  # 放在 cron 行前，或写进脚本顶部的 FEISHU_WEBHOOK=
  FEISHU_WEBHOOK="https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxxxx"
  ```
- **B. 复用现有桥接器的飞书应用**（`cli_aaea779b73f81bc6`）——如果你更想走现有应用发消息，就用它的 `tenant_access_token` + `im/v1/messages` 接口，发给指定群 `chat_id`。

## 定时任务（二选一）

- **cron**：`crontab -e` 加一行
  ```
  0 9 * * * FEISHU_WEBHOOK="<你的 webhook>" /home/mannex/.local/bin/omo-v2-watch >> /home/mannex/.local/state/omo-v2-watch/run.log 2>&1
  ```
- **systemd user timer**（更稳，推荐）：`~/.config/systemd/user/omo-v2-watch.{service,timer}`，`OnCalendar=*-*-* 09:00:00`，`Environment=FEISHU_WEBHOOK=...`，然后 `systemctl --user enable --now omo-v2-watch.timer`。

## 验收

1. 手动跑一次 `omo-v2-watch`，无报错，输出当前 npm 版本 + v2 节摘要。
2. 再跑一次 → 输出「无变化」（状态去重生效）。
3. 手动改一下 `state.json` 再跑 → 能触发飞书通知。
4. `systemctl --user list-timers | grep omo-v2-watch`（或 `crontab -l`）能看到定时任务。

## 注意

- 只读监控，**不要改动 OMO / OpenCode / 桥接器**。
- GitHub 匿名 API 限流 60 次/时，每天 1 次完全够；如遇 403 就加 `Authorization: Bearer <token>`（用 `gh auth token`）。
- 网络走代理 `127.0.0.1:7890`；若代理不可用脚本会自动回退直连。
