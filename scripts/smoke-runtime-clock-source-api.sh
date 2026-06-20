#!/usr/bin/env bash
set -euo pipefail

RUNTIME_URL="${SKENION_RUNTIME_URL:-http://127.0.0.1:3761}"
PROJECT="compatibility/v0.1/projects/valid/minimal-value.project.json"
INVALID_SOURCE_ID="m05-4-invalid-start"
UNKNOWN_SOURCE_ID="m05-4-missing-source"

curl --fail --silent "${RUNTIME_URL}/health" >/dev/null
curl --fail --silent -X DELETE "${RUNTIME_URL}/v0/session" >/dev/null

SOURCES_BEFORE="$(curl --fail --silent "${RUNTIME_URL}/v0/clock/sources")"
python3 - "${SOURCES_BEFORE}" <<'PY'
import json
import sys
response = json.loads(sys.argv[1])
assert response["ok"] is True
assert isinstance(response["sources"], list)
assert isinstance(response["diagnostics"], list)
PY

INPUTS="$(curl --fail --silent "${RUNTIME_URL}/v0/clock/midi/inputs")"
python3 - "${INPUTS}" <<'PY'
import json
import sys
response = json.loads(sys.argv[1])
assert isinstance(response["ok"], bool)
assert isinstance(response["inputs"], list)
assert isinstance(response["diagnostics"], list)
for descriptor in response["inputs"]:
    assert isinstance(descriptor["index"], int)
    assert isinstance(descriptor["name"], str)
    assert descriptor["backend"] == "midir"
    assert descriptor["id"] is None
    assert descriptor["stable"] is False
if response["ok"] is False:
    assert any(diagnostic["code"] == "midi-input-enumeration-failed" for diagnostic in response["diagnostics"])
PY

MISSING_READ="$(curl --fail --silent "${RUNTIME_URL}/v0/clock/sources/${UNKNOWN_SOURCE_ID}")"
python3 - "${MISSING_READ}" <<'PY'
import json
import sys
response = json.loads(sys.argv[1])
assert response["ok"] is False
assert response["source"] is None
assert response["diagnostics"][0]["code"] == "clock-source-not-found"
PY

INVALID_START="$(curl --fail --silent \
  -H "content-type: application/json" \
  --data "{\"sourceId\":\"${INVALID_SOURCE_ID}\",\"inputPortIndex\":65535}" \
  "${RUNTIME_URL}/v0/clock/midi/start")"
python3 - "${INVALID_START}" <<'PY'
import json
import sys
response = json.loads(sys.argv[1])
assert response["ok"] is False
assert response["source"] is None
codes = [diagnostic["code"] for diagnostic in response["diagnostics"]]
assert "invalid-midi-input-port" in codes or "midi-input-enumeration-failed" in codes
PY

SOURCES_AFTER_INVALID="$(curl --fail --silent "${RUNTIME_URL}/v0/clock/sources")"
python3 - "${SOURCES_BEFORE}" "${SOURCES_AFTER_INVALID}" "${INVALID_SOURCE_ID}" <<'PY'
import json
import sys
before = json.loads(sys.argv[1])
after = json.loads(sys.argv[2])
invalid_source_id = sys.argv[3]
assert after["ok"] is True
assert [source["sourceId"] for source in after["sources"]] == [source["sourceId"] for source in before["sources"]]
assert invalid_source_id not in [source["sourceId"] for source in after["sources"]]
PY

STOP_UNKNOWN="$(curl --fail --silent \
  -H "content-type: application/json" \
  --data "{\"sourceId\":\"${UNKNOWN_SOURCE_ID}\"}" \
  "${RUNTIME_URL}/v0/clock/midi/stop")"
python3 - "${STOP_UNKNOWN}" <<'PY'
import json
import sys
response = json.loads(sys.argv[1])
assert response["ok"] is False
assert response["source"] is None
assert response["diagnostics"][0]["code"] == "clock-source-not-found"
PY

LOAD_RESPONSE="$(curl --fail --silent \
  -H "content-type: application/json" \
  --data @"${PROJECT}" \
  "${RUNTIME_URL}/v0/session/load")"
python3 - "${LOAD_RESPONSE}" <<'PY'
import json
import sys
response = json.loads(sys.argv[1])
assert response["ok"] is True
assert response["loaded"] is True
PY

SOURCES_AFTER_LOAD="$(curl --fail --silent "${RUNTIME_URL}/v0/clock/sources")"
python3 - "${SOURCES_BEFORE}" "${SOURCES_AFTER_LOAD}" <<'PY'
import json
import sys
before = json.loads(sys.argv[1])
after = json.loads(sys.argv[2])
assert after["ok"] is True
assert [source["sourceId"] for source in after["sources"]] == [source["sourceId"] for source in before["sources"]]
PY

curl --fail --silent -X DELETE "${RUNTIME_URL}/v0/session" >/dev/null

echo "validated runtime clock source API smoke"
