#!/usr/bin/env bash
set -euo pipefail

RUNTIME_URL="${SKENION_RUNTIME_URL:-http://127.0.0.1:3761}"
source scripts/runtime-smoke-unsupported-v01.sh
skip_unsupported_v01_smoke_if_current_v01 "$0"
PROJECT="compatibility/unsupported/pre-consolidation-v0.1/projects/valid/value-semantics-demo.project.json"

curl --fail --silent "${RUNTIME_URL}/health" >/dev/null
curl --fail --silent -X DELETE "${RUNTIME_URL}/v0/session" >/dev/null

curl --fail --silent \
  -H "content-type: application/json" \
  --data @"${PROJECT}" \
  "${RUNTIME_URL}/v0/session/load" >/dev/null

SET_RESPONSE="$(curl --fail --silent \
  -H "content-type: application/json" \
  --data '{"nodeId":"value_1","portId":"in","message":{"selector":"set","atoms":[{"type":"float","representation":"f32","value":32}]}}' \
  "${RUNTIME_URL}/v0/session/control/event")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["emitted"] == []' "${SET_RESPONSE}"

BANG_RESPONSE="$(curl --fail --silent \
  -H "content-type: application/json" \
  --data '{"nodeId":"value_1","portId":"in","message":{"selector":"bang","atoms":[]}}' \
  "${RUNTIME_URL}/v0/session/control/event")"

python3 -c '
import json, sys
r=json.loads(sys.argv[1])
expected={"selector":"float","atoms":[{"type":"float","representation":"f32","value":32.0}]}
assert r["ok"] is True
assert {"nodeId":"value_1","portId":"value","message":expected} in r["emitted"]
assert {"nodeId":"target_1","portId":"value","message":expected} in r["emitted"]
' "${BANG_RESPONSE}"

IN_RESPONSE="$(curl --fail --silent \
  -H "content-type: application/json" \
  --data '{"nodeId":"value_1","portId":"in","message":{"selector":"float","atoms":[{"type":"float","representation":"f32","value":12}]}}' \
  "${RUNTIME_URL}/v0/session/control/event")"

python3 -c '
import json, sys
r=json.loads(sys.argv[1])
expected={"selector":"float","atoms":[{"type":"float","representation":"f32","value":12.0}]}
assert r["ok"] is True
assert {"nodeId":"value_1","portId":"value","message":expected} in r["emitted"]
assert {"nodeId":"target_1","portId":"value","message":expected} in r["emitted"]
' "${IN_RESPONSE}"

STATE_RESPONSE="$(curl --fail --silent "${RUNTIME_URL}/v0/session/control/state")"
python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["values"]["value_1"] == {"type":"float","representation":"f32","value":12.0}; assert r["values"]["target_1"] == {"type":"float","representation":"f32","value":12.0}' "${STATE_RESPONSE}"

WRONG_TYPE_RESPONSE="$(curl --fail --silent \
  -H "content-type: application/json" \
  --data '{"nodeId":"value_1","portId":"in","message":{"selector":"bool","atoms":[{"type":"bool","value":true}]}}' \
  "${RUNTIME_URL}/v0/session/control/event")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is False; assert r["emitted"] == []; assert r["diagnostics"]' "${WRONG_TYPE_RESPONSE}"

curl --fail --silent -X DELETE "${RUNTIME_URL}/v0/session" >/dev/null
