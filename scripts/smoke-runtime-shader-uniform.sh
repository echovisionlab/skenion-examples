#!/usr/bin/env bash
set -euo pipefail

RUNTIME_URL="${SKENION_RUNTIME_URL:-http://127.0.0.1:3761}"
PROJECT="compatibility/v0.1/projects/valid/fullscreen-shader-uniform.project.json"
PATCH="compatibility/v0.1/patches/valid/set-float-value-to-0-8.patch.json"

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

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["state"] == "running"; assert r["stale"] is False' "${START_RESPONSE}"

TELEMETRY="$(curl --fail --silent "${RUNTIME_URL}/v0/session/telemetry")"
python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["render"]["active"] is True; assert r["render"]["backend"] == "dry-run"; assert r["render"]["renderer"] == "fullscreen-shader"; assert r["render"]["sourceNodeId"] == "shader_1"' "${TELEMETRY}"

PATCH_RESPONSE="$(curl --fail --silent \
  -H "content-type: application/json" \
  --data @"${PATCH}" \
  "${RUNTIME_URL}/v0/session/patch")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["applied"] is True; assert next(n for n in r["graph"]["nodes"] if n["id"] == "value_1")["params"]["value"] == 0.8' "${PATCH_RESPONSE}"

STATUS="$(curl --fail --silent "${RUNTIME_URL}/v0/session/preview")"
python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["state"] == "running"; assert r["stale"] is True' "${STATUS}"

RESTARTED="$(curl --fail --silent -X POST "${RUNTIME_URL}/v0/session/preview/restart")"
python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["state"] == "running"; assert r["stale"] is False; assert r["previewSessionRevision"] == r["sessionRevision"]' "${RESTARTED}"

curl --fail --silent -X POST "${RUNTIME_URL}/v0/session/preview/stop" >/dev/null
curl --fail --silent -X DELETE "${RUNTIME_URL}/v0/session" >/dev/null
