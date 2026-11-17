#!/usr/bin/env bash
# SafeCircle Development Startup Script (Bash, Linux / macOS)
# Launches Django backend (port 8000), escalation worker, and Vite frontend (port 5173).
# Trap INT TERM EXIT kills all background PIDs cleanly.

set -e

echo "=================================================="
echo " SafeCircle Emergency Response System - Dev Stack "
echo "=================================================="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -d "$SCRIPT_DIR/Community Emergency Response/backend" ]; then
    BACKEND_DIR="$SCRIPT_DIR/Community Emergency Response/backend"
    FRONTEND_DIR="$SCRIPT_DIR/Community Emergency Response/frontend"
elif [ -d "$SCRIPT_DIR/backend" ]; then
    BACKEND_DIR="$SCRIPT_DIR/backend"
    FRONTEND_DIR="$SCRIPT_DIR/frontend"
else
    echo "Error: Could not locate backend directory."
    exit 1
fi

PYTHON="python3"
if [ -f "$BACKEND_DIR/venv_local/bin/python" ]; then
    PYTHON="$BACKEND_DIR/venv_local/bin/python"
elif [ -f "$BACKEND_DIR/venv/bin/python" ]; then
    PYTHON="$BACKEND_DIR/venv/bin/python"
elif [ -f "$BACKEND_DIR/venv_local/Scripts/python.exe" ]; then
    PYTHON="$BACKEND_DIR/venv_local/Scripts/python.exe"
fi

echo "Using Python: $PYTHON"
echo "Backend dir:  $BACKEND_DIR"
echo "Frontend dir: $FRONTEND_DIR"

cleanup() {
    echo ""
    echo "Shutting down all SafeCircle dev services..."
    if [ -n "$BACKEND_PID" ]; then kill "$BACKEND_PID" 2>/dev/null || true; fi
    if [ -n "$WORKER_PID" ]; then kill "$WORKER_PID" 2>/dev/null || true; fi
    if [ -n "$FRONTEND_PID" ]; then kill "$FRONTEND_PID" 2>/dev/null || true; fi
    echo "All dev services stopped."
}

trap cleanup INT TERM EXIT

echo ""
echo "[1/3] Starting Django REST Backend on http://localhost:8000..."
(cd "$BACKEND_DIR" && "$PYTHON" manage.py runserver 8000) &
BACKEND_PID=$!

sleep 2

echo "[2/3] Starting Automated Escalation Worker..."
(cd "$BACKEND_DIR" && "$PYTHON" manage.py run_escalation_worker) &
WORKER_PID=$!

echo "[3/3] Starting Vite Frontend on http://localhost:5173..."
(cd "$FRONTEND_DIR" && npm run dev) &
FRONTEND_PID=$!

echo ""
echo "All 3 services running. Press Ctrl+C to terminate all services."
wait

