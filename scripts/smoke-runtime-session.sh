#!/usr/bin/env bash
set -euo pipefail

RUNTIME_URL="${SKENION_RUNTIME_URL:-http://127.0.0.1:3761}"
source scripts/runtime-smoke-legacy-v01.sh
skip_legacy_v01_smoke_if_active_v02 "$0"
PROJECT="compatibility/v0.1/projects/valid/minimal-value.project.json"
INVALID="compatibility/v0.1/projects/invalid/missing-definition.project.json"

curl --fail --silent "${RUNTIME_URL}/health" >/dev/null
curl --fail --silent "${RUNTIME_URL}/v0/session" >/dev/null

LOAD_RESPONSE="$(curl --fail --silent \
  -H "content-type: application/json" \
  --data @"${PROJECT}" \
  "${RUNTIME_URL}/v0/session/load")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["snapshot"]["project"] is not None' "${LOAD_RESPONSE}"

RUN_RESPONSE="$(curl --fail --silent \
  -H "content-type: application/json" \
  --data '{"frames":2}' \
  "${RUNTIME_URL}/v0/session/run")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["report"]["frameCount"] == 2' "${RUN_RESPONSE}"

INVALID_RESPONSE="$(curl --fail --silent \
  -H "content-type: application/json" \
  --data @"${INVALID}" \
  "${RUNTIME_URL}/v0/session/load")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is False; assert r["snapshot"]["project"] is not None' "${INVALID_RESPONSE}"

CLEAR_RESPONSE="$(curl --fail --silent -X DELETE "${RUNTIME_URL}/v0/session")"
python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["snapshot"]["project"] is None' "${CLEAR_RESPONSE}"
