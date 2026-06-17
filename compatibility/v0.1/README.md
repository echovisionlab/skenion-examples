# Skenion Compatibility Fixtures v0.1

This directory contains shared fixtures for runtime-level graph resolution.

The files under `nodes/` are `NodeDefinitionManifest` documents. Runtime
implementations should load them into a `NodeRegistry` and resolve graph nodes
by `kind` plus `kindVersion`.

The files under `graphs/valid/` should pass both document validation and
registry/project validation. The files under `graphs/invalid/` are intentionally
schema-valid graph documents that should fail registry/project validation or
execution planning.

The files under `projects/` are full Runtime HTTP project payloads with
`{ graph, nodes }`. Valid payloads should return `ok: true` from `/v0/validate`.
Invalid payloads are document-valid but should return `ok: false` from the
Runtime project API.

The same payloads drive local runtime session smoke checks. A runtime should
load a valid payload through `/v0/session/load`, execute the loaded session
through `/v0/session/run`, reject an invalid load with `ok:false`, and clear the
stored session with `DELETE /v0/session`.

The files under `patches/` are `GraphPatch v0.1` documents scoped to the valid
minimal project payload. Valid patches assume `graph.revision: "1"`. Invalid
patches are either schema-invalid, such as unsupported operations, or
runtime-invalid, such as stale `baseRevision`, missing nodes, or duplicate
edges. A runtime should reject invalid patches without mutating the loaded
session.

The `render.clear-color` node fixture is the first render-oriented compatibility
node. Its `params.color` value is `[r, g, b, a]` with each component in the
`0.0..1.0` range. Runtimes should interpret it as a frame-clocked GPU pass that
produces a `resource<gpu.texture2d>` output for the local preview window.

The `render.fullscreen-shader` node fixture is the first shader-oriented render
node. Its params are `{ "language": "wgsl", "source": "..." }`.
Runtimes should compile the WGSL source into a fullscreen triangle pass, expose
`resolution`, `time`, `frame`, optional `u_value`, optional `u_value2`, and
optional `u_color` through the Skenion frame uniform, and report shader compile
or render errors through preview telemetry.
The `fullscreen-shader-uniform.project.json` payload connects
`core.value-f32:value` to `render.fullscreen-shader:u_value` and then routes the
shader output into `render.output:in`.

The `fullscreen-shader-multi-uniform.project.json` payload connects two
`core.value-f32` nodes and one `core.color-rgba` node to
`render.fullscreen-shader:u_value`, `u_value2`, and `u_color`, then routes the
shader output into `render.output:in`. Its WGSL source matches the current
48-byte Runtime uniform buffer layout.

Typed value nodes are stateful control nodes. `core.value-f32`,
`core.value-i32`, `core.value-bool`, and `core.color-rgba` expose `in`, `set`,
`bang`, and `value` ports. The `value-semantics-demo.project.json` payload wires
`core.bang-button:bang` into `core.value-f32:bang`, routes `core.value-f32:value`
to both `core.target:value` and `render.fullscreen-shader:u_value`, and keeps
runtime control events separate from graph patches.

Built-in node manifests whose IDs appear in
`skenion-contracts/builtins/v0.1/builtins.manifest.json` must stay structurally
identical to the contracts builtins. Run
`node scripts/audit-node-conventions.mjs` from the repository root to check
manifest copies, valid graph node snapshots, patch add-node snapshots, and
canonical dataKind spelling derived from the contracts manifest.

The `render.output` node fixture selects the final preview surface. Render
projects should explicitly connect `render.clear-color:out` or
`render.fullscreen-shader:out` to `render.output:in`. The
`studio-port-demo.project.json` payload combines value, event, and render
connections so Studio can verify visible inlets, outlets, and cable routing.

Runtime telemetry smoke checks use the clear-color project to verify the
read-only `/v0/session/telemetry` snapshot and `/v0/session/telemetry/stream`
SSE endpoint. Telemetry reports session state, preview state, dry-run or native
render activity, revision freshness, and basic process metadata; it must not
mutate the loaded session or preview lifecycle.

Runtime shader uniform smoke checks use
`scripts/smoke-runtime-shader-uniform.sh`. The script loads the fullscreen shader
uniform project, starts dry-run preview, patches the float value to `0.8`,
checks that preview becomes stale, and restarts preview.

Runtime multi-uniform shader smoke checks use
`scripts/smoke-runtime-shader-multi-uniform.sh`. The script loads the fullscreen
shader multi-uniform project, starts dry-run preview, patches `u_value2` and
`u_color` through their connected value nodes, checks that preview becomes stale
after each patch, and restarts preview.

Runtime typed value semantics smoke checks use
`scripts/smoke-runtime-value-semantics.sh`. The script loads the value semantics
demo project, dispatches `/v0/session/control/event` requests to `set`, `bang`,
and `in`, validates emitted values, and reads `/v0/session/control/state`.

These fixtures do not imply automatic conversion. CPU video frames, GPU texture
resources, boolean values, and bang events must be connected through explicit
converter or processing nodes.
