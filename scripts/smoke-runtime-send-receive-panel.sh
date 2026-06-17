#!/usr/bin/env bash
set -euo pipefail

RUNTIME_URL="${SKENION_RUNTIME_URL:-http://127.0.0.1:3761}"
PROJECT="compatibility/v0.1/projects/valid/send-receive-panel.project.json"

curl --fail --silent "${RUNTIME_URL}/health" >/dev/null
curl --fail --silent -X DELETE "${RUNTIME_URL}/v0/session" >/dev/null

curl --fail --silent \
  -H "content-type: application/json" \
  --data @"${PROJECT}" \
  "${RUNTIME_URL}/v0/session/load" >/dev/null

SLIDER_RESPONSE="$(curl --fail --silent \
  -H "content-type: application/json" \
  --data '{"nodeId":"slider_speed","portId":"value","value":{"type":"f32","value":1.5}}' \
  "${RUNTIME_URL}/v0/session/control/event")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["emitted"] == [{"nodeId":"slider_speed","portId":"value","value":{"type":"f32","value":1.5}}]' "${SLIDER_RESPONSE}"

SEND_SPEED_RESPONSE="$(curl --fail --silent \
  -H "content-type: application/json" \
  --data '{"nodeId":"send_speed","portId":"in","value":{"type":"f32","value":1.5}}' \
  "${RUNTIME_URL}/v0/session/control/event")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["emitted"] == [{"nodeId":"send_speed","portId":"in","value":{"type":"f32","value":1.5}}]' "${SEND_SPEED_RESPONSE}"

TOGGLE_RESPONSE="$(curl --fail --silent \
  -H "content-type: application/json" \
  --data '{"nodeId":"toggle_enabled","portId":"value","value":{"type":"bang"}}' \
  "${RUNTIME_URL}/v0/session/control/event")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["emitted"] == [{"nodeId":"toggle_enabled","portId":"value","value":{"type":"bool","value":False}}]' "${TOGGLE_RESPONSE}"

SEND_BOOL_RESPONSE="$(curl --fail --silent \
  -H "content-type: application/json" \
  --data '{"nodeId":"send_enabled","portId":"in","value":{"type":"bool","value":false}}' \
  "${RUNTIME_URL}/v0/session/control/event")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["emitted"] == [{"nodeId":"send_enabled","portId":"in","value":{"type":"bool","value":False}}]' "${SEND_BOOL_RESPONSE}"

STATE_RESPONSE="$(curl --fail --silent "${RUNTIME_URL}/v0/session/control/state")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["channels"]["number.f32:speed"] == {"type":"f32","value":1.5}; assert r["channels"]["boolean:enabled"] == {"type":"bool","value":False}' "${STATE_RESPONSE}"

START_RESPONSE="$(curl --fail --silent \
  -H "content-type: application/json" \
  --data '{}' \
  "${RUNTIME_URL}/v0/session/preview/start")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["state"] == "running"; assert r["stale"] is False' "${START_RESPONSE}"

TELEMETRY_RESPONSE="$(curl --fail --silent "${RUNTIME_URL}/v0/session/telemetry")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["preview"]["state"] == "running"; assert r["render"]["renderer"] in ("fullscreen-shader", "dry-run")' "${TELEMETRY_RESPONSE}"

curl --fail --silent -X POST "${RUNTIME_URL}/v0/session/preview/stop" >/dev/null
curl --fail --silent -X DELETE "${RUNTIME_URL}/v0/session" >/dev/null
