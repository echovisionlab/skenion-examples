#!/usr/bin/env bash
set -euo pipefail

RUNTIME_URL="${SKENION_RUNTIME_URL:-http://127.0.0.1:3761}"
PROJECT="projects/v0.2/subpatch-boundary.skenion.json"

curl --fail --silent "${RUNTIME_URL}/health" >/dev/null
SKENION_RUNTIME_URL="${RUNTIME_URL}" node scripts/validate-runtime-project-payloads.mjs >/dev/null

curl --fail --silent -X DELETE "${RUNTIME_URL}/v0/session" >/dev/null

LOAD_RESPONSE="$(curl --fail --silent \
  -H "content-type: application/json" \
  --data @"${PROJECT}" \
  "${RUNTIME_URL}/v0/session/load")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; p=r["snapshot"]["project"]; assert p["schemaVersion"] == "0.2.0"; assert p["graph"]["schemaVersion"] == "0.2.0"; assert p["patchLibrary"]' "${LOAD_RESPONSE}"

VALIDATE_RESPONSE="$(curl --fail --silent -X POST "${RUNTIME_URL}/v0/session/validate")"
python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["snapshot"]["project"]["graph"]["schemaVersion"] == "0.2.0"' "${VALIDATE_RESPONSE}"

PLAN_RESPONSE="$(curl --fail --silent -X POST "${RUNTIME_URL}/v0/session/plan")"
python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["snapshot"]["plan"]["graphId"] == "subpatch-boundary-v02"; assert any(n["nodeId"] == "scale_patch::double" for n in r["snapshot"]["plan"]["nodes"])' "${PLAN_RESPONSE}"

RUN_RESPONSE="$(curl --fail --silent \
  -H "content-type: application/json" \
  --data '{"frames":2}' \
  "${RUNTIME_URL}/v0/session/run")"
python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["report"]["frameCount"] == 2; assert r["snapshot"]["project"]["schemaVersion"] == "0.2.0"' "${RUN_RESPONSE}"

curl --fail --silent -X DELETE "${RUNTIME_URL}/v0/session" >/dev/null

echo "validated active v0.2 Runtime project smoke"
