# Skenion Compatibility Fixtures v0.2

This directory contains fixtures for Port/Edge/Feedback Semantics v0.2.

v0.2 keeps the v0.1 graph/node contract as a frozen baseline and adds a
parallel contract with explicit port cardinality, merge policy, fan-out policy,
edge metadata, and feedback policy.

M06.75 also reserves fixtures for subpatch boundaries and live-help lookup.
Subpatch definitions live in the v0.2 project `patchLibrary`; `core.subpatch`
or `p name` nodes only reference those definitions and materialize their
derived `core.inlet`/`core.outlet` contract as ordinary graph v0.2 ports.

Artist-facing render cables use `render.frame`. Low-level GPU resources still
use resource-oriented types such as `gpu.texture2d`, and conversions must be
represented by explicit adapter nodes.

The valid graphs cover:

- explicit `render.output` selection
- source fan-out
- ordered event fan-in
- audio mixer fan-in
- render-frame feedback classification
- explicit GPU texture to render frame adapter usage
- explicit subpatch boundary ports derived from `PatchDefinitionV02`
- live-help fixture lookup for a Manual topic and patch-library help patch

The invalid graphs cover hard diagnostics such as ambiguous control/value
algebraic loops, default render input fan-in, and subpatch boundary fan-in
without an explicit merge policy.

Runtime v0.14 should validate and plan these graphs, but it must not execute
feedback.
