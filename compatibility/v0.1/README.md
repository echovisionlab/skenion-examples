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
node. Its v0.12 params are `{ "language": "wgsl", "source": "..." }`.
Runtimes should compile the WGSL source into a fullscreen triangle pass, expose
`resolution`, `time`, optional `u_value`, and `frame` through the Skenion frame
uniform, and report shader compile or render errors through preview telemetry.
The `fullscreen-shader-uniform.project.json` payload connects
`core.value-f32:value` to `render.fullscreen-shader:u_value` and then routes the
shader output into `render.output:in`. Its WGSL source uses explicit padding to
match the current 32-byte Runtime uniform buffer layout.

Built-in node manifests whose IDs match `skenion-contracts/builtins/v0.1/nodes`
must stay structurally identical to the contracts builtins. Run
`node scripts/audit-node-conventions.mjs` from the repository root to check
manifest copies, valid graph node snapshots, patch add-node snapshots, and
canonical dataKind spelling.

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

These fixtures do not imply automatic conversion. CPU video frames, GPU texture
resources, boolean values, and bang events must be connected through explicit
converter or processing nodes.
