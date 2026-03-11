#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
PYTHON_BIN="$ROOT_DIR/.venv/bin/python"

cd "$ROOT_DIR"

"$PYTHON_BIN" -m pip install -r requirements.txt
"$PYTHON_BIN" -m PyInstaller --noconfirm ImageRunner.spec

echo "Built app at: $ROOT_DIR/dist/ImageRunner.app"