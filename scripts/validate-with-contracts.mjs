import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { importContracts, resolveContractsPackage } from "./contracts-package-source.mjs";

const root = process.cwd();
const contractsPackage = resolveContractsPackage(root);

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(fullPath));
    } else if (entry.name.endsWith(".json")) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function validationResult(errors) {
  return {
    ok: errors.length === 0,
    errors
  };
}

function requireRecord(value, errors, label) {
  if (!isRecord(value)) {
    errors.push(`${label} must be an object`);
    return null;
  }
  return value;
}

function requireArray(value, errors, label) {
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array`);
    return null;
  }
  return value;
}

function requireBoolean(value, errors, label) {
  if (typeof value !== "boolean") {
    errors.push(`${label} must be a boolean`);
  }
}

function requireNonEmptyString(value, errors, label) {
  if (!isNonEmptyString(value)) {
    errors.push(`${label} must be a non-empty string`);
  }
}

function requireInteger(value, errors, label, { min = 0 } = {}) {
  if (!Number.isInteger(value) || value < min) {
    errors.push(`${label} must be an integer >= ${min}`);
  }
}

function appendValidation(result, errors, label) {
  if (!result.ok) {
    errors.push(...result.errors.map((error) => `${label}: ${error}`));
  }
}

function validateSchema(document, errors, expectedSchema, label) {
  if (!isRecord(document)) {
    errors.push(`${label} must be an object`);
    return false;
  }
  if (document.schema !== expectedSchema) {
    errors.push(`${label}.schema must be ${expectedSchema}`);
  }
  if (document.schemaVersion !== "0.1.0") {
    errors.push(`${label}.schemaVersion must be 0.1.0`);
  }
  return true;
}

function validatePasteGraphFragmentRequest(request, contracts, errors, label) {
  if (!requireRecord(request, errors, label)) {
    return;
  }
  if (typeof contracts.validatePasteGraphFragmentRequest === "function") {
    appendValidation(contracts.validatePasteGraphFragmentRequest(request), errors, label);
  }
  if (isRecord(request.fragment)) {
    appendValidation(contracts.validateGraphFragmentV01(request.fragment), errors, `${label}.fragment`);
  } else {
    errors.push(`${label}.fragment must be an object`);
  }
}

function validateRuntimeOperationFixture(document, contracts) {
  const errors = [];
  if (!validateSchema(document, errors, "skenion.runtime.operation", "runtime operation")) {
    return validationResult(errors);
  }
  requireNonEmptyString(document.id, errors, "runtime operation id");
  if (document.kind !== "pasteGraphFragment") {
    errors.push("runtime operation kind must be pasteGraphFragment");
  }
  validatePasteGraphFragmentRequest(document.request, contracts, errors, "runtime operation request");
  if (document.attribution !== undefined) {
    const attribution = requireRecord(document.attribution, errors, "runtime operation attribution");
    if (attribution) {
      if (attribution.clientId !== undefined) {
        requireNonEmptyString(attribution.clientId, errors, "runtime operation attribution.clientId");
      }
      if (attribution.label !== undefined) {
        requireNonEmptyString(attribution.label, errors, "runtime operation attribution.label");
      }
    }
  }
  if (document.correlationId !== undefined) {
    requireNonEmptyString(document.correlationId, errors, "runtime operation correlationId");
  }
  return validationResult(errors);
}

function validateRuntimeCollaborationFixture(document, contracts) {
  if (!isRecord(document)) {
    return validationResult(["collaboration fixture must be an object"]);
  }
  if (document.schema === "skenion.runtime.collaboration.operation") {
    return validateCollaborationOperation(document, contracts, "collaboration operation");
  }
  if (document.schema === "skenion.runtime.collaboration.operation-batch") {
    return validateCollaborationOperationBatch(document, contracts);
  }
  if (document.schema === "skenion.runtime.collaboration.operation-result") {
    return validateCollaborationOperationResult(document, "collaboration operation result");
  }
  if (document.schema === "skenion.runtime.collaboration.operation-batch-result") {
    return validateCollaborationOperationBatchResult(document);
  }
  if (document.schema === "skenion.runtime.collaboration.presence") {
    return validateCollaborationPresence(document, "collaboration presence");
  }
  if (document.schema === "skenion.runtime.collaboration.selection") {
    return validateCollaborationSelection(document, "collaboration selection");
  }
  if (document.schema === "skenion.runtime.collaboration.event") {
    return validateCollaborationEvent(document);
  }
  return validationResult([`unsupported collaboration schema ${document.schema ?? "<missing>"}`]);
}

function validateCollaborationOperation(document, contracts, label) {
  const errors = [];
  validateSchema(document, errors, "skenion.runtime.collaboration.operation", label);
  requireNonEmptyString(document.operationId, errors, `${label}.operationId`);
  requireNonEmptyString(document.sessionId, errors, `${label}.sessionId`);
  requireNonEmptyString(document.participantId, errors, `${label}.participantId`);
  requireNonEmptyString(document.idempotencyKey, errors, `${label}.idempotencyKey`);
  validateCollaborationCausal(document.causal, errors, `${label}.causal`);
  validateCollaborationPayload(document.payload, contracts, errors, `${label}.payload`);
  if (document.correlationId !== undefined) {
    requireNonEmptyString(document.correlationId, errors, `${label}.correlationId`);
  }
  requireNonEmptyString(document.submittedAt, errors, `${label}.submittedAt`);
  return validationResult(errors);
}

function validateCollaborationOperationBatch(document, contracts) {
  const errors = [];
  validateSchema(document, errors, "skenion.runtime.collaboration.operation-batch", "collaboration operation batch");
  requireNonEmptyString(document.sessionId, errors, "collaboration operation batch.sessionId");
  requireNonEmptyString(document.submittedAt, errors, "collaboration operation batch.submittedAt");
  const operations = requireArray(document.operations, errors, "collaboration operation batch.operations") ?? [];
  if (operations.length === 0) {
    errors.push("collaboration operation batch.operations must not be empty");
  }
  const idempotencyKeys = new Set();
  for (const [index, operation] of operations.entries()) {
    const result = validateCollaborationOperation(operation, contracts, `collaboration operation batch.operations[${index}]`);
    appendValidation(result, errors, `collaboration operation batch.operations[${index}]`);
    if (isRecord(operation)) {
      if (operation.sessionId !== document.sessionId) {
        errors.push(`collaboration operation batch.operations[${index}].sessionId must match batch sessionId`);
      }
      if (isNonEmptyString(operation.idempotencyKey)) {
        if (idempotencyKeys.has(operation.idempotencyKey)) {
          errors.push(`duplicate collaboration idempotency key ${operation.idempotencyKey}`);
        }
        idempotencyKeys.add(operation.idempotencyKey);
      }
    }
  }
  return validationResult(errors);
}

function validateCollaborationPayload(payload, contracts, errors, label) {
  if (!requireRecord(payload, errors, label)) {
    return;
  }
  requireNonEmptyString(payload.kind, errors, `${label}.kind`);
  if (payload.kind === "changeSet") {
    validateGraphTarget(payload.target, errors, `${label}.target`);
    const changes = requireArray(payload.changes, errors, `${label}.changes`) ?? [];
    if (changes.length === 0) {
      errors.push(`${label}.changes must not be empty`);
    }
    for (const [index, change] of changes.entries()) {
      validateCollaborationChange(change, contracts, errors, `${label}.changes[${index}]`);
    }
    if (payload.undoGroupId !== undefined) {
      requireNonEmptyString(payload.undoGroupId, errors, `${label}.undoGroupId`);
    }
    if (payload.description !== undefined) {
      requireNonEmptyString(payload.description, errors, `${label}.description`);
    }
    return;
  }
  if (payload.kind === "pasteGraphFragment") {
    validatePasteGraphFragmentRequest(payload.request, contracts, errors, `${label}.request`);
    if (payload.undoGroupId !== undefined) {
      requireNonEmptyString(payload.undoGroupId, errors, `${label}.undoGroupId`);
    }
    if (payload.description !== undefined) {
      requireNonEmptyString(payload.description, errors, `${label}.description`);
    }
    return;
  }
  if (payload.kind === "undoRedo") {
    if (!["undo", "redo"].includes(payload.action)) {
      errors.push(`${label}.action must be undo or redo`);
    }
    const scope = requireRecord(payload.scope, errors, `${label}.scope`);
    if (scope) {
      requireNonEmptyString(scope.kind, errors, `${label}.scope.kind`);
      if (scope.kind === "participant") {
        requireNonEmptyString(scope.participantId, errors, `${label}.scope.participantId`);
      }
    }
    requireNonEmptyString(payload.subjectOperationId, errors, `${label}.subjectOperationId`);
    requireNonEmptyString(payload.undoGroupId, errors, `${label}.undoGroupId`);
    requireInteger(payload.maxOperations, errors, `${label}.maxOperations`, { min: 1 });
    return;
  }
  errors.push(`${label}.kind is unsupported: ${payload.kind}`);
}

function validateCollaborationChange(change, contracts, errors, label) {
  if (!requireRecord(change, errors, label)) {
    return;
  }
  requireNonEmptyString(change.op, errors, `${label}.op`);
  requireNonEmptyString(change.changeId, errors, `${label}.changeId`);
  if (change.op === "node.add") {
    validateGraphNodePayload(change.node, contracts, errors, `${label}.node`);
    validatePoint(change.view, errors, `${label}.view`);
    return;
  }
  if (change.op === "node.delete") {
    requireNonEmptyString(change.nodeId, errors, `${label}.nodeId`);
    if (change.tombstoneId !== undefined) {
      requireNonEmptyString(change.tombstoneId, errors, `${label}.tombstoneId`);
    }
    return;
  }
  if (change.op === "node.move") {
    requireNonEmptyString(change.nodeId, errors, `${label}.nodeId`);
    validatePoint(change.from, errors, `${label}.from`);
    validatePoint(change.to, errors, `${label}.to`);
    return;
  }
  if (change.op === "edge.connect") {
    validateEdge(change.edge, errors, `${label}.edge`);
    return;
  }
  errors.push(`${label}.op is unsupported: ${change.op}`);
}

function validateGraphNodePayload(node, contracts, errors, label) {
  if (!requireRecord(node, errors, label)) {
    return;
  }
  const graph = {
    schema: "skenion.graph",
    schemaVersion: "0.1.0",
    id: `${node.id ?? "node"}-graph-node-wrapper`,
    revision: "1",
    nodes: [node],
    edges: []
  };
  appendValidation(contracts.validateGraphDocumentV01(graph), errors, label);
}

function validatePoint(point, errors, label) {
  if (!requireRecord(point, errors, label)) {
    return;
  }
  if (typeof point.x !== "number") {
    errors.push(`${label}.x must be a number`);
  }
  if (typeof point.y !== "number") {
    errors.push(`${label}.y must be a number`);
  }
}

function validateEndpoint(endpoint, errors, label) {
  if (!requireRecord(endpoint, errors, label)) {
    return;
  }
  requireNonEmptyString(endpoint.nodeId, errors, `${label}.nodeId`);
  requireNonEmptyString(endpoint.portId, errors, `${label}.portId`);
}

function validateEdge(edge, errors, label) {
  if (!requireRecord(edge, errors, label)) {
    return;
  }
  requireNonEmptyString(edge.id, errors, `${label}.id`);
  validateEndpoint(edge.source, errors, `${label}.source`);
  validateEndpoint(edge.target, errors, `${label}.target`);
  requireNonEmptyString(edge.resolvedType, errors, `${label}.resolvedType`);
}

function validateGraphTarget(target, errors, label) {
  if (!requireRecord(target, errors, label)) {
    return;
  }
  const graphPath = requireRecord(target.path, errors, `${label}.path`);
  if (graphPath) {
    requireNonEmptyString(graphPath.kind, errors, `${label}.path.kind`);
  }
  if (target.baseRevision !== undefined) {
    requireNonEmptyString(target.baseRevision, errors, `${label}.baseRevision`);
  }
}

function validateCollaborationCausal(causal, errors, label) {
  if (!requireRecord(causal, errors, label)) {
    return;
  }
  requireNonEmptyString(causal.baseRevision, errors, `${label}.baseRevision`);
  requireInteger(causal.baseSequence, errors, `${label}.baseSequence`, { min: 0 });
  const vector = requireRecord(causal.vector, errors, `${label}.vector`);
  if (vector) {
    for (const [key, value] of Object.entries(vector)) {
      requireInteger(value, errors, `${label}.vector.${key}`, { min: 0 });
    }
  }
  const observed = requireArray(causal.observedOperationIds, errors, `${label}.observedOperationIds`) ?? [];
  for (const [index, operationId] of observed.entries()) {
    requireNonEmptyString(operationId, errors, `${label}.observedOperationIds[${index}]`);
  }
}

function validateCollaborationOperationResult(document, label) {
  const errors = [];
  validateSchema(document, errors, "skenion.runtime.collaboration.operation-result", label);
  requireNonEmptyString(document.sessionId, errors, `${label}.sessionId`);
  requireNonEmptyString(document.operationId, errors, `${label}.operationId`);
  requireNonEmptyString(document.participantId, errors, `${label}.participantId`);
  requireNonEmptyString(document.idempotencyKey, errors, `${label}.idempotencyKey`);
  if (!["accepted", "duplicate", "rejected", "rebased"].includes(document.status)) {
    errors.push(`${label}.status must be accepted, duplicate, rejected, or rebased`);
  }
  validateCollaborationCausal(document.causal, errors, `${label}.causal`);
  const needsAck = ["accepted", "rebased"].includes(document.status);
  const needsNack = ["duplicate", "rejected"].includes(document.status);
  if (needsAck) {
    validateCollaborationAck(document.ack, errors, `${label}.ack`);
  }
  if (needsNack) {
    validateCollaborationNack(document.nack, errors, `${label}.nack`);
  }
  if (document.status === "rebased") {
    validateCollaborationRebase(document.rebase, errors, `${label}.rebase`);
  }
  validateCollaborationDiagnostics(document.diagnostics, errors, `${label}.diagnostics`);
  requireNonEmptyString(document.createdAt, errors, `${label}.createdAt`);
  return validationResult(errors);
}

function validateCollaborationOperationBatchResult(document) {
  const errors = [];
  validateSchema(document, errors, "skenion.runtime.collaboration.operation-batch-result", "collaboration operation batch result");
  requireNonEmptyString(document.sessionId, errors, "collaboration operation batch result.sessionId");
  const results = requireArray(document.results, errors, "collaboration operation batch result.results") ?? [];
  if (results.length === 0) {
    errors.push("collaboration operation batch result.results must not be empty");
  }
  for (const [index, result] of results.entries()) {
    const itemResult = validateCollaborationOperationResult(result, `collaboration operation batch result.results[${index}]`);
    appendValidation(itemResult, errors, `collaboration operation batch result.results[${index}]`);
    if (isRecord(result) && result.sessionId !== document.sessionId) {
      errors.push(`collaboration operation batch result.results[${index}].sessionId must match batch result sessionId`);
    }
  }
  validateCollaborationDiagnostics(document.diagnostics, errors, "collaboration operation batch result.diagnostics");
  requireNonEmptyString(document.createdAt, errors, "collaboration operation batch result.createdAt");
  return validationResult(errors);
}

function validateCollaborationAck(ack, errors, label) {
  if (!requireRecord(ack, errors, label)) {
    return;
  }
  requireInteger(ack.sequence, errors, `${label}.sequence`, { min: 1 });
  requireNonEmptyString(ack.revision, errors, `${label}.revision`);
  validateCollaborationServerClock(ack.serverClock, errors, `${label}.serverClock`);
  requireNonEmptyString(ack.appliedAt, errors, `${label}.appliedAt`);
}

function validateCollaborationNack(nack, errors, label) {
  if (!requireRecord(nack, errors, label)) {
    return;
  }
  requireNonEmptyString(nack.reason, errors, `${label}.reason`);
  requireBoolean(nack.retryable, errors, `${label}.retryable`);
  validateCollaborationDiagnostics(nack.diagnostics, errors, `${label}.diagnostics`);
}

function validateCollaborationRebase(rebase, errors, label) {
  if (!requireRecord(rebase, errors, label)) {
    return;
  }
  validateCollaborationCausal(rebase.from, errors, `${label}.from`);
  validateCollaborationCausal(rebase.to, errors, `${label}.to`);
  requireNonEmptyString(rebase.strategy, errors, `${label}.strategy`);
  requireArray(rebase.conflicts, errors, `${label}.conflicts`);
}

function validateCollaborationServerClock(clock, errors, label) {
  if (!requireRecord(clock, errors, label)) {
    return;
  }
  requireNonEmptyString(clock.revision, errors, `${label}.revision`);
  requireInteger(clock.sequence, errors, `${label}.sequence`, { min: 0 });
  const vector = requireRecord(clock.vector, errors, `${label}.vector`);
  if (vector) {
    for (const [key, value] of Object.entries(vector)) {
      requireInteger(value, errors, `${label}.vector.${key}`, { min: 0 });
    }
  }
}

function validateCollaborationDiagnostics(diagnostics, errors, label) {
  const entries = requireArray(diagnostics, errors, label) ?? [];
  for (const [index, diagnostic] of entries.entries()) {
    const entry = requireRecord(diagnostic, errors, `${label}[${index}]`);
    if (!entry) {
      continue;
    }
    requireNonEmptyString(entry.severity, errors, `${label}[${index}].severity`);
    requireNonEmptyString(entry.code, errors, `${label}[${index}].code`);
    requireNonEmptyString(entry.message, errors, `${label}[${index}].message`);
  }
}

function validateCollaborationPresence(document, label) {
  const errors = [];
  validateSchema(document, errors, "skenion.runtime.collaboration.presence", label);
  requireNonEmptyString(document.sessionId, errors, `${label}.sessionId`);
  requireNonEmptyString(document.participantId, errors, `${label}.participantId`);
  const presence = requireRecord(document.presence, errors, `${label}.presence`);
  if (presence) {
    requireNonEmptyString(presence.state, errors, `${label}.presence.state`);
    if (presence.capabilities !== undefined) {
      const capabilities = requireArray(presence.capabilities, errors, `${label}.presence.capabilities`) ?? [];
      for (const [index, capability] of capabilities.entries()) {
        requireNonEmptyString(capability, errors, `${label}.presence.capabilities[${index}]`);
      }
    }
  }
  requireNonEmptyString(document.updatedAt, errors, `${label}.updatedAt`);
  requireNonEmptyString(document.expiresAt, errors, `${label}.expiresAt`);
  return validationResult(errors);
}

function validateCollaborationSelection(document, label) {
  const errors = [];
  validateSchema(document, errors, "skenion.runtime.collaboration.selection", label);
  requireNonEmptyString(document.sessionId, errors, `${label}.sessionId`);
  requireNonEmptyString(document.participantId, errors, `${label}.participantId`);
  validateGraphTarget(document.target, errors, `${label}.target`);
  const selection = requireRecord(document.selection, errors, `${label}.selection`);
  if (selection) {
    const ranges = requireArray(selection.ranges, errors, `${label}.selection.ranges`) ?? [];
    if (ranges.length === 0) {
      errors.push(`${label}.selection.ranges must not be empty`);
    }
    requireInteger(selection.activeRangeIndex, errors, `${label}.selection.activeRangeIndex`, { min: 0 });
    if (Number.isInteger(selection.activeRangeIndex) && selection.activeRangeIndex >= ranges.length) {
      errors.push(`${label}.selection.activeRangeIndex must point at a range`);
    }
    for (const [index, range] of ranges.entries()) {
      validateSelectionRange(range, errors, `${label}.selection.ranges[${index}]`);
    }
  }
  if (document.cursor !== undefined) {
    validateSelectionCursor(document.cursor, errors, `${label}.cursor`);
  }
  requireNonEmptyString(document.updatedAt, errors, `${label}.updatedAt`);
  requireNonEmptyString(document.expiresAt, errors, `${label}.expiresAt`);
  return validationResult(errors);
}

function validateSelectionRange(range, errors, label) {
  if (!requireRecord(range, errors, label)) {
    return;
  }
  requireNonEmptyString(range.kind, errors, `${label}.kind`);
  if (range.kind === "nodes") {
    requireArray(range.nodeIds, errors, `${label}.nodeIds`);
  } else if (range.kind === "edges") {
    requireArray(range.edgeIds, errors, `${label}.edgeIds`);
  } else if (range.kind === "ports") {
    const endpoints = requireArray(range.endpoints, errors, `${label}.endpoints`) ?? [];
    for (const [index, endpoint] of endpoints.entries()) {
      validateEndpoint(endpoint, errors, `${label}.endpoints[${index}]`);
    }
  } else if (range.kind === "text") {
    validateTextPosition(range.anchor, errors, `${label}.anchor`);
    validateTextPosition(range.focus, errors, `${label}.focus`);
  }
}

function validateTextPosition(position, errors, label) {
  if (!requireRecord(position, errors, label)) {
    return;
  }
  requireNonEmptyString(position.nodeId, errors, `${label}.nodeId`);
  requireNonEmptyString(position.field, errors, `${label}.field`);
  requireInteger(position.offset, errors, `${label}.offset`, { min: 0 });
}

function validateSelectionCursor(cursor, errors, label) {
  if (!requireRecord(cursor, errors, label)) {
    return;
  }
  requireNonEmptyString(cursor.kind, errors, `${label}.kind`);
  if (cursor.kind === "node") {
    requireNonEmptyString(cursor.nodeId, errors, `${label}.nodeId`);
  }
  if (cursor.portId !== undefined) {
    requireNonEmptyString(cursor.portId, errors, `${label}.portId`);
  }
}

function validateCollaborationEvent(document) {
  const errors = [];
  validateSchema(document, errors, "skenion.runtime.collaboration.event", "collaboration event");
  requireNonEmptyString(document.eventId, errors, "collaboration event.eventId");
  requireNonEmptyString(document.sessionId, errors, "collaboration event.sessionId");
  requireInteger(document.sequence, errors, "collaboration event.sequence", { min: 1 });
  validateCollaborationCausal(document.causal, errors, "collaboration event.causal");
  requireNonEmptyString(document.kind, errors, "collaboration event.kind");
  const payload = requireRecord(document.payload, errors, "collaboration event.payload");
  if (payload) {
    if (document.kind === "presence") {
      if (payload.kind !== "presence") {
        errors.push("collaboration event.payload.kind must be presence");
      }
      appendValidation(validateCollaborationPresence(payload.presence, "collaboration event.payload.presence"), errors, "collaboration event.payload.presence");
    } else if (document.kind === "selection") {
      if (payload.kind !== "selection") {
        errors.push("collaboration event.payload.kind must be selection");
      }
      appendValidation(validateCollaborationSelection(payload.selection, "collaboration event.payload.selection"), errors, "collaboration event.payload.selection");
    } else if (document.kind === "operation-result") {
      if (payload.kind !== "operationResult") {
        errors.push("collaboration event.payload.kind must be operationResult");
      }
      appendValidation(validateCollaborationOperationResult(payload.result, "collaboration event.payload.result"), errors, "collaboration event.payload.result");
    }
  }
  validateReplayMetadata(document.replay, errors, "collaboration event.replay");
  requireNonEmptyString(document.createdAt, errors, "collaboration event.createdAt");
  return validationResult(errors);
}

function validateReplayMetadata(replay, errors, label) {
  if (!requireRecord(replay, errors, label)) {
    return;
  }
  requireNonEmptyString(replay.cursor, errors, `${label}.cursor`);
  if (replay.previousCursor !== null && replay.previousCursor !== undefined) {
    requireNonEmptyString(replay.previousCursor, errors, `${label}.previousCursor`);
  }
  requireBoolean(replay.replayed, errors, `${label}.replayed`);
  requireBoolean(replay.overflow, errors, `${label}.overflow`);
  if (replay.gap !== null && replay.gap !== undefined) {
    const gap = requireRecord(replay.gap, errors, `${label}.gap`);
    if (gap) {
      requireInteger(gap.expectedSequence, errors, `${label}.gap.expectedSequence`, { min: 0 });
      requireInteger(gap.actualSequence, errors, `${label}.gap.actualSequence`, { min: 0 });
      requireNonEmptyString(gap.reason, errors, `${label}.gap.reason`);
    }
  }
}

function validateDocument(file, document, contracts) {
  if (document.schema === "skenion.project") {
    const { nodes = [], frames: _frames, ...projectDocument } = document;
    const projectResult = contracts.validateProjectDocumentV01(projectDocument);
    if (!projectResult.ok) {
      return projectResult;
    }

    const errors = [];
    for (const [index, definition] of nodes.entries()) {
      const result = contracts.validateNodeDefinitionV01(definition);
      if (!result.ok) {
        errors.push(...result.errors.map((error) => `nodes[${index}]: ${error}`));
      }
    }

    return {
      ok: errors.length === 0,
      errors
    };
  }

  if (document && typeof document === "object" && "graph" in document && Array.isArray(document.nodes)) {
    const graphResult = contracts.validateGraphDocumentV01(document.graph);
    if (!graphResult.ok) {
      return graphResult;
    }

    const errors = [];
    for (const [index, definition] of document.nodes.entries()) {
      const result = contracts.validateNodeDefinitionV01(definition);
      if (!result.ok) {
        errors.push(...result.errors.map((error) => `nodes[${index}]: ${error}`));
      }
    }

    return {
      ok: errors.length === 0,
      errors
    };
  }

  if (document.schema === "skenion.graph") {
    return contracts.validateGraphDocumentV01(document);
  }
  if (document.schema === "skenion.graph.fragment") {
    return contracts.validateGraphFragmentV01(document);
  }
  if (document.schema === "skenion.node.definition") {
    return contracts.validateNodeDefinitionV01(document);
  }
  if (document.schema === "skenion.extension.manifest") {
    return contracts.validateExtensionManifestV01(document);
  }
  if (document.schema === "skenion.runtime.operation") {
    return validateRuntimeOperationFixture(document, contracts);
  }
  if (document.schema === "skenion.runtime.collaboration.operation") {
    return validateRuntimeCollaborationFixture(document, contracts);
  }
  if (document.schema === "skenion.runtime.collaboration.operation-batch") {
    return validateRuntimeCollaborationFixture(document, contracts);
  }
  if (document.schema === "skenion.runtime.collaboration.operation-result") {
    return validateRuntimeCollaborationFixture(document, contracts);
  }
  if (document.schema === "skenion.runtime.collaboration.operation-batch-result") {
    return validateRuntimeCollaborationFixture(document, contracts);
  }
  if (document.schema === "skenion.runtime.collaboration.presence") {
    return validateRuntimeCollaborationFixture(document, contracts);
  }
  if (document.schema === "skenion.runtime.collaboration.selection") {
    return validateRuntimeCollaborationFixture(document, contracts);
  }
  if (document.schema === "skenion.runtime.collaboration.event") {
    return validateRuntimeCollaborationFixture(document, contracts);
  }

  return {
    ok: false,
    errors: [`unsupported schema ${document.schema ?? "<missing>"}`]
  };
}

const contracts = await importContracts(root, contractsPackage);
const currentCompatibilityRoot = path.join(root, "compatibility/v0.1");
const unsupportedCompatibilityRoot = path.join(root, "compatibility/unsupported/pre-consolidation-v0.1");
const unsupportedProjectsRoot = path.join(root, "projects/unsupported/pre-consolidation-v0.1");
const unsupportedTutorialsRoot = path.join(root, "tutorials/unsupported/pre-consolidation-v0.1");
const currentCompatibilityFiles = await walk(currentCompatibilityRoot);
const unsupportedCompatibilityFiles = await walk(unsupportedCompatibilityRoot);
const graphFragmentFiles = currentCompatibilityFiles.filter((file) => file.includes(`${path.sep}graph-fragments${path.sep}`));
const runtimeOperationFiles = currentCompatibilityFiles.filter((file) => file.includes(`${path.sep}runtime-operations${path.sep}`));
const collaborationFixtureFiles = currentCompatibilityFiles.filter((file) => file.includes(`${path.sep}collaboration${path.sep}`));
const currentRuntimeSessionFixtureFiles = currentCompatibilityFiles.filter((file) => file.includes(`${path.sep}runtime-session-fixtures${path.sep}`));
const ignoredCompatibilityDocumentDirs = [
  `${path.sep}patches${path.sep}`,
  `${path.sep}clock-midi-fixtures${path.sep}`,
  `${path.sep}runtime-midi-clock-fixtures${path.sep}`,
  `${path.sep}runtime-session-fixtures${path.sep}`
];
const isCompatibilityDocumentFile = (file) => ignoredCompatibilityDocumentDirs.every((dir) => !file.includes(dir));
const currentCompatibilityDocumentFiles = currentCompatibilityFiles.filter(isCompatibilityDocumentFile);
const validCurrentCompatibilityDocumentFiles = currentCompatibilityDocumentFiles.filter((file) => !file.includes(`${path.sep}invalid${path.sep}`));
const invalidCurrentCompatibilityDocumentFiles = currentCompatibilityDocumentFiles.filter((file) => file.includes(`${path.sep}invalid${path.sep}`));
const currentTutorialManifestFile = path.join(root, "tutorials/v0.1/tutorials.manifest.json");
const currentTutorialManifest = await readJson(currentTutorialManifestFile);
const currentProjectDocumentFiles = (await walk(path.join(root, "projects/v0.1"))).filter((file) => file.endsWith(".skenion.json"));
const unsupportedProjectDocumentFiles = (await walk(unsupportedProjectsRoot)).filter((file) => file.endsWith(".skenion.json"));
const unsupportedTutorialFiles = await walk(unsupportedTutorialsRoot);
const projectDocumentFiles = [
  ...currentProjectDocumentFiles
];
const extensionManifestFiles = (await walk(path.join(root, "extensions"))).filter((file) => path.basename(file) === "skenion.extension.json");
const failures = [];

for (const file of validCurrentCompatibilityDocumentFiles) {
  const result = validateDocument(file, await readJson(file), contracts);
  if (!result.ok) {
    failures.push(`${file}: expected document-valid compatibility fixture, got ${result.errors.join("; ")}`);
  }
}

for (const file of invalidCurrentCompatibilityDocumentFiles) {
  const result = validateDocument(file, await readJson(file), contracts);
  if (result.ok) {
    failures.push(`${file}: expected contract-invalid compatibility fixture, got valid`);
  }
}

for (const file of projectDocumentFiles) {
  const project = await readJson(file);
  const result = validateDocument(file, project, contracts);
  if (!result.ok) {
    failures.push(`${file}: expected valid project document, got ${result.errors.join("; ")}`);
    continue;
  }

  const viewNodeIds = new Set(Object.keys(project.viewState?.canvas?.nodes ?? {}));
  for (const node of project.graph?.nodes ?? []) {
    if (!viewNodeIds.has(node.id)) {
      failures.push(`${file}: viewState missing node ${node.id}`);
    }
  }
}

for (const file of extensionManifestFiles) {
  const result = validateDocument(file, await readJson(file), contracts);
  if (!result.ok) {
    failures.push(`${file}: expected valid extension manifest, got ${result.errors.join("; ")}`);
  }
}

const subpatchMatrixFile = path.join(root, "compatibility/v0.1/projects/valid/subpatch-contract-matrix.project.json");
const subpatchMatrixProject = await readJson(subpatchMatrixFile);
const derivedPatchContracts = contracts.derivePatchContractsV01(subpatchMatrixProject);
const expectedPatchContracts = new Map([
  ["zero_port", []],
  ["input_only", [["value", "input"]]],
  ["output_only", [["value", "output"]]],
  ["two_in_three_out", [["left", "input"], ["right", "input"], ["sum", "output"], ["difference", "output"], ["thru", "output"]]]
]);
for (const [patchId, expectedPorts] of expectedPatchContracts) {
  const patchContract = derivedPatchContracts.find((contract) => contract.id === patchId);
  if (!patchContract) {
    failures.push(`${subpatchMatrixFile}: missing derived patch contract ${patchId}`);
    continue;
  }
  const actualPorts = patchContract.ports.map((port) => [port.id, port.direction]);
  if (JSON.stringify(actualPorts) !== JSON.stringify(expectedPorts)) {
    failures.push(`${subpatchMatrixFile}: ${patchId} expected derived ports ${JSON.stringify(expectedPorts)}, got ${JSON.stringify(actualPorts)}`);
  }
}

const liveHelpProjectFile = path.join(root, "compatibility/v0.1/projects/valid/live-help-graph-fragment.project.json");
const liveHelpProject = await readJson(liveHelpProjectFile);
if (liveHelpProject.help?.workingCopy?.kind !== "help-working-copy") {
  failures.push(`${liveHelpProjectFile}: expected help.workingCopy.kind to be help-working-copy`);
}
if (liveHelpProject.help?.copyableFragment !== "compatibility/v0.1/graph-fragments/valid/live-help-copyable-selection.fragment.json") {
  failures.push(`${liveHelpProjectFile}: expected help.copyableFragment to point at the live-help graph fragment fixture`);
}
if (liveHelpProject.help?.promoteOperation !== "compatibility/v0.1/runtime-operations/valid/promote-help-selection-to-root.operation.json") {
  failures.push(`${liveHelpProjectFile}: expected help.promoteOperation to point at the promote-to-project paste operation fixture`);
}

async function validateTutorialManifest(manifestFile, manifest) {
  if (manifest.schema !== "skenion.examples.tutorials.manifest") {
    failures.push(`${manifestFile}: expected schema skenion.examples.tutorials.manifest`);
  }
  if (manifest.schemaVersion !== "0.1.0") {
    failures.push(`${manifestFile}: expected schemaVersion 0.1.0`);
  }
  if (manifest.active !== true) {
    failures.push(`${manifestFile}: expected active true`);
  }
  if (!Array.isArray(manifest.tutorials) || manifest.tutorials.length === 0) {
    failures.push(`${manifestFile}: tutorials must be a non-empty array`);
  }

  const tutorialIds = new Set();
  for (const [index, tutorial] of (manifest.tutorials ?? []).entries()) {
    if (typeof tutorial.id !== "string" || tutorial.id.length === 0) {
      failures.push(`${manifestFile}: tutorials[${index}].id must be a non-empty string`);
      continue;
    }
    if (tutorialIds.has(tutorial.id)) {
      failures.push(`${manifestFile}: duplicate tutorial id ${tutorial.id}`);
    }
    tutorialIds.add(tutorial.id);
    if (typeof tutorial.title !== "string" || tutorial.title.length === 0) {
      failures.push(`${manifestFile}: ${tutorial.id} title must be a non-empty string`);
    }
    if (typeof tutorial.description !== "string" || tutorial.description.length === 0) {
      failures.push(`${manifestFile}: ${tutorial.id} description must be a non-empty string`);
    }
    if (!Array.isArray(tutorial.tags) || tutorial.tags.length === 0) {
      failures.push(`${manifestFile}: ${tutorial.id} tags must be a non-empty array`);
    }
    if (typeof tutorial.path !== "string" || tutorial.path.length === 0) {
      failures.push(`${manifestFile}: ${tutorial.id} path must be a non-empty string`);
      continue;
    }

    const tutorialFile = path.join(root, tutorial.path);
    const tutorialDocument = await readJson(tutorialFile);
    const result = validateDocument(tutorialFile, tutorialDocument, contracts);
    if (!result.ok) {
      failures.push(`${tutorialFile}: expected valid tutorial document, got ${result.errors.join("; ")}`);
    }

    const tutorialGraph = tutorialDocument.schema === "skenion.project"
      ? tutorialDocument.graph
      : tutorialDocument;
    if (tutorial.requiresCurrentProjectDocument !== true) {
      failures.push(`${manifestFile}: ${tutorial.id} must require a current project document`);
    }
    if (tutorialDocument.schema !== "skenion.project" || tutorialDocument.schemaVersion !== "0.1.0") {
      failures.push(`${tutorialFile}: current tutorial must be ProjectDocumentV01`);
    }
    if (tutorialGraph?.schemaVersion !== "0.1.0") {
      failures.push(`${tutorialFile}: current tutorial graph must be GraphDocumentV01`);
    }
    if (!Array.isArray(tutorialDocument.patchLibrary)) {
      failures.push(`${tutorialFile}: current tutorial project must declare patchLibrary`);
    }
    if (!tutorial.tags.includes("v0.1")) {
      failures.push(`${manifestFile}: ${tutorial.id} tutorial tags must include v0.1`);
    }
    if (tutorial.tags.includes("live-help") && !(tutorialGraph?.nodes ?? []).some((node) => node.kind === "core.live-help")) {
      failures.push(`${tutorialFile}: live-help tutorial must include a core.live-help node`);
    }
    if (tutorial.tags.includes("subpatch") && !tutorialDocument.patchLibrary?.some((patch) => patch.graph?.schemaVersion === "0.1.0")) {
      failures.push(`${tutorialFile}: subpatch tutorial must include a current 0.1 patch library graph`);
    }

    if (tutorial.projectPath !== undefined) {
      if (typeof tutorial.projectPath !== "string" || tutorial.projectPath.length === 0) {
        failures.push(`${manifestFile}: ${tutorial.id} projectPath must be a non-empty string`);
      } else {
        const projectFile = path.join(root, tutorial.projectPath);
        const project = await readJson(projectFile);
        const projectResult = validateDocument(projectFile, project, contracts);
        if (!projectResult.ok) {
          failures.push(`${projectFile}: expected valid tutorial project, got ${projectResult.errors.join("; ")}`);
        }
        if (project.schemaVersion !== "0.1.0") {
          failures.push(`${projectFile}: tutorial projectPath must point to current ProjectDocumentV01`);
        }
      }
    }
  }
}

await validateTutorialManifest(currentTutorialManifestFile, currentTutorialManifest);

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}

console.log(
  `validated current 0.1 fixtures: ${validCurrentCompatibilityDocumentFiles.length} document-valid compatibility fixtures, ${invalidCurrentCompatibilityDocumentFiles.length} contract-invalid compatibility fixtures, ${graphFragmentFiles.length} graph fragments, ${runtimeOperationFiles.length} runtime operation fixtures, ${collaborationFixtureFiles.length} collaboration fixtures, ${currentRuntimeSessionFixtureFiles.length} runtime session smoke fixtures reserved for runtime smoke, ${currentProjectDocumentFiles.length} project documents, and ${currentTutorialManifest.tutorials.length} tutorials; excluded unsupported pre-consolidation fixtures: ${unsupportedCompatibilityFiles.length} compatibility documents, ${unsupportedProjectDocumentFiles.length} project documents, and ${unsupportedTutorialFiles.length} tutorial documents; shared: ${extensionManifestFiles.length} extension manifests with ${contractsPackage}`
);
