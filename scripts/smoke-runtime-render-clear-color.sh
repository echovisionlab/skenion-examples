#!/usr/bin/env bash
set -euo pipefail

RUNTIME_URL="${SKENION_RUNTIME_URL:-http://127.0.0.1:3761}"
PROJECT="compatibility/v0.1/projects/valid/clear-color-render.project.json"
PATCH="compatibility/v0.1/patches/valid/set-clear-color.patch.json"

curl --fail --silent "${RUNTIME_URL}/health" >/dev/null

curl --fail --silent \
  -H "content-type: application/json" \
  --data @"${PROJECT}" \
  "${RUNTIME_URL}/v0/session/load" >/dev/null

START_RESPONSE="$(curl --fail --silent \
  -H "content-type: application/json" \
  --data '{}' \
  "${RUNTIME_URL}/v0/session/preview/start")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["state"] == "running"; assert r["stale"] is False' "${START_RESPONSE}"

PATCH_RESPONSE="$(curl --fail --silent \
  -H "content-type: application/json" \
  --data @"${PATCH}" \
  "${RUNTIME_URL}/v0/session/patch")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["applied"] is True' "${PATCH_RESPONSE}"

STATUS_RESPONSE="$(curl --fail --silent "${RUNTIME_URL}/v0/session/preview")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["state"] == "running"; assert r["stale"] is True' "${STATUS_RESPONSE}"

RESTART_RESPONSE="$(curl --fail --silent -X POST "${RUNTIME_URL}/v0/session/preview/restart")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["state"] == "running"; assert r["stale"] is False; assert r["previewSessionRevision"] == r["sessionRevision"]' "${RESTART_RESPONSE}"

STOP_RESPONSE="$(curl --fail --silent -X POST "${RUNTIME_URL}/v0/session/preview/stop")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["state"] == "stopped"; assert r["stale"] is False' "${STOP_RESPONSE}"
