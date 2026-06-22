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

current_valid_project_payloads=0
current_invalid_project_payloads=0
current_valid_project_documents=0
current_planned_projects=0
unsupported_project_payloads="$(find compatibility/unsupported/pre-consolidation-v0.1/projects -name '*.json' | wc -l | tr -d ' ')"

check_valid_project() {
  local file="$1"
  run_runtime validate-project --project "${file}" >/dev/null
}

check_invalid_project() {
  local file="$1"
  if run_runtime validate-project --project "${file}" >/dev/null 2>&1; then
    echo "${file}: expected invalid, got valid" >&2
    return 1
  fi
}

if ! runtime_supports validate-project; then
  echo "runtime does not support current 0.1 project validation" >&2
  exit 1
fi

while IFS= read -r file; do
  check_valid_project "${file}"
  current_valid_project_payloads=$((current_valid_project_payloads + 1))
done < <(find compatibility/v0.1/projects/valid -name '*.json' | sort)

while IFS= read -r file; do
  check_invalid_project "${file}"
  current_invalid_project_payloads=$((current_invalid_project_payloads + 1))
done < <(find compatibility/v0.1/projects/invalid -name '*.json' | sort)

while IFS= read -r file; do
  check_valid_project "${file}"
  current_valid_project_documents=$((current_valid_project_documents + 1))
done < <(find projects/v0.1 -name '*.skenion.json' | sort)

if runtime_supports plan; then
  while IFS= read -r file; do
    run_runtime plan --project "${file}" --format json >/dev/null
    current_planned_projects=$((current_planned_projects + 1))
  done < <(find compatibility/v0.1/projects/valid -name '*.json' | sort)
fi

echo "validated current 0.1 fixtures with skenion-runtime: ${current_valid_project_payloads} valid project payloads, ${current_invalid_project_payloads} invalid project payloads, ${current_valid_project_documents} project documents, ${current_planned_projects} execution plan payloads"
echo "excluded unsupported pre-consolidation project payload fixtures from positive runtime smoke coverage: ${unsupported_project_payloads} JSON fixtures"
