#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-/opt/server-monitor-agent}"
PYTHON_BIN="${PYTHON_BIN:-python3}"
AGENT_HOST="${SERVER_MONITOR_AGENT_HOST:-0.0.0.0}"
AGENT_PORT="${SERVER_MONITOR_AGENT_PORT:-9090}"
AGENT_TOKEN="${SERVER_MONITOR_AGENT_TOKEN:-}"
ALLOWED_MONITOR_IP="${SERVER_MONITOR_ALLOWED_MONITOR_IP:-}"

mkdir -p "$INSTALL_DIR"
cp -R agent/* "$INSTALL_DIR"/

"$PYTHON_BIN" -m venv "$INSTALL_DIR/.venv"
"$INSTALL_DIR/.venv/bin/pip" install -r "$INSTALL_DIR/requirements.txt"

if [ ! -f "$INSTALL_DIR/config/agent-config.json" ]; then
  cp "$INSTALL_DIR/config/agent-config.example.json" "$INSTALL_DIR/config/agent-config.json"
fi

cat > /etc/systemd/system/server-monitor-agent.service <<EOF
[Unit]
Description=Server Monitor Agent
After=network.target

[Service]
WorkingDirectory=$INSTALL_DIR
Environment=SERVER_MONITOR_AGENT_HOST=$AGENT_HOST
Environment=SERVER_MONITOR_AGENT_PORT=$AGENT_PORT
Environment=SERVER_MONITOR_AGENT_TOKEN=$AGENT_TOKEN
Environment=SERVER_MONITOR_AGENT_CONFIG=$INSTALL_DIR/config/agent-config.json
ExecStart=$INSTALL_DIR/.venv/bin/python $INSTALL_DIR/monitor_agent.py
Restart=always

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now server-monitor-agent.service

if [ -n "$ALLOWED_MONITOR_IP" ] && command -v ufw >/dev/null 2>&1; then
  ufw allow from "$ALLOWED_MONITOR_IP" to any port "$AGENT_PORT" proto tcp
fi
