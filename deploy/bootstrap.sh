#!/usr/bin/env bash
#
# 且坐 · 服务器一键部署脚本（Ubuntu 22.04 / 24.04，Debian 12 亦可）
#
#   sudo bash deploy/bootstrap.sh
#
# 幂等：重复运行只会拉取最新代码、重新构建、重启服务。
# 可用环境变量覆盖：
#   REPO_URL   仓库地址（国内机器拉 GitHub 慢时换成镜像）
#   APP_DIR    部署目录，默认 /srv/shanshi
#   RUN_USER   运行用户，默认 www-data
#   PORT       监听端口，默认 8787
#   BRANCH     分支，默认 main
#   SKIP_FIREWALL=1  不改动 ufw
#
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/wzn123w2/yizhuxiang.git}"
APP_DIR="${APP_DIR:-/srv/shanshi}"
RUN_USER="${RUN_USER:-www-data}"
PORT="${PORT:-8787}"
BRANCH="${BRANCH:-main}"
SERVICE=shanshi

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m  ✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m  ! %s\033[0m\n' "$*"; }
die()  { printf '\n\033[1;31m!! %s\033[0m\n' "$*" >&2; exit 1; }

# ————————————————————————————— 0. 前置检查

[ "$(id -u)" -eq 0 ] || die "请用 root 运行：sudo bash deploy/bootstrap.sh"
command -v apt-get >/dev/null || die "本脚本只支持 Debian/Ubuntu。CentOS 请手动装 nodejs 22 + git。"
id "$RUN_USER" >/dev/null 2>&1 || die "用户 $RUN_USER 不存在。"

log "0/7 前置检查"
. /etc/os-release 2>/dev/null || true
ok "系统：${PRETTY_NAME:-unknown}  架构：$(dpkg --print-architecture)"
ok "部署目录：$APP_DIR   运行用户：$RUN_USER   端口：$PORT"

# ————————————————————————————— 1. 系统依赖

log "1/7 安装 Node.js 22 与 git"
export DEBIAN_FRONTEND=noninteractive

need_node=1
if command -v node >/dev/null 2>&1; then
  major="$(node -p 'process.versions.node.split(".")[0]')"
  if [ "$major" -ge 20 ]; then
    need_node=0
    ok "已有 Node $(node -v)，跳过安装"
  else
    warn "现有 Node $(node -v) 太低（需 ≥20），升级"
  fi
fi

if [ "$need_node" -eq 1 ]; then
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl git gnupg >/dev/null
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
  ok "已安装 Node $(node -v)"
else
  missing=""
  command -v git  >/dev/null 2>&1 || missing="$missing git"
  command -v curl >/dev/null 2>&1 || missing="$missing curl ca-certificates"
  if [ -n "$missing" ]; then
    apt-get update -qq
    # shellcheck disable=SC2086
    apt-get install -y -qq $missing >/dev/null
  fi
fi
# 健康检查与 IP 探测都依赖 curl
command -v curl >/dev/null 2>&1 || { apt-get update -qq; apt-get install -y -qq curl >/dev/null; }
command -v git  >/dev/null 2>&1 || die "git 安装失败。"
command -v curl >/dev/null 2>&1 || die "curl 安装失败。"

# ————————————————————————————— 2. 取代码

log "2/7 获取代码"
if [ -d "$APP_DIR/.git" ]; then
  ok "目录已存在，拉取最新代码"
  git -C "$APP_DIR" fetch --all --prune
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" reset --hard "origin/$BRANCH"
else
  mkdir -p "$(dirname "$APP_DIR")"
  # 国内机器直连 GitHub 常常超时，失败时给出镜像提示
  if ! git clone --branch "$BRANCH" --depth 1 "$REPO_URL" "$APP_DIR"; then
    warn "直连 $REPO_URL 失败。可以换镜像重试，例如："
    warn "  sudo REPO_URL=https://ghfast.top/$REPO_URL bash deploy/bootstrap.sh"
    die  "拉取代码失败。"
  fi
fi
ok "代码就绪：$(git -C "$APP_DIR" log --oneline -1)"

# ————————————————————————————— 3. 构建

log "3/7 安装依赖并构建（tsc + vite）"
cd "$APP_DIR"
npm ci --no-audit --no-fund
npm run build
[ -f "$APP_DIR/dist/index.html" ] || die "构建产物缺失，dist/index.html 不存在。"
ok "构建完成：$(du -sh "$APP_DIR/dist" | cut -f1)  dist/"

# ————————————————————————————— 4. 运行用户权限

log "4/7 处理运行用户权限"
# 只给运行用户读权限（服务不需要写，状态全在内存）
chown -R root:root "$APP_DIR"
chown -R "$RUN_USER:$RUN_USER" "$APP_DIR/dist" "$APP_DIR/server"
chmod -R a+rX "$APP_DIR/dist" "$APP_DIR/server"
ok "$RUN_USER 可读 dist/ 与 server/"

# 签筒数据目录：运行时唯一需要写的地方（权限 700，只给运行用户）
mkdir -p "$APP_DIR/data"
chown -R "$RUN_USER:$RUN_USER" "$APP_DIR/data"
chmod 700 "$APP_DIR/data"
ok "签筒数据目录：$APP_DIR/data"

# ————————————————————————————— 5. systemd

log "5/7 安装并启动 systemd 服务"
cat > "/etc/systemd/system/$SERVICE.service" <<UNIT
[Unit]
Description=Qiezuo (且坐 · 一炷香的时间)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=MAX_PLAYERS=12
# 本脚本装的是本机反代，所以默认打开；服务端只信"来自身 127.0.0.1"的 X-Forwarded-For
Environment=TRUST_PROXY=1
ExecStart=$(command -v node) server/index.mjs
Restart=always
RestartSec=2
User=$RUN_USER
Group=$RUN_USER
StandardOutput=journal
StandardError=journal

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$APP_DIR

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1
systemctl restart "$SERVICE"
sleep 2
systemctl is-active --quiet "$SERVICE" || {
  journalctl -u "$SERVICE" -n 30 --no-pager
  die "服务没起来，日志见上。"
}
ok "systemd 服务 $SERVICE 已 running"

# ————————————————————————————— 6. 防火墙

log "6/7 防火墙"
if [ "${SKIP_FIREWALL:-0}" = "1" ]; then
  warn "已跳过（SKIP_FIREWALL=1）"
elif command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow "$PORT"/tcp >/dev/null
  ok "ufw 已放行 $PORT/tcp"
else
  warn "ufw 未启用，跳过"
fi
warn "云端安全组仍需手动放行 $PORT/tcp —— 这是最常见的“服务正常但外网打不开”的原因"

# ————————————————————————————— 7. 自检

log "7/7 自检"
health="$(curl -fsS "http://127.0.0.1:$PORT/healthz" 2>/dev/null || true)"
[ -n "$health" ] || { journalctl -u "$SERVICE" -n 30 --no-pager; die "健康检查失败。"; }
ok "健康检查：$health"
curl -fsS -o /dev/null "http://127.0.0.1:$PORT/" || die "首页打不开。"
ok "首页 200"

IP="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || echo '<公网IP>')"
cat <<DONE

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 部署完成 ✅

   本机地址   http://127.0.0.1:$PORT
   公网地址   http://$IP:$PORT      （需安全组放行 $PORT）

   看日志     journalctl -u $SERVICE -f
   健康检查   curl -s localhost:$PORT/healthz
   重启       systemctl restart $SERVICE
   更新代码   sudo bash $APP_DIR/deploy/bootstrap.sh

  上 HTTPS 域名：把 deploy/Caddyfile 里的域名改成你的，
                 sudo cp $APP_DIR/deploy/Caddyfile /etc/caddy/Caddyfile
                 （需先 apt install caddy）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DONE
