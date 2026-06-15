#!/usr/bin/env bash
set -euo pipefail

runtime_dir="${1:-.deps/skenion-runtime}"
manifest_path="${runtime_dir}/Cargo.toml"

if [[ ! -f "${manifest_path}" ]]; then
  echo "missing runtime Cargo.toml at ${manifest_path}" >&2
  exit 1
fi

run_runtime() {
  cargo run --quiet --manifest-path "${manifest_path}" -- "$@"
}

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
done < <(find fixtures/contract/v0.1/graphs/valid -name '*.json' | sort)

while IFS= read -r file; do
  check_invalid validate-graph "${file}"
done < <(find fixtures/contract/v0.1/graphs/invalid -name '*.json' | sort)

while IFS= read -r file; do
  check_valid validate-node "${file}"
done < <(find fixtures/contract/v0.1/nodes/valid -name '*.json' | sort)

while IFS= read -r file; do
  check_invalid validate-node "${file}"
done < <(find fixtures/contract/v0.1/nodes/invalid -name '*.json' | sort)

echo "validated contract fixtures with skenion-runtime"
