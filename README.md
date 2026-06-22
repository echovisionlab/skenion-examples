# Skenion Examples

Example scenes, fixtures, sample projects, public assets, and compatibility samples for Skenion.

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
and use current graph 0.1 contracts. The runtime JSON validation scripts import
the generated Contracts package from `.deps/skenion-contracts` when that
checkout is present, falling back to the installed `@skenion/contracts`
dependency for standalone local runs.

Runtime session smoke checks live in `scripts/smoke-runtime-session.sh`. The
script loads the valid minimal project into `/v0/session/load`, runs the loaded
session through `/v0/session/run`, verifies that an invalid load returns
`ok:false` without clearing the existing session, and then clears the session.

Runtime graph patch smoke checks live in `scripts/smoke-runtime-patch.sh`. The
script loads the valid minimal project, applies a `GraphPatch v0.1` document
through the `/v0/session/mutate` graph-patch envelope, verifies the
runtime-assigned graph revision, and then verifies that a stale `baseRevision`
returns a conflict without mutating the session.

Runtime mutation history smoke checks live in
`scripts/smoke-runtime-history.sh`. The script loads the valid minimal project,
applies a graph patch through `/v0/session/mutate`, verifies the accepted
Runtime history entry, then calls `/v0/session/undo`, `/v0/session/redo`, and
`/v0/session/history` to confirm global mutation history behavior.

Runtime multi-session and multi-view smoke fixtures live under
`compatibility/v0.1/runtime-session-fixtures`.
Validate them with `scripts/validate-runtime-session-smoke-fixtures.mjs`; when
`SKENION_RUNTIME_URL` is set, the script also checks the default-session alias,
explicit `/v0/sessions/{sessionId}` addressing, same-session event replay,
separate-session isolation, sidecar startup/health payloads, and
remote/local-neutral URL composition against a running Runtime.

Runtime preview lifecycle smoke checks live in
`scripts/smoke-runtime-preview.sh`. The script loads the valid minimal project,
starts dry-run local preview through `/v0/session/preview/start`, applies a
patch to verify stale preview status, restarts preview to refresh it, and then
stops preview.

Current 0.1 Runtime project smoke checks live in
`scripts/smoke-runtime-v01-projects.sh`. The script validates current 0.1
runtime project payloads against `/v0/validate`, loads a ProjectDocumentV01 into
the active Runtime session, then checks session validate, plan, and run.
Unsupported pre-consolidation HTTP smoke scripts skip themselves when the
connected Runtime advertises current `session.load.v0.1`.

Unsupported pre-consolidation Runtime smoke scripts remain only as historical
manual references and are excluded from active Examples CI. Current CI runs
`scripts/smoke-runtime-v01-projects.sh` for the active graph 0.1 project
surface.

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
SKENION_CONTRACTS_DIR=/Volumes/dev/Skenion/Skenion-contracts node scripts/audit-node-conventions.mjs
bash scripts/validate-with-runtime.sh /Volumes/dev/Skenion/Skenion-runtime
SKENION_RUNTIME_URL=http://127.0.0.1:3761 bash scripts/smoke-runtime-v01-projects.sh
```

## Status

Bootstrap repository for the Skenion project. Implementation follows the public architecture and release rules defined in [EchoVisionLab/skenion](https://github.com/echovisionlab/skenion).

## License And Credit

This repository is licensed under the Apache License, Version 2.0.

Redistributions must preserve copyright, license, and NOTICE information as required by Apache-2.0. If Skenion helps your artwork, research, publication, installation, or tool, please credit Skenion and EchoVisionLab.
