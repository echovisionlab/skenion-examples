#!/usr/bin/env bash
set -euo pipefail

RUNTIME_URL="${SKENION_RUNTIME_URL:-http://127.0.0.1:3761}"
source scripts/runtime-smoke-legacy-v01.sh
skip_legacy_v01_smoke_if_active_v02 "$0"
PROJECT="compatibility/v0.1/projects/valid/object-routing-panel.project.json"

curl --fail --silent "${RUNTIME_URL}/health" >/dev/null
curl --fail --silent -X DELETE "${RUNTIME_URL}/v0/session" >/dev/null

curl --fail --silent \
  -H "content-type: application/json" \
  --data @"${PROJECT}" \
  "${RUNTIME_URL}/v0/session/load" >/dev/null

START_RESPONSE="$(curl --fail --silent \
  -H "content-type: application/json" \
  --data '{}' \
  "${RUNTIME_URL}/v0/session/preview/start")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["state"] == "running"; assert r["stale"] is False; assert r["controlRevision"] == 0; assert r["previewControlRevision"] == 0; assert r["controlLive"] is True' "${START_RESPONSE}"

SLIDER_RESPONSE="$(curl --fail --silent \
  -H "content-type: application/json" \
  --data '{"nodeId":"slider_speed","portId":"in","message":{"selector":"float","atoms":[{"type":"float","representation":"f32","value":1.5}]}}' \
  "${RUNTIME_URL}/v0/session/control/event")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["changed"] is True; assert r["controlRevision"] == 1; assert r["emitted"][0] == {"nodeId":"slider_speed","portId":"value","message":{"selector":"float","atoms":[{"type":"float","representation":"f32","value":1.5}]}}' "${SLIDER_RESPONSE}"

STATE_AFTER_SLIDER="$(curl --fail --silent "${RUNTIME_URL}/v0/session/control/state")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["controlRevision"] == 1; assert r["channels"]["number.float:speed"] == {"selector":"float","atoms":[{"type":"float","representation":"f32","value":1.5}]}' "${STATE_AFTER_SLIDER}"

TELEMETRY_AFTER_SLIDER="$(curl --fail --silent "${RUNTIME_URL}/v0/session/telemetry")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["session"]["controlRevision"] == 1; assert r["preview"]["stale"] is False; assert r["preview"]["controlRevision"] == 1; assert r["preview"]["previewControlRevision"] == 1; assert r["preview"]["controlLive"] is True; assert r["render"]["controlRevision"] == 1; assert r["render"]["previewControlRevision"] == 1; assert r["render"]["controlLive"] is True' "${TELEMETRY_AFTER_SLIDER}"

TOGGLE_RESPONSE="$(curl --fail --silent \
  -H "content-type: application/json" \
  --data '{"nodeId":"toggle_enabled","portId":"in","message":{"selector":"bang","atoms":[]}}' \
  "${RUNTIME_URL}/v0/session/control/event")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["changed"] is True; assert r["controlRevision"] == 2; assert r["emitted"][0] == {"nodeId":"toggle_enabled","portId":"value","message":{"selector":"bool","atoms":[{"type":"bool","value":False}]}}' "${TOGGLE_RESPONSE}"

STATE_AFTER_TOGGLE="$(curl --fail --silent "${RUNTIME_URL}/v0/session/control/state")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["controlRevision"] == 2; assert r["channels"]["number.float:speed"] == {"selector":"float","atoms":[{"type":"float","representation":"f32","value":1.5}]}; assert r["channels"]["boolean:enabled"] == {"selector":"bool","atoms":[{"type":"bool","value":False}]}' "${STATE_AFTER_TOGGLE}"

STATUS_AFTER_TOGGLE="$(curl --fail --silent "${RUNTIME_URL}/v0/session/preview")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["state"] == "running"; assert r["stale"] is False; assert r["controlRevision"] == 2; assert r["previewControlRevision"] == 2; assert r["controlLive"] is True; assert r["lastControlUpdateAt"] is not None' "${STATUS_AFTER_TOGGLE}"

curl --fail --silent -X POST "${RUNTIME_URL}/v0/session/preview/stop" >/dev/null
curl --fail --silent -X DELETE "${RUNTIME_URL}/v0/session" >/dev/null
