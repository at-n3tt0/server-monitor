#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/server-monitor-agent}"
AGENT_PORT="${SERVER_MONITOR_AGENT_PORT:-9090}"
ALLOWED_MONITOR_IP="${SERVER_MONITOR_ALLOWED_MONITOR_IP:-}"

systemctl disable --now server-monitor-agent.service 2>/dev/null || true
rm -f /etc/systemd/system/server-monitor-agent.service
systemctl daemon-reload
if [ -n "$ALLOWED_MONITOR_IP" ] && command -v ufw >/dev/null 2>&1; then
  ufw delete allow from "$ALLOWED_MONITOR_IP" to any port "$AGENT_PORT" proto tcp || true
fi
rm -rf "$INSTALL_DIR"
