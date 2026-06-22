#!/usr/bin/env bash
set -euo pipefail

RUNTIME_URL="${SKENION_RUNTIME_URL:-http://127.0.0.1:3761}"
source scripts/runtime-smoke-unsupported-v01.sh
skip_unsupported_v01_smoke_if_current_v01 "$0"
PROJECT="compatibility/unsupported/pre-consolidation-v0.1/projects/valid/dynamic-shader-interface.project.json"
PATCH="compatibility/unsupported/pre-consolidation-v0.1/patches/valid/replace-fullscreen-shader-interface.patch.json"

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

PATCH_RESPONSE="$(curl --fail --silent \
  -H "content-type: application/json" \
  --data "$(python3 scripts/runtime-mutation-json.py "${PATCH}")" \
  "${RUNTIME_URL}/v0/session/mutate")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["applied"] is True; shader=next(n for n in r["snapshot"]["project"]["graph"]["nodes"] if n["id"] == "shader_1"); assert [p["id"] for p in shader["ports"]] == ["speed", "enabled", "iterations", "tint", "out"]' "${PATCH_RESPONSE}"

STATUS="$(curl --fail --silent "${RUNTIME_URL}/v0/session/preview")"
python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["state"] == "running"; assert r["stale"] is True' "${STATUS}"

RESTARTED="$(curl --fail --silent -X POST "${RUNTIME_URL}/v0/session/preview/restart")"
python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["state"] == "running"; assert r["stale"] is False; assert r["previewSessionRevision"] == r["sessionRevision"]' "${RESTARTED}"

curl --fail --silent -X POST "${RUNTIME_URL}/v0/session/preview/stop" >/dev/null
curl --fail --silent -X DELETE "${RUNTIME_URL}/v0/session" >/dev/null
