#!/usr/bin/env bash
set -euo pipefail

RUNTIME_URL="${SKENION_RUNTIME_URL:-http://127.0.0.1:3761}"
RUNTIME_URL="${RUNTIME_URL%/}"
SESSION_PATH="/v0/sessions/default"
PROJECT="projects/v0.1/subpatch-boundary.skenion.json"
SMOKE_TMP="$(mktemp -d)"
REQUEST_COUNT=0

cleanup() {
  rm -rf "${SMOKE_TMP}"
}

trap cleanup EXIT

runtime_request() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local url="${RUNTIME_URL}${path}"
  local response_file="${SMOKE_TMP}/response-${REQUEST_COUNT}.json"
  local status
  local curl_exit=0
  REQUEST_COUNT=$((REQUEST_COUNT + 1))

  if [[ -n "${body}" ]]; then
    status="$(curl --silent --show-error \
      --output "${response_file}" \
      --write-out "%{http_code}" \
      -X "${method}" \
      -H "content-type: application/json" \
      --data-binary @"${body}" \
      "${url}")" || curl_exit=$?
  else
    status="$(curl --silent --show-error \
      --output "${response_file}" \
      --write-out "%{http_code}" \
      -X "${method}" \
      "${url}")" || curl_exit=$?
  fi

  if [[ "${curl_exit}" -ne 0 || "${status}" -lt 200 || "${status}" -ge 300 ]]; then
    echo "runtime request failed: ${method} ${path}" >&2
    echo "url: ${url}" >&2
    echo "status: ${status}" >&2
    if [[ "${curl_exit}" -ne 0 ]]; then
      echo "curl exit: ${curl_exit}" >&2
    fi
    if [[ -s "${response_file}" ]]; then
      echo "response body:" >&2
      sed 's/^/  /' "${response_file}" >&2
    fi
    if [[ "${curl_exit}" -ne 0 ]]; then
      return "${curl_exit}"
    fi
    return 22
  fi

  cat "${response_file}"
}

runtime_request GET "/health" >/dev/null
SKENION_RUNTIME_URL="${RUNTIME_URL}" node scripts/validate-runtime-project-payloads.mjs >/dev/null

runtime_request DELETE "${SESSION_PATH}" >/dev/null

LOAD_RESPONSE="$(runtime_request POST "${SESSION_PATH}/load" "${PROJECT}")"

python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; p=r["snapshot"]["project"]; assert p["schemaVersion"] == "0.1.0"; assert p["graph"]["schemaVersion"] == "0.1.0"; assert p["patchLibrary"]' "${LOAD_RESPONSE}"

VALIDATE_RESPONSE="$(runtime_request POST "${SESSION_PATH}/validate")"
python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["snapshot"]["project"]["graph"]["schemaVersion"] == "0.1.0"' "${VALIDATE_RESPONSE}"

PLAN_RESPONSE="$(runtime_request POST "${SESSION_PATH}/plan")"
python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["snapshot"]["plan"]["graphId"] == "subpatch-boundary-v01"; assert any(n["nodeId"] == "scale_patch::double" for n in r["snapshot"]["plan"]["nodes"])' "${PLAN_RESPONSE}"

RUN_REQUEST="${SMOKE_TMP}/run-request.json"
printf '{"frames":2}' > "${RUN_REQUEST}"
RUN_RESPONSE="$(runtime_request POST "${SESSION_PATH}/run" "${RUN_REQUEST}")"
python3 -c 'import json, sys; r=json.loads(sys.argv[1]); assert r["ok"] is True; assert r["report"]["frameCount"] == 2; assert r["snapshot"]["project"]["schemaVersion"] == "0.1.0"' "${RUN_RESPONSE}"

runtime_request DELETE "${SESSION_PATH}" >/dev/null

echo "validated current 0.1 Runtime project smoke"
