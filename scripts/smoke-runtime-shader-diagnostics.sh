#!/usr/bin/env bash
set -euo pipefail

RUNTIME_URL="${SKENION_RUNTIME_URL:-http://127.0.0.1:3761}"
PROJECT="compatibility/v0.1/projects/valid/dynamic-shader-interface.project.json"
BAD_SHADER_PATCH="compatibility/v0.1/patches/valid/set-invalid-fullscreen-shader-source.patch.json"

curl --fail --silent "${RUNTIME_URL}/health" >/dev/null
curl --fail --silent -X DELETE "${RUNTIME_URL}/v0/session" >/dev/null

curl --fail --silent \
  -H "content-type: application/json" \
  --data @"${PROJECT}" \
  "${RUNTIME_URL}/v0/session/load" >/dev/null

GENERATED="$(curl --fail --silent "${RUNTIME_URL}/v0/session/render/generated-shader")"
python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["nodeId"] == "shader_1"; assert "struct SkenionFrame" in r["source"]; assert r["sourceMap"]["userSourceStartLine"] > 1; assert r["diagnostics"] == []' "${GENERATED}"

PATCH_RESPONSE="$(curl --fail --silent \
  -H "content-type: application/json" \
  --data @"${BAD_SHADER_PATCH}" \
  "${RUNTIME_URL}/v0/session/patch")"
python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["applied"] is True' "${PATCH_RESPONSE}"

BAD_GENERATED="$(curl --fail --silent "${RUNTIME_URL}/v0/session/render/generated-shader")"
python3 -c 'import json, sys; r=json.loads(sys.argv[1]); d=r["diagnostics"][0]; assert r["ok"] is False; assert d["phase"] == "interface-analysis"; assert d["code"] == "unsupported-uniform-type"; assert d["line"] == 1; assert d["source"] == "user"' "${BAD_GENERATED}"

curl --fail --silent \
  -H "content-type: application/json" \
  --data '{}' \
  "${RUNTIME_URL}/v0/session/preview/start" >/dev/null

TELEMETRY="$(curl --fail --silent "${RUNTIME_URL}/v0/session/telemetry")"
python3 -c 'import json, sys; r=json.loads(sys.argv[1]); d=r["render"]["diagnostics"][0]; assert r["ok"] is True; assert r["render"]["active"] is True; assert d["phase"] == "interface-analysis"; assert d["code"] == "unsupported-uniform-type"; assert r["render"]["generatedSourceAvailable"] is False' "${TELEMETRY}"

curl --fail --silent -X POST "${RUNTIME_URL}/v0/session/preview/stop" >/dev/null
curl --fail --silent -X DELETE "${RUNTIME_URL}/v0/session" >/dev/null
