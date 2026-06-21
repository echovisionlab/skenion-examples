#!/usr/bin/env bash
set -euo pipefail

RUNTIME_URL="${SKENION_RUNTIME_URL:-http://127.0.0.1:3761}"

curl --fail --silent "${RUNTIME_URL}/health" >/dev/null

DEVICES="$(curl --fail --silent "${RUNTIME_URL}/v0/io/devices")"
python3 - "${DEVICES}" <<'PY'
import json
import sys

response = json.loads(sys.argv[1])
assert isinstance(response["ok"], bool)
assert isinstance(response["devices"], list)
assert isinstance(response["diagnostics"], list)

for device in response["devices"]:
    assert isinstance(device["id"], str) and device["id"]
    assert isinstance(device["name"], str)
    assert device["transportKind"] in {"midi", "hid", "serial", "inline"}
    assert isinstance(device["directions"], list)
    assert all(direction in {"input", "output"} for direction in device["directions"])
    assert isinstance(device["backend"], str)
    assert isinstance(device["stable"], bool)
    if "index" in device:
        assert isinstance(device["index"], int)

if response["ok"] is False:
    assert response["diagnostics"]
PY

echo "validated runtime IO device discovery API smoke"
