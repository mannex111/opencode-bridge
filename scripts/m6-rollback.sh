#!/bin/sh
# M6 回滚 v2 -> v1（恢复库备份 + 恢复 v1 二进制 + 还原 systemd）。
# 用法: sh scripts/m6-rollback.sh <切换时间戳TS>
# 关键：v2 安装会就地覆写 v1 二进制，且 @opencode/cli 无 1.x 版本 —— 所以只能靠
#       切换前的二进制备份恢复，不能用 `opencode upgrade 1.19.0`。
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TS="${1:?用法: m6-rollback.sh <备份时间戳TS>}"
DB="$HOME/.local/share/opencode/opencode.db"
UNIT="$HOME/.config/systemd/user/opencode-web.service"
BIN_DIR="$HOME/.opencode/bin"
log(){ echo "[回滚 $(date +%H:%M:%S)] $*"; }

log "停 opencode-web..."
systemctl --user stop opencode-web || true
log "恢复库备份..."
cp -f "$DB.before_v2_$TS" "$DB"
log "恢复 v1 二进制 (从备份)..."
cp -f "$BIN_DIR/opencode.v1.bak.$TS" "$BIN_DIR/opencode" && chmod 755 "$BIN_DIR/opencode"
[ -f "$BIN_DIR/opencode2.v1.bak.$TS" ] && cp -f "$BIN_DIR/opencode2.v1.bak.$TS" "$BIN_DIR/opencode2" && chmod 755 "$BIN_DIR/opencode2"
log "还原 systemd 单元..."
cp -f "$UNIT.before_v2_$TS" "$UNIT"
systemctl --user daemon-reload
log "重启服务..."
systemctl --user restart opencode-web; sleep 8
systemctl --user restart opencode-bridge
log "回滚完成。校验: $BIN_DIR/opencode --version (应 1.19.0) / systemctl --user is-active opencode-web opencode-bridge"
