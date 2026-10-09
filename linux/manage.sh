#!/usr/bin/env bash
set -uo pipefail
umask 077

APP_DIR=/opt/proxy-configer
DATA_DIR=/var/lib/proxy-configer
SERVICE=proxy-configer.service
SERVICE_USER=proxy-configer
[[ ${EUID} -eq 0 ]] || { echo '请使用 sudo proxy-configer。' >&2; exit 1; }
[[ -f "$APP_DIR/current/server/manage.js" ]] || { echo '项目未安装，请先运行安装脚本。' >&2; exit 1; }
NODE_BIN=$(command -v node)
[[ -n "$NODE_BIN" ]] || { echo '未找到 Node.js。' >&2; exit 1; }
control() {
  if [[ "$1" == check-port ]]; then
    env APP_DATA_DIR="$DATA_DIR" "$NODE_BIN" "$APP_DIR/current/server/manage.js" "$@"
  else
    runuser -u "$SERVICE_USER" -- env APP_DATA_DIR="$DATA_DIR" "$NODE_BIN" "$APP_DIR/current/server/manage.js" "$@"
  fi
}
address() { control address; }
confirm() { local answer; read -r -p "$1 [y/N]：" answer && [[ "$answer" == y || "$answer" == Y ]]; }

service_action() {
  local action=$1 label=$2
  if systemctl "$action" "$SERVICE"; then
    if [[ "$action" != stop ]] && ! healthy "$(control port)"; then
      echo "服务未正常监听，请查看 journalctl -u $SERVICE -n 50。" >&2
      return
    fi
    echo "服务${label}操作完成。"
    [[ "$action" == stop ]] || address
  else
    echo "服务${label}失败，请查看 journalctl -u $SERVICE -n 50。" >&2
  fi
}

healthy() {
  local port=$1 attempt pid
  for ((attempt=0; attempt<10; attempt++)); do
    pid=$(systemctl show "$SERVICE" -p MainPID --value)
    if [[ "$pid" != 0 ]] && systemctl is-active --quiet "$SERVICE" && ss -H -ltnp "( sport = :$port )" | grep -Fq "pid=$pid,"; then return 0; fi
    sleep 1
  done
  return 1
}

change_port() {
  local current new_port
  current=$(control port) || return
  echo "当前端口：$current"
  read -r -p '请输入新端口（1-65535，留空取消）：' new_port || return
  [[ -n "$new_port" ]] || return
  if [[ ! "$new_port" =~ ^[0-9]{1,5}$ ]] || ((10#$new_port < 1 || 10#$new_port > 65535)); then
    echo '端口须为 1-65535 的整数。'; return
  fi
  new_port=$((10#$new_port))
  [[ "$new_port" != "$current" ]] || { echo '端口未改变。'; return; }
  if [[ -n $(ss -H -lntu "( sport = :$new_port )") ]]; then
    echo "端口 $new_port 已被占用。"; return
  fi
  control check-port "$new_port" || return
  control set-port "$new_port" || return
  if systemctl restart "$SERVICE" && healthy "$new_port"; then
    echo '端口已修改并生效。'
    address
  else
    echo '新端口启动失败，正在恢复原端口。' >&2
    control set-port "$current" && systemctl restart "$SERVICE"
  fi
}

change_admin() {
  local username password repeated
  echo "当前管理员账号：$(control admin-name)"
  read -r -p '请输入新管理员账号（3-64 位，留空取消）：' username || return
  [[ -n "$username" ]] || return
  read -r -s -p '请输入新密码（12-256 位）：' password || { echo; return; }
  echo
  read -r -s -p '请再次输入新密码：' repeated || { echo; return; }
  echo
  [[ "$password" == "$repeated" ]] || { echo '两次输入的密码不同。'; return; }
  printf '%s\n%s\n' "$username" "$password" | control admin-set
  unset password repeated
}

uninstall() {
  local delete_data=false
  echo "卸载将停止服务并取消开机自启，删除 /etc/systemd/system/$SERVICE、$APP_DIR 和 /usr/local/bin/proxy-configer。"
  echo "配置、管理员账号和订阅数据位于 $DATA_DIR，默认保留；共享 Node.js 和系统依赖会保留。"
  confirm '确认卸载程序' || { echo '已取消卸载。'; return; }
  if confirm '同时删除全部配置和业务数据'; then
    echo '彻底删除后，所有管理员凭据、模板和订阅配置均无法恢复。'
    if confirm '再次确认彻底删除数据'; then
      delete_data=true
    else
      echo '已取消数据删除，将保留数据。'
    fi
  fi
  if [[ -L "$APP_DIR" || -L "$DATA_DIR" ]]; then echo '目录为符号链接，拒绝卸载。' >&2; return; fi
  systemctl stop "$SERVICE" || { echo '停止服务失败，卸载已中止。' >&2; return; }
  systemctl disable "$SERVICE" || { echo '取消开机自启失败，卸载已中止。' >&2; return; }
  rm -f -- /etc/systemd/system/proxy-configer.service || { echo '移除服务定义失败。' >&2; return; }
  systemctl daemon-reload || { echo '重新加载 systemd 失败。' >&2; return; }
  systemctl reset-failed "$SERVICE" 2>/dev/null || true
  if ! rm -rf -- "$APP_DIR" || ! rm -f -- /usr/local/bin/proxy-configer; then
    echo '移除程序失败。' >&2; return
  fi
  if [[ "$delete_data" == true ]]; then
    rm -rf -- "$DATA_DIR" || { echo '移除数据失败。' >&2; return; }
    echo '卸载完成，配置与业务数据已彻底删除。'
  else
    echo "卸载完成，配置与业务数据已保留在 $DATA_DIR；重新安装将继续使用。"
  fi
  exit 0
}

while true; do
  cat <<'MENU'

Clash 配置服务管理菜单

1. 查看服务状态
2. 启动服务
3. 停止服务
4. 重启服务
5. 修改服务器端口
6. 修改管理员账号和密码
7. 随机重置管理员账号和密码
8. 卸载
0. 退出
MENU
  read -r -p '请输入数字：' choice || { echo; exit 0; }
  case "$choice" in
    1)
      if systemctl is-active --quiet "$SERVICE"; then echo '服务正在运行。'; else echo '服务未运行。'; fi
      if systemctl is-enabled --quiet "$SERVICE"; then echo '已设置开机自启。'; else echo '未设置开机自启。'; fi
      echo "当前端口：$(control port)"
      address
      ;;
    2) service_action start 启动 ;;
    3) service_action stop 停止 ;;
    4) service_action restart 重启 ;;
    5) change_port ;;
    6) change_admin ;;
    7) confirm '确认随机重置账号和密码（旧登录会话将失效）' && control admin-random ;;
    8) uninstall ;;
    0) exit 0 ;;
    *) echo '请输入菜单中有效的数字。' ;;
  esac
done
