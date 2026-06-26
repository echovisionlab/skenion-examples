# skenion Examples

Example scenes, fixtures, sample projects, public assets, and compatibility samples for skenion.

Code is Apache-2.0 by default; asset-specific licenses must be declared beside assets.

## Compatibility Fixtures

Active product examples use the current graph 0.1 contract shape. The
`compatibility/v0.1`, `projects/v0.1`, and `tutorials/v0.1` directories are the
active fixture sets for ProjectDocumentV01, GraphDocumentV01,
PatchDefinitionV01, graph fragments, live help, runtime operations, and
collaboration wire examples.

Valid fixtures must pass both JSON schema validation and runtime contract
loading. Invalid fixtures must fail for the expected reason.

Unsupported pre-consolidation material is isolated under
`compatibility/unsupported/pre-consolidation-v0.1`,
`projects/unsupported/pre-consolidation-v0.1`,
`tutorials/unsupported/pre-consolidation-v0.1`, and
`fixtures/unsupported/pre-consolidation-v0.1`. Those files are excluded from
current contract validation and are not normal examples.

Active runtime project payload fixtures live under `compatibility/v0.1/projects`
and use current graph 0.1 contracts. The runtime JSON validation scripts use
the installed `@skenion/contracts` dependency by default, even when a sibling
Contracts checkout exists under `.deps/skenion-contracts`. Local source
integration is explicit: set `SKENION_USE_LOCAL_CONTRACTS=1` to consume the
built `.deps/skenion-contracts/packages/ts/dist/index.js`, or set
`SKENION_CONTRACTS_PACKAGE` to a specific built package entry. Release mode
rejects both local Contracts settings and a present `.deps/skenion-contracts`
checkout so release conformance fails closed instead of using sibling artifacts.

Current 0.1 Runtime project smoke checks live in
`scripts/smoke-runtime-v01-projects.sh`. The script validates current 0.1
runtime project payloads against `/v0/validate`, loads a ProjectDocumentV01 into
the explicit default Runtime session at `/v0/sessions/default/load`, then checks
`/v0/sessions/default/validate`, `/v0/sessions/default/plan`, and
`/v0/sessions/default/run`.

Runtime multi-session and multi-view smoke fixtures live under
`compatibility/v0.1/runtime-session-fixtures`.
Validate them with `scripts/validate-runtime-session-smoke-fixtures.mjs`; when
`SKENION_RUNTIME_URL` is set, the script checks explicit
`/v0/sessions/{sessionId}` addressing, same-session event replay,
separate-session isolation, sidecar startup/health payloads, and
remote/local-neutral URL composition against a running Runtime.

Unsupported pre-consolidation HTTP smoke scripts skip themselves when the
connected Runtime advertises current `session.load.v0.1`.

Unsupported pre-consolidation Runtime smoke scripts remain only as historical
manual references and are excluded from active Examples CI. Current CI runs
`scripts/smoke-runtime-v01-projects.sh` for the active graph 0.1 project
surface. Those quarantined scripts may still mention the removed `/v0/session`
default-session alias because they document unsupported pre-consolidation
behavior, not current Runtime behavior.

Runtime IO device discovery smoke checks live in
`scripts/smoke-runtime-io-device-api.sh`. The script verifies the raw device
discovery response shape used by node/object parameter editors. It does not
start, stop, or semantically decode MIDI, HID, or Serial input.

The `compatibility/v0.1` directory also includes M06.75 subpatch and live-help
fixtures. These reserve explicit subpatch boundary ports, Manual version lookup
metadata, graph fragment copy/paste fixtures, current target paths, and invalid
boundary fan-in diagnostics while keeping runtime IO and clock behavior owned
by node/object instances.

M06.82 realtime collaboration wire fixtures live under
`compatibility/v0.1/collaboration`. They cover operation batches, convergence
and conflict stories, accepted/duplicate/rejected/rebased results, presence,
selection, collaboration event envelopes, and actor-scoped undo metadata using
the released `@skenion/contracts` validators.

## Extension Packages

Extension package examples live under `extensions/`. Each package owns a
directory with `skenion.extension.json` at the root. First-party core-style
packages and third-party packages use the same manifest shape.

- `extensions/core-value` is a loadable `core-package` example with help and
  node test fixtures.
- `extensions/native-sensor` is a Rust `cdylib` skeleton. Build it from that
  directory, then point `SKENION_EXTENSION_PATH` at the package directory so
  Runtime can validate the manifest and artifact path.

## Tutorials

Active learning-oriented tutorial projects live under `tutorials/v0.1`. They
are `ProjectDocumentV01` fixtures with current graph 0.1 patch libraries where needed,
so Studio can open them directly as example projects and help patches.
`tutorials.manifest.json` indexes tutorial title, summary, tags, and active
project paths.

Compatibility fixtures prove cross-repo contracts. Tutorial projects teach
patch authoring and are validated against the same contracts package.

Run local validation with:

```sh
pnpm install --frozen-lockfile
node scripts/validate-with-contracts.mjs
node scripts/validate-runtime-project-payloads.mjs
node scripts/validate-runtime-session-smoke-fixtures.mjs
SKENION_USE_LOCAL_CONTRACTS=1 node scripts/validate-with-contracts.mjs
SKENION_CONTRACTS_DIR=/Volumes/dev/skenion/skenion-contracts node scripts/audit-node-conventions.mjs
bash scripts/validate-with-runtime.sh /Volumes/dev/skenion/skenion-runtime
SKENION_RUNTIME_URL=http://127.0.0.1:3761 bash scripts/smoke-runtime-v01-projects.sh
```

## Compatibility Matrix Conformance

The `Release Examples Compatibility` workflow is the matrix-controlled release
path for this repository. It accepts a Contracts line such as `0.45`, a
compatibility matrix repository/ref/path, and an Examples target ref. Contracts
line `0.45` means `>=0.45.0 <0.46.0`.

Release mode installs the matrix-recorded `@skenion/contracts` and
`@skenion/sdk` packages from npm. Those versions do not need to be equal, but
the released SDK package must declare an `@skenion/contracts` range that
contains the matrix-recorded Contracts package version. Studio-compatible
project and help fixtures are then validated through the released SDK helpers.

The matrix also records released Runtime, Studio, Docs, and Examples evidence.
Runtime and Studio artifact metadata must point at exact component release tags;
publish/verify mode requires required gates to be passed and release-blocking
artifact checksums to be pinned. The selected Runtime binary is downloaded from
the Runtime GitHub release, checked against the matrix SHA-256, extracted, and
used for CLI and server smoke coverage.

Publish/verify mode requires `components.examples.commit` and `target_ref` to
be the same 40-character git SHA, and requires the Examples release tag to be
exactly `skenion-examples-v<version>` with SemVer components that have no
leading zeros. It rejects `.deps`, sibling worktrees, local Runtime or SDK
builds, branch refs such as `main`, `refs/*` names, slashes, arbitrary tag
names, and path-based package overrides so release conformance cannot pass by
using local or sibling artifacts.

Run the compatibility-matrix guardrails locally with:

```sh
node scripts/validate-compatibility-matrix-self-test.mjs
node scripts/validate-compatibility-matrix.mjs --matrix /Volumes/Linear/Skenion/Skenion/releases/compatibility/0.45.json --contracts-line 0.45 --mode prepare --runtime-target x86_64-unknown-linux-gnu --target-ref skenion-examples-v0.45.0 --matrix-repository skenion/skenion --out-dir .skenion-matrix
```

The prepare-mode matrix check accepts pending release gates and unpinned Studio
checksums while still requiring a concrete Contracts package inside the
Contracts line, a compatible SDK range, current kebab-case Runtime artifact
names, exact component release tags, registry package identities, and no local
or sibling artifact sources.

## Status

Bootstrap repository for the skenion project. Implementation follows the public architecture and release rules defined in [skenion/skenion](https://github.com/skenion/skenion).

## License And Credit

This repository is licensed under the Apache License, Version 2.0.

Redistributions must preserve copyright, license, and NOTICE information as required by Apache-2.0. If skenion helps your artwork, research, publication, installation, or tool, please credit skenion.
