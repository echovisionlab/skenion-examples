#!/usr/bin/env bash
set -euo pipefail

RUNTIME_URL="${SKENION_RUNTIME_URL:-http://127.0.0.1:3761}"
PROJECT="compatibility/v0.1/projects/valid/minimal-value.project.json"
PATCH="compatibility/v0.1/patches/valid/set-value-param.patch.json"
BAD_PATCH="compatibility/v0.1/patches/invalid/wrong-base-revision.patch.json"

curl --fail --silent "${RUNTIME_URL}/health" >/dev/null

curl --fail --silent \
  -H "content-type: application/json" \
  --data @"${PROJECT}" \
  "${RUNTIME_URL}/v0/session/load" >/dev/null

PATCH_RESPONSE="$(curl --fail --silent \
  -H "content-type: application/json" \
  --data @"${PATCH}" \
  "${RUNTIME_URL}/v0/session/patch")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["applied"] is True; assert r["conflict"] is False; assert r["graph"]["revision"] == "2"; assert r["session"]["graphRevision"] == "2"' "${PATCH_RESPONSE}"

BAD_RESPONSE="$(curl --fail --silent \
  -H "content-type: application/json" \
  --data @"${BAD_PATCH}" \
  "${RUNTIME_URL}/v0/session/patch")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is False; assert r["applied"] is False; assert r["conflict"] is True; assert r["graph"]["revision"] == "2"; assert r["session"]["graphRevision"] == "2"' "${BAD_RESPONSE}"
