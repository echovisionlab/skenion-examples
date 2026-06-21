#!/usr/bin/env bash
set -euo pipefail

RUNTIME_URL="${SKENION_RUNTIME_URL:-http://127.0.0.1:3761}"
PROJECT="compatibility/v0.1/projects/valid/minimal-value.project.json"
PATCH="compatibility/v0.1/patches/valid/set-value-param.patch.json"

curl --fail --silent "${RUNTIME_URL}/health" >/dev/null

curl --fail --silent \
  -H "content-type: application/json" \
  --data @"${PROJECT}" \
  "${RUNTIME_URL}/v0/session/load" >/dev/null

PATCH_RESPONSE="$(curl --fail --silent \
  -H "content-type: application/json" \
  --data "$(python3 scripts/runtime-mutation-json.py "${PATCH}")" \
  "${RUNTIME_URL}/v0/session/mutate")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["applied"] is True; assert r["history"]["entries"][-1]["kind"] == "apply"; assert r["history"]["undoDepth"] == 1; assert r["history"]["redoDepth"] == 0' "${PATCH_RESPONSE}"

UNDO_RESPONSE="$(curl --fail --silent -X POST "${RUNTIME_URL}/v0/session/undo")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["applied"] is True; assert r["history"]["entries"][-1]["kind"] == "undo"; assert r["history"]["undoDepth"] == 0; assert r["history"]["redoDepth"] == 1' "${UNDO_RESPONSE}"

REDO_RESPONSE="$(curl --fail --silent -X POST "${RUNTIME_URL}/v0/session/redo")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["applied"] is True; assert r["history"]["entries"][-1]["kind"] == "redo"; assert r["history"]["undoDepth"] == 1; assert r["history"]["redoDepth"] == 0' "${REDO_RESPONSE}"

HISTORY_RESPONSE="$(curl --fail --silent "${RUNTIME_URL}/v0/session/history")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert len(r["entries"]) >= 3; assert [e["kind"] for e in r["entries"][-3:]] == ["apply", "undo", "redo"]; assert r["canUndo"] is True; assert r["canRedo"] is False' "${HISTORY_RESPONSE}"
