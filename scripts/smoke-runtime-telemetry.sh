#!/usr/bin/env bash
set -euo pipefail

RUNTIME_URL="${SKENION_RUNTIME_URL:-http://127.0.0.1:3761}"
PROJECT="compatibility/v0.1/projects/valid/clear-color-render.project.json"
PATCH="compatibility/v0.1/patches/valid/set-clear-color.patch.json"

curl --fail --silent "${RUNTIME_URL}/health" >/dev/null
curl --fail --silent -X DELETE "${RUNTIME_URL}/v0/session" >/dev/null

EMPTY="$(curl --fail --silent "${RUNTIME_URL}/v0/session/telemetry")"
python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["session"]["loaded"] is False; assert r["preview"]["state"] == "stopped"; assert r["render"]["active"] is False' "${EMPTY}"

curl --fail --silent \
  -H "content-type: application/json" \
  --data @"${PROJECT}" \
  "${RUNTIME_URL}/v0/session/load" >/dev/null

LOADED="$(curl --fail --silent "${RUNTIME_URL}/v0/session/telemetry")"
python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["session"]["loaded"] is True; assert r["session"]["graphId"] == "clear-color-render-graph"; assert r["preview"]["state"] == "stopped"' "${LOADED}"

curl --fail --silent \
  -H "content-type: application/json" \
  --data '{}' \
  "${RUNTIME_URL}/v0/session/preview/start" >/dev/null

RUNNING="$(curl --fail --silent "${RUNTIME_URL}/v0/session/telemetry")"
python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["session"]["loaded"] is True; assert r["preview"]["state"] == "running"; assert r["preview"]["stale"] is False; assert r["render"]["active"] is True' "${RUNNING}"

curl --fail --silent \
  -H "content-type: application/json" \
  --data @"${PATCH}" \
  "${RUNTIME_URL}/v0/session/patch" >/dev/null

STALE="$(curl --fail --silent "${RUNTIME_URL}/v0/session/telemetry")"
python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["preview"]["state"] == "running"; assert r["preview"]["stale"] is True; assert r["preview"]["previewSessionRevision"] < r["session"]["sessionRevision"]' "${STALE}"

set +o pipefail
SSE="$(curl --fail --silent --max-time 2 --no-buffer "${RUNTIME_URL}/v0/session/telemetry/stream" | head -n 2)"
set -o pipefail
python3 -c 'import sys; text=sys.argv[1]; assert "event: telemetry" in text; assert "data:" in text' "${SSE}"

curl --fail --silent -X POST "${RUNTIME_URL}/v0/session/preview/stop" >/dev/null
curl --fail --silent -X DELETE "${RUNTIME_URL}/v0/session" >/dev/null
