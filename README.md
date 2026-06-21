# Skenion Examples

Example scenes, fixtures, sample projects, public assets, and compatibility samples for Skenion.

Code is Apache-2.0 by default; asset-specific licenses must be declared beside assets.

## Compatibility Fixtures

The `fixtures/contract/v0.1` directory contains graph documents and node
definition manifests used to verify compatibility between:

- `skenion-contracts`
- `skenion-sdk`
- `skenion-runtime`
- future `skenion-studio`

Valid fixtures must pass both JSON schema validation and runtime contract
loading. Invalid fixtures must fail for the expected reason.

The `compatibility/v0.1` directory contains registry-oriented node definitions
and graph documents. Its invalid graph fixtures are intentionally valid graph
documents, but they must fail project validation or execution planning when a
runtime resolves them against the node registry.

Runtime project payload fixtures live under
`compatibility/v0.1/projects`. They match the local Runtime HTTP API request
shape for `/v0/validate`, `/v0/plan`, and `/v0/run`.

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

Runtime preview lifecycle smoke checks live in
`scripts/smoke-runtime-preview.sh`. The script loads the valid minimal project,
starts dry-run local preview through `/v0/session/preview/start`, applies a
patch to verify stale preview status, restarts preview to refresh it, and then
stops preview.

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

Learning-oriented tutorial graphs live under `tutorials/v0.1`. They are
readable `skenion.graph` documents rather than runtime payload fixtures, so
Studio can open them directly as example patches. `tutorials.manifest.json`
indexes tutorial title, summary, help node ids, tags, and expected diagnostics.

Compatibility fixtures prove cross-repo contracts. Tutorial graphs teach patch
authoring and are validated against the same contracts package.

Run local validation with:

```sh
SKENION_CONTRACTS_PACKAGE=/Volumes/dev/Skenion/Skenion-contracts/packages/ts/dist node scripts/validate-with-contracts.mjs
SKENION_CONTRACTS_DIR=/Volumes/dev/Skenion/Skenion-contracts node scripts/audit-node-conventions.mjs
SKENION_CONTRACTS_PACKAGE=/Volumes/dev/Skenion/Skenion-contracts/packages/ts/dist node scripts/validate-runtime-project-payloads.mjs
bash scripts/validate-with-runtime.sh /Volumes/dev/Skenion/Skenion-runtime
```

## Status

Bootstrap repository for the Skenion project. Implementation follows the public architecture and release rules defined in [EchoVisionLab/skenion](https://github.com/echovisionlab/skenion).

## License And Credit

This repository is licensed under the Apache License, Version 2.0.

Redistributions must preserve copyright, license, and NOTICE information as required by Apache-2.0. If Skenion helps your artwork, research, publication, installation, or tool, please credit Skenion and EchoVisionLab.
