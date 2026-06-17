#!/usr/bin/env bash
set -euo pipefail

RUNTIME_URL="${SKENION_RUNTIME_URL:-http://127.0.0.1:3761}"
PROJECT="compatibility/v0.1/projects/valid/fullscreen-shader-multi-uniform.project.json"
VALUE2_PATCH="compatibility/v0.1/patches/valid/set-shader-u-value2.patch.json"
COLOR_PATCH="compatibility/v0.1/patches/valid/set-shader-u-color.patch.json"

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

VALUE2_RESPONSE="$(curl --fail --silent \
  -H "content-type: application/json" \
  --data @"${VALUE2_PATCH}" \
  "${RUNTIME_URL}/v0/session/patch")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["applied"] is True; assert r["graph"]["revision"] == "2"; assert next(n for n in r["graph"]["nodes"] if n["id"] == "value_2")["params"]["value"] == 0.9' "${VALUE2_RESPONSE}"

STATUS="$(curl --fail --silent "${RUNTIME_URL}/v0/session/preview")"
python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["state"] == "running"; assert r["stale"] is True' "${STATUS}"

RESTARTED="$(curl --fail --silent -X POST "${RUNTIME_URL}/v0/session/preview/restart")"
python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["state"] == "running"; assert r["stale"] is False; assert r["previewSessionRevision"] == r["sessionRevision"]' "${RESTARTED}"

COLOR_RESPONSE="$(curl --fail --silent \
  -H "content-type: application/json" \
  --data @"${COLOR_PATCH}" \
  "${RUNTIME_URL}/v0/session/patch")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["applied"] is True; assert r["graph"]["revision"] == "3"; assert next(n for n in r["graph"]["nodes"] if n["id"] == "color_1")["params"]["value"] == [0.2, 0.75, 1.0, 1.0]' "${COLOR_RESPONSE}"

STATUS="$(curl --fail --silent "${RUNTIME_URL}/v0/session/preview")"
python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["state"] == "running"; assert r["stale"] is True' "${STATUS}"

RESTARTED="$(curl --fail --silent -X POST "${RUNTIME_URL}/v0/session/preview/restart")"
python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["state"] == "running"; assert r["stale"] is False; assert r["previewSessionRevision"] == r["sessionRevision"]' "${RESTARTED}"

curl --fail --silent -X POST "${RUNTIME_URL}/v0/session/preview/stop" >/dev/null
curl --fail --silent -X DELETE "${RUNTIME_URL}/v0/session" >/dev/null
