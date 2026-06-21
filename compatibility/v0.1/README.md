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
Runtimes should compile the WGSL fragment source into a fullscreen triangle
pass, provide a generated Skenion frame/uniform header, and report shader
compile or render errors through preview telemetry. Dynamic value inputs are
declared with `// @skenion.uniform <portId> <dataKind>` comments.
The `fullscreen-shader-uniform.project.json` payload connects
`core.float:value` to `render.fullscreen-shader:speed` and then routes the
shader output into `render.output:in`.

The `fullscreen-shader-multi-uniform.project.json` payload connects two
`core.float` nodes and one `core.color` node to
`render.fullscreen-shader:speed`, `phase`, and `tint`, then routes the shader
output into `render.output:in`.

The `dynamic-shader-interface.project.json` payload covers the v0 dynamic
shader interface path: WGSL annotations produce `speed`, `enabled`,
`iterations`, and `tint` input ports, plus the static `out` render output.

Typed value nodes are stateful control nodes. `core.float`,
`core.int`, `core.bool`, `core.color`, and `core.string` expose
`in`, `cold`, and `value` ports. `in` is the Pd-style hot inlet: typed
messages update and emit, `bang` emits the stored value, and `set ...` updates
silently. `cold` is the silent storage inlet for compatible typed messages and
`set ...`. `core.bool` with `widget: "toggle"` uses the same boolean surface,
but `bang` at `in` flips the stored value before emitting. The
`value-semantics-demo.project.json` payload wires `core.bang:out` into
`core.float:in`, routes `core.float:value` to both
`core.float:in` and `render.fullscreen-shader:speed`, and keeps runtime
control events separate from graph patches.

The `control-layer-demo.project.json` payload covers the non-render control
surface: `core.bool`, `core.string`, `core.message`, and `core.comment`.
`core.message` is a stored message box with `in`/`out`; `set ...` updates the
stored message silently and `bang` emits it. `core.comment` is a compact
annotation object with an `in` inlet; `set <text>` updates runtime display text
silently while graph text edits remain persisted graph changes.

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
shader multi-uniform project, starts dry-run preview, patches `phase` and
`tint` through their connected value nodes, checks that preview becomes stale
after each patch, and restarts preview.

Runtime typed value semantics smoke checks use
`scripts/smoke-runtime-value-semantics.sh`. The script loads the value semantics
demo project, dispatches `/v0/session/control/event` requests to `set`, `bang`,
and `in`, validates emitted values, and reads `/v0/session/control/state`.

Runtime control layer smoke checks use
`scripts/smoke-runtime-control-layer.sh`. The script first verifies typed F32
set/bang/in behavior and `/v0/session/control/read`, then loads the control
layer demo project to verify toggle flip semantics, string set/in/bang behavior,
message bang output, comment param reads, and port reads.

Runtime live control preview smoke checks use
`scripts/smoke-runtime-live-control-preview.sh`. The script loads the
object-routing panel project, starts dry-run preview, dispatches UI slider and
toggle control events, and verifies that object-owned channel state and preview
telemetry report matching control revisions without marking the graph preview
stale.

Runtime audio clock-domain smoke checks use
`scripts/smoke-runtime-audio-clock-domains.sh`. The script builds audio DSP
plans for same-domain input-to-output routing, explicit `audio.clock-bridge`
routing, and explicit `audio.resample` routing. It also verifies that an
independent `audio.input` to `audio.output` route is rejected unless a bridge or
resampler is present, even when both endpoints can otherwise validate as audio
signal nodes.

MIDI Clock parser fixtures under `clock-midi-fixtures` validate the M05.1
contract/parser slice without requiring a real MIDI device. They cover
start/stop transport, 14-bit Song Position Pointer, meter-derived bar/beat,
meterless unavailable bar/beat, unavailable tempo/timecode, and invalid SPP
diagnostics.

Runtime MIDI Clock fixtures under `runtime-midi-clock-fixtures` validate the
M05.2 adapter path with timestamped raw MIDI bytes. The smoke script runs
`skenion-runtime clock-midi --simulate ... --format json` and checks that the
fixture parser produces a `ClockState` snapshot without requiring a physical
MIDI device.
It also verifies song-position provenance: SPP is authoritative, tick
accumulation is derived, continue without SPP leaves song position unavailable,
and meterless bar/beat fields stay unavailable.

Physical MIDI input is intentionally not modeled as a runtime-global clock
source in v0. Runtime IO device discovery exposes raw device descriptors for
node and object parameter editors; each node or object is responsible for
binding and interpreting the selected input as MIDI clock, MIDI notes, slider
controls, serial bytes, HID reports, or another domain-specific protocol.

These fixtures do not imply automatic conversion. CPU video frames, GPU texture
resources, boolean values, and bang events must be connected through explicit
converter or processing nodes.
