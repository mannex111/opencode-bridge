#!/bin/sh
# M6 生产切换 v1 -> v2（自验证 + 失败自动回滚）。
# 可 detached 运行：setsid nohup sh scripts/m6-switch.sh > /tmp/m6-switch.log 2>&1 &
# 说明见同目录 ../M6-切换交接手册.md
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TS=$(date +%Y%m%d_%H%M%S)
DB="$HOME/.local/share/opencode/opencode.db"
UNIT="$HOME/.config/systemd/user/opencode-web.service"
OC="$HOME/.local/bin/opencode"
A="opencode:opencodeserver123"
log(){ echo "[M6 $(date +%H:%M:%S)] $*"; }
fail(){ log "❌ $* → 自动回滚"; sh "$SCRIPT_DIR/m6-rollback.sh" "$TS"; exit 1; }

log "1/6 备份库 (v2 会不可逆迁移 schema)..."
python3 -c "import sqlite3,os;d=os.path.expanduser('$DB');s=sqlite3.connect(f'file:{d}?mode=ro',uri=True);t=sqlite3.connect(d+'.before_v2_$TS');s.backup(t);t.close();s.close()" || fail "备份失败"
[ -s "$DB.before_v2_$TS" ] || fail "备份文件为空"

log "2/6 升级 opencode 到 2.0.28..."
"$OC" upgrade 2.0.28 || fail "升级失败"
VER=$("$OC" --version 2>&1 | head -1); log "  版本: $VER"
echo "$VER" | grep -q "2\.0\.28" || fail "版本非 2.0.28"

log "3/6 改 systemd ExecStart: web -> serve..."
cp "$UNIT" "$UNIT.before_v2_$TS" || fail "备份单元失败"
sed -i "s#^ExecStart=.*#ExecStart=$OC serve --port 4096 --hostname 0.0.0.0#" "$UNIT"
systemctl --user daemon-reload

log "4/6 重启 opencode-web..."
systemctl --user restart opencode-web; sleep 8
systemctl --user is-active opencode-web | grep -q active || fail "opencode-web 未 active"

log "5/6 重启 opencode-bridge..."
systemctl --user restart opencode-bridge; sleep 5

log "6/6 端到端验证..."
C1=$(curl -s -m5 -o /dev/null -w "%{http_code}" http://127.0.0.1:4096/api/config)
C2=$(curl -s -m5 -u "$A" -o /dev/null -w "%{http_code}" http://127.0.0.1:4096/api/config)
N=$(curl -s -m10 -u "$A" http://127.0.0.1:4096/api/session | python3 -c "import sys,json;print(len(json.load(sys.stdin).get('data',[])))" 2>/dev/null || echo 0)
log "  无鉴权=$C1(期望401) 有鉴权=$C2(期望200) 会话数=$N(期望>5)"
[ "$C1" = "401" ] || fail "鉴权行为异常(无鉴权=$C1)"
[ "$C2" = "200" ] || fail "鉴权失败(有鉴权=$C2)"
[ "$N" -gt 5 ] 2>/dev/null || fail "会话数异常($N)"
log "✅ 切换成功。回滚: sh $SCRIPT_DIR/m6-rollback.sh $TS"
