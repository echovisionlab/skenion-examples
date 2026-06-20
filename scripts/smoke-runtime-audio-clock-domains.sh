#!/usr/bin/env bash
set -euo pipefail

runtime_dir="${1:-.deps/skenion-runtime}"
manifest_path="${runtime_dir}/Cargo.toml"
runtime_bin="${SKENION_RUNTIME_BIN:-}"
nodes_dir="compatibility/v0.1/nodes"
valid_dir="compatibility/v0.1/audio-clock-domains/valid"
invalid_dir="compatibility/v0.1/audio-clock-domains/invalid"

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

audio_plan_json() {
  local graph="$1"
  run_runtime audio-plan --graph "${graph}" --nodes "${nodes_dir}" --format json
}

SAME_CLOCK_PLAN="$(audio_plan_json "${valid_dir}/audio-input-output-same-clock.graph.json")"
python3 - "${SAME_CLOCK_PLAN}" <<'PY'
import json
import sys
plan = json.loads(sys.argv[1])
bridges = plan["bridgePlans"]
assert len(plan["endpoints"]) == 2
assert len(plan["clockDomains"]) == 1
assert len(bridges) == 1
assert bridges[0]["method"] == "direct"
assert bridges[0]["required"] is False
PY

CLOCK_BRIDGE_PLAN="$(audio_plan_json "${valid_dir}/audio-input-output-clock-bridge.graph.json")"
python3 - "${CLOCK_BRIDGE_PLAN}" <<'PY'
import json
import sys
plan = json.loads(sys.argv[1])
bridges = plan["bridgePlans"]
assert len(bridges) == 1
assert bridges[0]["method"] == "clock-bridge"
assert bridges[0]["required"] is True
assert bridges[0]["bridgeNodeId"] == "bridge_1"
PY

RESAMPLE_PLAN="$(audio_plan_json "${valid_dir}/audio-input-output-resample.graph.json")"
python3 - "${RESAMPLE_PLAN}" <<'PY'
import json
import sys
plan = json.loads(sys.argv[1])
bridges = plan["bridgePlans"]
assert len(bridges) == 1
assert bridges[0]["method"] == "resample"
assert bridges[0]["required"] is True
assert bridges[0]["bridgeNodeId"] == "resample_1"
PY

if run_runtime audio-plan \
  --graph "${invalid_dir}/independent-input-output-without-bridge.graph.json" \
  --nodes "${nodes_dir}" \
  --format json >/tmp/skenion-audio-clock-domain-invalid.out 2>/tmp/skenion-audio-clock-domain-invalid.err; then
  echo "expected independent audio clock-domain crossing to fail without bridge/resample" >&2
  exit 1
fi

if ! grep -q "requires audio.clock-bridge or audio.resample" /tmp/skenion-audio-clock-domain-invalid.err; then
  echo "expected missing bridge/resample diagnostic" >&2
  cat /tmp/skenion-audio-clock-domain-invalid.err >&2
  exit 1
fi

rm -f /tmp/skenion-audio-clock-domain-invalid.out /tmp/skenion-audio-clock-domain-invalid.err

echo "validated runtime audio clock-domain planning fixtures"
