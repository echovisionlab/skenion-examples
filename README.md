# Skenion Examples

Example scenes, fixtures, sample projects, public assets, and compatibility samples for Skenion.

Code is Apache-2.0 by default; asset-specific licenses must be declared beside assets.

## Compatibility Fixtures

Active product examples use graph v0.2. The `compatibility/v0.2`,
`projects/v0.2`, and `tutorials/v0.2` directories are the active fixture sets
for ProjectDocumentV02, GraphDocumentV02, PatchDefinitionV02, graph fragments,
live help, runtime operations, and collaboration wire examples.

The `fixtures/contract/v0.1` directory contains legacy graph documents and node
definition manifests used to verify import/migration compatibility between:

- `skenion-contracts`
- `skenion-sdk`
- `skenion-runtime`
- future `skenion-studio`

Valid fixtures must pass both JSON schema validation and runtime contract
loading. Invalid fixtures must fail for the expected reason.

The `compatibility/v0.1` directory is retained as legacy import and migration
coverage. It contains registry-oriented node definitions and graph documents.
Its invalid graph fixtures are intentionally valid graph documents, but they
must fail project validation or execution planning when a runtime resolves them
against the node registry.

Active runtime project payload fixtures live under `compatibility/v0.2/projects`
and use graph v0.2 contracts. Legacy runtime project payload fixtures remain
under `compatibility/v0.1/projects` for older Runtime HTTP API request shapes
for `/v0/validate`, `/v0/plan`, and `/v0/run`. The runtime JSON validation
scripts intentionally import the released `@skenion/contracts` package instead
of a sibling contracts checkout.

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

Runtime multi-session and multi-view smoke fixtures currently live under
`compatibility/v0.1/runtime-session-fixtures` as legacy session API coverage.
Validate them with `scripts/validate-runtime-session-smoke-fixtures.mjs`; when
`SKENION_RUNTIME_URL` is set, the script also checks the default-session alias,
explicit `/v0/sessions/{sessionId}` addressing, same-session event replay,
separate-session isolation, sidecar startup/health payloads, and
remote/local-neutral URL composition against a running Runtime. Active v0.2
session smoke fixtures are reserved under
`compatibility/v0.2/runtime-session-fixtures` for the released v0.2 Runtime
session mutation model.

Runtime preview lifecycle smoke checks live in
`scripts/smoke-runtime-preview.sh`. The script loads the valid minimal project,
starts dry-run local preview through `/v0/session/preview/start`, applies a
patch to verify stale preview status, restarts preview to refresh it, and then
stops preview.

Active v0.2 Runtime project smoke checks live in
`scripts/smoke-runtime-v02-projects.sh`. The script validates active v0.2
runtime project payloads against `/v0/validate`, loads a ProjectDocumentV02 into
the active Runtime session, then checks session validate, plan, and run. The
older v0.1 HTTP smoke scripts are legacy compatibility scripts and skip
themselves when the connected Runtime advertises active `session.load.v0.2`.

Runtime clear-color render smoke checks live in
`scripts/smoke-runtime-render-clear-color.sh`. The script loads the
`render.clear-color` project, starts dry-run preview, applies a color patch,
verifies stale preview status, restarts preview, and stops it. CI validates the
lifecycle and contract shape; visible pixels are checked manually with a native
preview window.

Runtime telemetry smoke checks live in `scripts/smoke-runtime-telemetry.sh`.
The script verifies `/v0/session/telemetry` before and after loading the
clear-color project, confirms dry-run preview render telemetry while the
preview is running, verifies stale telemetry after a graph patch, and checks
that `/v0/session/telemetry/stream` emits a telemetry SSE event.

Runtime fullscreen shader smoke checks live in
`scripts/smoke-runtime-fullscreen-shader.sh`. The script loads the
`render.fullscreen-shader` project, starts dry-run preview, verifies telemetry
reports `renderer: "fullscreen-shader"`, applies a shader source patch, checks
stale preview state, and restarts preview.

Runtime shader uniform smoke checks live in
`scripts/smoke-runtime-shader-uniform.sh`. The script loads the
`fullscreen-shader-uniform` project, starts dry-run preview, patches the
connected `core.float` node to `0.8`, verifies stale preview state, and
restarts preview.

Runtime multi-uniform shader smoke checks live in
`scripts/smoke-runtime-shader-multi-uniform.sh`. The script loads the
`fullscreen-shader-multi-uniform` project, starts dry-run preview, patches the
connected `phase` float and `tint` RGBA color inputs in sequence, verifies
stale preview state after each accepted patch, and restarts preview.

Runtime dynamic shader interface smoke checks live in
`scripts/smoke-runtime-dynamic-shader-interface.sh`. The script loads the
`dynamic-shader-interface` project, applies a `replaceNodeInterface` patch
generated from WGSL `@skenion.uniform` annotations, verifies shader ports, and
checks preview stale/restart behavior.

Runtime typed value semantics smoke checks live in
`scripts/smoke-runtime-value-semantics.sh`. The script loads the
`value-semantics-demo` project and verifies Max-style runtime control behavior:
`set` updates without emitting, `bang` emits the stored value, and `in` updates
and emits.

Runtime object-routing panel smoke checks live in
`scripts/smoke-runtime-object-routing-panel.sh`. The script verifies that panel controls own `sendName` routing directly while shader inputs remain explicit cables.

Runtime live control preview smoke checks live in
`scripts/smoke-runtime-live-control-preview.sh`. The script loads the
object-routing panel project, starts dry-run preview, sends UI slider and toggle
control events, and verifies that session control revision, named object routing channel state,
preview control revision, and telemetry stay live without creating a graph patch
or restarting preview.

Runtime IO device discovery smoke checks live in
`scripts/smoke-runtime-io-device-api.sh`. The script verifies the raw device
discovery response shape used by node/object parameter editors. It does not
start, stop, or semantically decode MIDI, HID, or Serial input.

The `compatibility/v0.2` directory also includes M06.75 subpatch and live-help
fixtures. These reserve explicit subpatch boundary ports, Manual version lookup
metadata, graph fragment copy/paste fixtures, v0.2 target paths, and invalid
boundary fan-in diagnostics while keeping runtime IO and clock behavior owned
by node/object instances.

M06.82 realtime collaboration wire fixtures live under
`compatibility/v0.2/collaboration`. They cover operation batches, convergence
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

Active learning-oriented tutorial projects live under `tutorials/v0.2`. They
are `ProjectDocumentV02` fixtures with graph v0.2 patch libraries where needed,
so Studio can open them directly as example projects and help patches.
`tutorials.manifest.json` indexes tutorial title, summary, tags, and active
project paths.

Legacy tutorial graphs live under `tutorials/v0.1` as import and migration
coverage for older examples. They are not the active authoring model.

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
SKENION_RUNTIME_URL=http://127.0.0.1:3761 bash scripts/smoke-runtime-v02-projects.sh
```

## Status

Bootstrap repository for the Skenion project. Implementation follows the public architecture and release rules defined in [EchoVisionLab/skenion](https://github.com/echovisionlab/skenion).

## License And Credit

This repository is licensed under the Apache License, Version 2.0.

Redistributions must preserve copyright, license, and NOTICE information as required by Apache-2.0. If Skenion helps your artwork, research, publication, installation, or tool, please credit Skenion and EchoVisionLab.
