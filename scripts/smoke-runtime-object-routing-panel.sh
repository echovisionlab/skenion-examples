#!/usr/bin/env bash
set -euo pipefail

RUNTIME_URL="${SKENION_RUNTIME_URL:-http://127.0.0.1:3761}"
PROJECT="compatibility/v0.1/projects/valid/object-routing-panel.project.json"

curl --fail --silent "${RUNTIME_URL}/health" >/dev/null
curl --fail --silent -X DELETE "${RUNTIME_URL}/v0/session" >/dev/null

curl --fail --silent \
  -H "content-type: application/json" \
  --data @"${PROJECT}" \
  "${RUNTIME_URL}/v0/session/load" >/dev/null

SLIDER_RESPONSE="$(curl --fail --silent \
  -H "content-type: application/json" \
  --data '{"nodeId":"slider_speed","portId":"value","message":{"selector":"float","atoms":[{"type":"float","representation":"f32","value":1.5}]}}' \
  "${RUNTIME_URL}/v0/session/control/event")"

python3 -c 'import json, sys
r=json.loads(sys.argv[1])
assert r["ok"] is True
assert r["changed"] is True
assert r["controlRevision"] == 1
assert r["emitted"] == [{"nodeId":"slider_speed","portId":"value","message":{"selector":"float","atoms":[{"type":"float","representation":"f32","value":1.5}]}}]
' "${SLIDER_RESPONSE}"

TOGGLE_RESPONSE="$(curl --fail --silent \
  -H "content-type: application/json" \
  --data '{"nodeId":"toggle_enabled","portId":"value","message":{"selector":"bang","atoms":[]}}' \
  "${RUNTIME_URL}/v0/session/control/event")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["changed"] is True; assert r["controlRevision"] == 2; assert r["emitted"] == [{"nodeId":"toggle_enabled","portId":"value","message":{"selector":"bool","atoms":[{"type":"bool","value":False}]}}]' "${TOGGLE_RESPONSE}"

STATE_RESPONSE="$(curl --fail --silent "${RUNTIME_URL}/v0/session/control/state")"

python3 -c 'import json, sys
r=json.loads(sys.argv[1])
assert r["ok"] is True
if "controlRevision" in r:
    assert r["controlRevision"] == 2
assert r["channels"]["number.float:speed"] == {"selector":"float","atoms":[{"type":"float","representation":"f32","value":1.5}]}
assert r["channels"]["boolean:enabled"] == {"selector":"bool","atoms":[{"type":"bool","value":False}]}
' "${STATE_RESPONSE}"

START_RESPONSE="$(curl --fail --silent \
  -H "content-type: application/json" \
  --data '{}' \
  "${RUNTIME_URL}/v0/session/preview/start")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["state"] == "running"; assert r["stale"] is False' "${START_RESPONSE}"

TELEMETRY_RESPONSE="$(curl --fail --silent "${RUNTIME_URL}/v0/session/telemetry")"

python3 -c 'import json, sys
r=json.loads(sys.argv[1])
assert r["ok"] is True
if "controlRevision" in r["session"]:
    assert r["session"]["controlRevision"] == 2
assert r["preview"]["state"] == "running"
assert r["render"]["renderer"] in (None, "fullscreen-shader", "dry-run")
' "${TELEMETRY_RESPONSE}"

curl --fail --silent -X POST "${RUNTIME_URL}/v0/session/preview/stop" >/dev/null
curl --fail --silent -X DELETE "${RUNTIME_URL}/v0/session" >/dev/null
