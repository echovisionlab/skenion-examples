# Active Realtime Collaboration Fixtures

These fixtures exercise the released `@skenion/contracts` collaboration wire
schemas added for M06.82. They are compatibility samples rather than a runtime
simulator: validation proves the examples stay on the shared wire contract, and
the file names describe the convergence or conflict story that a runtime smoke
test can replay later.

Although the wire envelope schema is versioned as runtime collaboration v0,
the graph operations, target paths, and fragments inside these fixtures use the
graph v0.2 product model.

- `concurrent-node-add-move-connect.batch.json` shows two participants
  submitting convergent node add, node move, and edge connect changes against
  the same root graph revision.
- `concurrent-delete-connect-conflict.batch.json` shows the conflict shape for
  a delete racing a connect that references the deleted node.
- `paste-fragment-rebased.batch.json` shows a stale paste operation that can be
  rebased with id remapping and relative placement preserved.
- `actor-scoped-undo-redo.batch.json` shows participant-scoped undo/redo
  metadata for actor-local history.
- `operation-results-accepted-duplicate-rejected-rebased.batch-result.json`
  covers accepted, duplicate, rejected, and rebased server outcomes.
- `presence-active.presence.json` and `selection-multi-range.selection.json`
  cover participant presence and graph selection updates.
- `event-*.event.json` files cover broadcast envelopes for operation-result,
  presence, and selection events.
- `event-presence-replayed-retention-gap.event.json` covers reconnect/resume
  replay when the client's last cursor is outside the retained event window and
  Runtime must report a replay gap.
