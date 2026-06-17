#!/usr/bin/env bash
set -euo pipefail

RUNTIME_URL="${SKENION_RUNTIME_URL:-http://127.0.0.1:3761}"
PROJECT="compatibility/v0.1/projects/valid/control-layer-demo.project.json"

curl --fail --silent "${RUNTIME_URL}/health" >/dev/null
curl --fail --silent -X DELETE "${RUNTIME_URL}/v0/session" >/dev/null

curl --fail --silent \
  -H "content-type: application/json" \
  --data @"${PROJECT}" \
  "${RUNTIME_URL}/v0/session/load" >/dev/null

TOGGLE_BANG_RESPONSE="$(curl --fail --silent \
  -H "content-type: application/json" \
  --data '{"nodeId":"toggle_1","portId":"bang","value":{"type":"bang"}}' \
  "${RUNTIME_URL}/v0/session/control/event")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["emitted"] == [{"nodeId":"toggle_1","portId":"value","value":{"type":"bool","value":True}}]' "${TOGGLE_BANG_RESPONSE}"

STRING_SET_RESPONSE="$(curl --fail --silent \
  -H "content-type: application/json" \
  --data '{"nodeId":"string_1","portId":"set","value":{"type":"string","value":"armed"}}' \
  "${RUNTIME_URL}/v0/session/control/event")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["emitted"] == []' "${STRING_SET_RESPONSE}"

STRING_BANG_RESPONSE="$(curl --fail --silent \
  -H "content-type: application/json" \
  --data '{"nodeId":"string_1","portId":"bang","value":{"type":"bang"}}' \
  "${RUNTIME_URL}/v0/session/control/event")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["emitted"] == [{"nodeId":"string_1","portId":"value","value":{"type":"string","value":"armed"}}]' "${STRING_BANG_RESPONSE}"

STRING_IN_RESPONSE="$(curl --fail --silent \
  -H "content-type: application/json" \
  --data '{"nodeId":"string_1","portId":"in","value":{"type":"string","value":"running"}}' \
  "${RUNTIME_URL}/v0/session/control/event")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["emitted"] == [{"nodeId":"string_1","portId":"value","value":{"type":"string","value":"running"}}]' "${STRING_IN_RESPONSE}"

MESSAGE_BANG_RESPONSE="$(curl --fail --silent \
  -H "content-type: application/json" \
  --data '{"nodeId":"message_1","portId":"bang","value":{"type":"bang"}}' \
  "${RUNTIME_URL}/v0/session/control/event")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["emitted"] == [{"nodeId":"message_1","portId":"value","value":{"type":"string","value":"perform"}}]' "${MESSAGE_BANG_RESPONSE}"

MESSAGE_SET_RESPONSE="$(curl --fail --silent \
  -H "content-type: application/json" \
  --data '{"nodeId":"message_1","portId":"set","value":{"type":"string","value":"blocked"}}' \
  "${RUNTIME_URL}/v0/session/control/event")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is False; assert r["emitted"] == []; assert r["diagnostics"]' "${MESSAGE_SET_RESPONSE}"

STATE_READ_RESPONSE="$(curl --fail --silent \
  -H "content-type: application/json" \
  --data '{"nodeId":"toggle_1","target":"state","id":"value"}' \
  "${RUNTIME_URL}/v0/session/control/read")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["value"] == {"type":"bool","value":True}' "${STATE_READ_RESPONSE}"

COMMENT_READ_RESPONSE="$(curl --fail --silent \
  -H "content-type: application/json" \
  --data '{"nodeId":"comment_1","target":"param","id":"text"}' \
  "${RUNTIME_URL}/v0/session/control/read")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["value"]["type"] == "json"; assert "Bang fans out" in r["value"]["value"]' "${COMMENT_READ_RESPONSE}"

PORT_READ_RESPONSE="$(curl --fail --silent \
  -H "content-type: application/json" \
  --data '{"nodeId":"string_1","target":"port","id":"value"}' \
  "${RUNTIME_URL}/v0/session/control/read")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["value"]["value"]["id"] == "value"; assert r["value"]["value"]["type"]["dataKind"] == "string"' "${PORT_READ_RESPONSE}"

curl --fail --silent -X DELETE "${RUNTIME_URL}/v0/session" >/dev/null
