#!/usr/bin/env bash
set -euo pipefail

runtime_dir="${1:-.deps/skenion-runtime}"
manifest_path="${runtime_dir}/Cargo.toml"
runtime_bin="${SKENION_RUNTIME_BIN:-}"
fixture_dir="compatibility/v0.1/runtime-midi-clock-fixtures"

if [[ -n "${runtime_bin}" && ! -x "${runtime_bin}" ]]; then
  echo "runtime binary is not executable at ${runtime_bin}" >&2
  exit 1
fi

if [[ -z "${runtime_bin}" && ! -f "${manifest_path}" ]]; then
  echo "missing runtime Cargo.toml at ${manifest_path}" >&2
  exit 1
fi

run_runtime() {
  if [[ -n "${runtime_bin}" ]]; then
    "${runtime_bin}" "$@"
  else
    cargo run --quiet --manifest-path "${manifest_path}" -- "$@"
  fi
}

runtime_supports() {
  local command="$1"
  run_runtime --help | grep -q "${command}"
}

if ! runtime_supports "clock-midi"; then
  echo "runtime does not support clock-midi fixture simulation yet" >&2
  exit 1
fi

clock_midi_json() {
  local fixture="$1"
  run_runtime clock-midi --simulate "${fixture}" --format json
}

START_STOP="$(clock_midi_json "${fixture_dir}/valid/runtime-midi-start-stop.midiclock.json")"
python3 - "${START_STOP}" <<'PY'
import json
import sys
report = json.loads(sys.argv[1])
state = report["latestSnapshot"]["clockState"]
assert report["eventCount"] == 3
assert report["latestSnapshot"]["songPositionSource"] == "tick-accumulated"
assert state["running"]["value"] is False
assert state["running"]["authority"] == "authoritative"
assert state["songPositionSixteenth"]["authority"] == "derived"
assert state["tempoBpm"]["value"] is None
assert state["tempoBpm"]["authority"] == "unavailable"
PY

VALID_METER="$(clock_midi_json "${fixture_dir}/valid/runtime-midi-spp-valid-meter.midiclock.json")"
python3 - "${VALID_METER}" <<'PY'
import json
import sys
report = json.loads(sys.argv[1])
state = report["latestSnapshot"]["clockState"]
assert report["latestSnapshot"]["songPositionSource"] == "spp"
assert state["songPositionSixteenth"]["value"] == 16
assert state["songPositionSixteenth"]["authority"] == "authoritative"
assert state["bar"]["value"] == 2
assert state["bar"]["authority"] == "derived"
assert state["beat"]["value"] == 1
assert state["beat"]["authority"] == "derived"
assert state["timecode"]["value"] is None
assert state["timecode"]["authority"] == "unavailable"
PY

METERLESS="$(clock_midi_json "${fixture_dir}/valid/runtime-midi-spp-meterless.midiclock.json")"
python3 - "${METERLESS}" <<'PY'
import json
import sys
report = json.loads(sys.argv[1])
state = report["latestSnapshot"]["clockState"]
assert report["latestSnapshot"]["songPositionSource"] == "spp"
assert state["songPositionSixteenth"]["authority"] == "authoritative"
assert state["bar"]["value"] is None
assert state["bar"]["authority"] == "unavailable"
assert state["beat"]["value"] is None
assert state["beat"]["authority"] == "unavailable"
PY

CONTINUE_WITHOUT_SPP="$(clock_midi_json "${fixture_dir}/valid/runtime-midi-continue-without-spp.midiclock.json")"
python3 - "${CONTINUE_WITHOUT_SPP}" <<'PY'
import json
import sys
report = json.loads(sys.argv[1])
state = report["latestSnapshot"]["clockState"]
assert report["latestSnapshot"]["songPositionSource"] == "unknown"
assert state["running"]["value"] is True
assert state["songPositionSixteenth"]["value"] is None
assert state["songPositionSixteenth"]["authority"] == "unavailable"
PY

INVALID_SPP="$(clock_midi_json "${fixture_dir}/invalid/runtime-midi-invalid-spp.midiclock.json")"
python3 - "${INVALID_SPP}" <<'PY'
import json
import sys
report = json.loads(sys.argv[1])
codes = [diagnostic["code"] for diagnostic in report["diagnostics"]]
assert "invalid-midi-song-position-pointer" in codes
assert report["latestSnapshot"]["songPositionSource"] == "unknown"
PY

echo "validated runtime MIDI Clock fixture smoke"
