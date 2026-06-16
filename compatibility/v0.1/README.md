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

These fixtures do not imply automatic conversion. CPU video frames, GPU texture
resources, boolean values, and bang events must be connected through explicit
converter or processing nodes.
