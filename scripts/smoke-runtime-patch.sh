#!/usr/bin/env bash
set -euo pipefail

RUNTIME_URL="${SKENION_RUNTIME_URL:-http://127.0.0.1:3761}"
source scripts/runtime-smoke-unsupported-v01.sh
skip_unsupported_v01_smoke_if_current_v01 "$0"
PROJECT="compatibility/unsupported/pre-consolidation-v0.1/projects/valid/minimal-value.project.json"
PATCH="compatibility/unsupported/pre-consolidation-v0.1/patches/valid/set-value-param.patch.json"
BAD_PATCH="compatibility/unsupported/pre-consolidation-v0.1/patches/invalid/wrong-base-revision.patch.json"

curl --fail --silent "${RUNTIME_URL}/health" >/dev/null

curl --fail --silent \
  -H "content-type: application/json" \
  --data @"${PROJECT}" \
  "${RUNTIME_URL}/v0/session/load" >/dev/null

PATCH_RESPONSE="$(curl --fail --silent \
  -H "content-type: application/json" \
  --data "$(python3 scripts/runtime-mutation-json.py "${PATCH}")" \
  "${RUNTIME_URL}/v0/session/mutate")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["applied"] is True; assert r["conflict"] is False; assert r["snapshot"]["project"]["graph"]["revision"] == "2"; assert r["snapshot"]["project"]["graph"]["revision"] == "2"' "${PATCH_RESPONSE}"

BAD_RESPONSE="$(curl --fail --silent \
  -H "content-type: application/json" \
  --data "$(python3 scripts/runtime-mutation-json.py "${BAD_PATCH}")" \
  "${RUNTIME_URL}/v0/session/mutate")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is False; assert r["applied"] is False; assert r["conflict"] is True; assert r["snapshot"]["project"]["graph"]["revision"] == "2"; assert r["snapshot"]["project"]["graph"]["revision"] == "2"' "${BAD_RESPONSE}"
