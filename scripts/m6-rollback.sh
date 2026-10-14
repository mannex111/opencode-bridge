#!/bin/sh
# M6 回滚 v2 -> v1（恢复库备份 + 还原 systemd + 降级二进制）。
# 用法: sh scripts/m6-rollback.sh <切换时间戳TS>
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TS="${1:?用法: m6-rollback.sh <备份时间戳TS>}"
DB="$HOME/.local/share/opencode/opencode.db"
UNIT="$HOME/.config/systemd/user/opencode-web.service"
OC="$HOME/.local/bin/opencode"
log(){ echo "[回滚 $(date +%H:%M:%S)] $*"; }

log "停 opencode-web..."
systemctl --user stop opencode-web || true
log "恢复库备份..."
cp -f "$DB.before_v2_$TS" "$DB"
log "还原 systemd 单元..."
cp -f "$UNIT.before_v2_$TS" "$UNIT"
systemctl --user daemon-reload
log "降级 opencode 到 1.19.0..."
"$OC" upgrade 1.19.0 || true
log "重启服务..."
systemctl --user restart opencode-web; sleep 8
systemctl --user restart opencode-bridge
log "回滚完成。校验: $OC --version / systemctl --user is-active opencode-web opencode-bridge"
