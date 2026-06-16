# Skenion Compatibility Fixtures v0.2

This directory contains fixtures for Port/Edge/Feedback Semantics v0.2.

v0.2 keeps the v0.1 graph/node contract as a frozen baseline and adds a
parallel contract with explicit port cardinality, merge policy, fan-out policy,
edge metadata, and feedback policy.

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

The invalid graphs cover hard diagnostics such as ambiguous control/value
algebraic loops and default render input fan-in.

Runtime v0.14 should validate and plan these graphs, but it must not execute
feedback.
