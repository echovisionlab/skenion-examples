# Codex Agent Context

This repository is one part of the Skenion workspace. Do not treat local code
momentum as the source of truth: before committing, pushing, opening a PR, or
writing PR close keywords, check the relevant GitHub milestone and issue with
`/opt/homebrew/bin/gh`.

## Strict v0 Examples Policy

Skenion v0 does not support legacy, deprecated, or import-only compatibility
paths. Examples and fixtures must demonstrate the current product surface only.
Unsupported schema, protocol, graph, project, package, manifest, or ABI versions
may appear only as negative conformance fixtures that prove rejection.

The forward graph/project contract label is `0.1`. Examples should follow
Contracts after v0.2 is merged into the 0.1 label. Do not preserve the old v0.1
meaning as legacy compatibility, and do not keep v0.2 as parallel examples. If
a version field remains, examples should use only exact current `0.1` for that
surface.

## Repository Role

Examples should provide conformance fixtures for subpatches, living help,
package installation, native extension manifests, Runtime validation, and
Studio authoring flows. Release readiness is proven against the compatibility
matrix and component-advertised Contracts range, not by equal component
versions. Do not keep compatibility fixtures as normal examples.

## Compatibility Matrix Release Model

Skenion component versions are independent during v0. Examples release
validation must consume released Contracts/SDK packages, released Runtime/Studio
artifacts, or checked-in compatibility matrix evidence. During v0, a consumed
component may advertise a broad Contracts range such as `>=0.0.0 <1.0.0`; do
not narrow that range in Examples CI unless the component metadata itself does
so. Release-mode validation must not consume sibling branches, `main`, `.deps`,
workspace paths, or local build outputs.

CI must not hardcode a Contracts version or supported range as a second
compatibility authority. Examples CI should validate the examples
against the released packages/artifacts or explicit matrix inputs it actually
consumes, and release CI should reject only invalid dependency sources,
malformed metadata, or missing evidence. Any reported Contracts version/range
must come from the consumed package or matrix metadata, not a workflow-owned
constant.

Examples tags may use their own component version, such as
`skenion-examples-v0.45.1`. SDK and Contracts versions do not need to be equal,
but the SDK's declared supported Contracts range must contain the released
Contracts package version recorded in the matrix.

All release-state writes must happen inside GitHub Actions. Do not create,
edit, delete, promote, demote, or repair GitHub Releases, release assets, tags,
prerelease/draft flags, release notes, compatibility matrices, examples
conformance records, npm packages, or crates from a local shell. This includes
`gh release edit`, `gh release upload`, `gh release delete`, manual tag
mutation, local registry publish, or ad hoc release metadata patches with a
locally exported token. Local commands may inspect state, run dry-run checks,
create normal code PRs, or trigger approved `workflow_dispatch` jobs; the
actual release mutation must run in CI with reviewed workflow code and
auditable logs.

## Manager, Worker, And Review Gate Defaults

Codex should operate as a manager/orchestrator on Skenion work. The manager owns
sequencing, milestone and issue hygiene, PR title/body/close-keyword control,
worker assignment, integration, and final reporting. Except for trivial
documentation, context, issue, or status edits, the manager should not directly
modify code. Implementation work and follow-up fixes should be delegated to
focused worker agents, then integrated by the manager. Workers must receive a
clear ownership scope, usually specific files, modules, or repository slices,
and must be told that other agents may be editing nearby code.

Follow-up work is not an exception: if review, CI, or user feedback requires
non-trivial code changes, the manager must assign that work to a worker and send
the completed slice through a separate review gate again. The manager may run
verification and status commands, but should not directly patch non-trivial
implementation code.

Every completed worker slice needs a separate review gate before it is treated
as done. The gate should be a different expert agent from the worker. A gate
review should prioritize correctness, API cleanliness, responsibility
boundaries, readability, test coverage, CI risk, and milestone acceptance
criteria. If the gate fails, the manager must send concrete fixes back to a
worker, then run the gate again until the slice passes or a real blocker is
recorded in the issue. The manager may only make trivial documentation,
context, issue, or status corrections directly.

Default code quality requirements:

- Write code that is easy to read before it is clever.
- Follow clean-code principles: clear names, small responsibilities, explicit
  data flow, predictable control flow, and low incidental coupling.
- Do not introduce interface-based abstraction lightly. Public APIs, traits,
  generated clients, schemas, and extension points must earn their existence and
  remain small, stable, and understandable.
- Keep responsibility ownership clear. Runtime, Studio, Contracts, SDK,
  Examples, and Docs must not duplicate each other's source-of-truth roles.
- UI/UX work must be reviewed for actual workflow quality, not merely rendered
  components.

Issues and milestones are the operating ledger. When work discovers new debt,
missing scope, or a design risk, record it on the relevant GitHub issue or open
a properly milestoned issue before burying it in local context. Close issues
only when the repository-specific acceptance criteria are genuinely complete.
Use `Refs` for partial or cross-repo work and `Closes` only for finished scope.
