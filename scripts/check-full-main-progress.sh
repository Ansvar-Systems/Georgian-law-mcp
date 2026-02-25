#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

LOG_FILE="${1:-logs/full-main-normative-20260222-065129.log}"
NODE_PID="${2:-3908315}"
NPM_PID="${3:-3908301}"

echo "log_file=$LOG_FILE"
echo "seed_count=$(ls data/seed/*.json 2>/dev/null | wc -l)"

if [[ -f "$LOG_FILE" ]]; then
  echo "log_mtime=$(stat -c '%y' "$LOG_FILE")"
  echo "latest_lines:"
  tail -n 20 "$LOG_FILE"

  latest_checkpoint="$(grep -E '\[[0-9]+/[0-9]+\] processed' "$LOG_FILE" | tail -n 1 || true)"
  if [[ -n "$latest_checkpoint" ]]; then
    echo "latest_checkpoint=$latest_checkpoint"
  else
    echo "latest_checkpoint=<none yet>"
  fi
else
  echo "log_missing=true"
fi

echo "processes:"
ps -p "$NPM_PID","$NODE_PID" -o pid,etime,%cpu,%mem,state,cmd || true
