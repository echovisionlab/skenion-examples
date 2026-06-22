# Active Runtime Session Fixtures

This directory is reserved for runtime session smoke fixtures that load current
graph 0.1 project payloads. Fixtures here are validated by
`scripts/validate-runtime-session-smoke-fixtures.mjs`.

Current Runtime session fixtures must use explicit `/v0/sessions/{sessionId}`
paths. The removed `/v0/session` default-session alias is not current behavior
and must not appear in active fixtures.
