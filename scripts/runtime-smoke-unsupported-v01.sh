#!/usr/bin/env bash

skip_unsupported_v01_smoke_if_current_v01() {
  local script_name="${1:-unsupported pre-consolidation v0.1 smoke script}"
  local info

  if ! info="$(curl --fail --silent "${RUNTIME_URL}/v0/runtime/info" 2>/dev/null)"; then
    return 0
  fi

  if python3 - "${info}" <<'PY'
import json
import sys

info = json.loads(sys.argv[1])
capabilities = set(info.get("capabilities", []))
if "session.load.v0.1" in capabilities:
    sys.exit(0)
sys.exit(1)
PY
  then
    echo "skipped ${script_name}: unsupported pre-consolidation v0.1 smoke scenario against current 0.1 Runtime"
    echo "run scripts/smoke-runtime-v01-projects.sh for current Runtime project smoke coverage"
    exit 0
  fi
}
