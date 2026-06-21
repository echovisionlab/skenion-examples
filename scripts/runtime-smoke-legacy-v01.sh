#!/usr/bin/env bash

skip_legacy_v01_smoke_if_active_v02() {
  local script_name="${1:-legacy v0.1 smoke script}"
  local info

  if ! info="$(curl --fail --silent "${RUNTIME_URL}/v0/runtime/info" 2>/dev/null)"; then
    return 0
  fi

  if python3 - "${info}" <<'PY'
import json
import sys

info = json.loads(sys.argv[1])
capabilities = set(info.get("capabilities", []))
if "session.load.v0.2" in capabilities:
    sys.exit(0)
sys.exit(1)
PY
  then
    echo "skipped ${script_name}: legacy v0.1 smoke scenario against active v0.2 Runtime"
    echo "run scripts/smoke-runtime-v02-projects.sh for active Runtime project smoke coverage"
    exit 0
  fi
}
