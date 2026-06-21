#!/usr/bin/env bash
set -euo pipefail

runtime_dir="${1:-.deps/skenion-runtime}"
manifest_path="${runtime_dir}/Cargo.toml"
runtime_bin="${SKENION_RUNTIME_BIN:-}"

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

legacy_valid_graphs=0
legacy_invalid_graphs=0
legacy_valid_nodes=0
legacy_invalid_nodes=0
legacy_valid_projects=0
legacy_invalid_projects=0
active_v02_project_payloads="$(find compatibility/v0.2/projects -name '*.json' | wc -l | tr -d ' ')"

check_valid() {
  local command="$1"
  local file="$2"
  run_runtime "${command}" "${file}" >/dev/null
}

check_invalid() {
  local command="$1"
  local file="$2"
  if run_runtime "${command}" "${file}" >/dev/null 2>&1; then
    echo "${file}: expected invalid, got valid" >&2
    return 1
  fi
}

while IFS= read -r file; do
  check_valid validate-graph "${file}"
  legacy_valid_graphs=$((legacy_valid_graphs + 1))
done < <(find fixtures/contract/v0.1/graphs/valid -name '*.json' | sort)

while IFS= read -r file; do
  check_invalid validate-graph "${file}"
  legacy_invalid_graphs=$((legacy_invalid_graphs + 1))
done < <(find fixtures/contract/v0.1/graphs/invalid -name '*.json' | sort)

while IFS= read -r file; do
  check_valid validate-node "${file}"
  legacy_valid_nodes=$((legacy_valid_nodes + 1))
done < <(find fixtures/contract/v0.1/nodes/valid -name '*.json' | sort)

while IFS= read -r file; do
  check_invalid validate-node "${file}"
  legacy_invalid_nodes=$((legacy_invalid_nodes + 1))
done < <(find fixtures/contract/v0.1/nodes/invalid -name '*.json' | sort)

if runtime_supports validate-project; then
  while IFS= read -r file; do
    run_runtime validate-project --graph "${file}" --nodes compatibility/v0.1/nodes >/dev/null
    legacy_valid_projects=$((legacy_valid_projects + 1))
  done < <(find compatibility/v0.1/graphs/valid -name '*.json' | sort)

  while IFS= read -r file; do
    if run_runtime validate-project --graph "${file}" --nodes compatibility/v0.1/nodes >/dev/null 2>&1; then
      echo "${file}: expected invalid project, got valid" >&2
      exit 1
    fi
    legacy_invalid_projects=$((legacy_invalid_projects + 1))
  done < <(find compatibility/v0.1/graphs/invalid -name '*.json' | sort)

  run_runtime plan \
    --graph compatibility/v0.1/graphs/valid/minimal-value.graph.json \
    --nodes compatibility/v0.1/nodes \
    --format json >/dev/null
else
  echo "runtime does not support registry project validation yet; skipped legacy v0.1 compatibility fixtures"
fi

echo "validated legacy v0.1 fixtures with skenion-runtime: ${legacy_valid_graphs} valid graphs, ${legacy_invalid_graphs} invalid graphs, ${legacy_valid_nodes} valid nodes, ${legacy_invalid_nodes} invalid nodes, ${legacy_valid_projects} valid registry projects, ${legacy_invalid_projects} invalid registry projects"
echo "active v0.2 runtime project payload fixtures are validated by scripts/validate-runtime-project-payloads.mjs with released @skenion/contracts: ${active_v02_project_payloads} JSON fixtures"
