import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { importContracts, resolveContractsPackage } from "./contracts-package-source.mjs";

const root = process.cwd();
const contractsPackage = resolveContractsPackage(root);
const runtimeUrl = process.env.SKENION_RUNTIME_URL?.replace(/\/+$/, "");
const currentFixtureRoot = path.join(root, "compatibility/v0.1/runtime-session-fixtures");
const unsupportedFixtureRoot = path.join(root, "compatibility/unsupported/pre-consolidation-v0.1/runtime-session-fixtures");
const schema = "skenion.runtime.session-smoke.fixture";
const schemaVersion = "0.1.0";
const scenarios = new Set([
  "same-session-multi-view-event-replay",
  "separate-session-isolation",
  "sidecar-handshake-health",
  "remote-local-neutral-url-session-semantics"
]);

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

function rel(file) {
  return path.relative(root, file);
}

function repoPath(value, errors, label) {
  if (!isNonEmptyString(value)) {
    errors.push(`${label} must be a non-empty string`);
    return null;
  }
  if (path.isAbsolute(value)) {
    errors.push(`${label} must be repository-relative`);
    return null;
  }
  const resolved = path.resolve(root, value);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    errors.push(`${label} must stay inside the repository`);
    return null;
  }
  return resolved;
}

function requireRunIdTemplate(value, errors, label) {
  if (!isNonEmptyString(value)) {
    errors.push(`${label} must be a non-empty string`);
    return;
  }
  if (!value.includes("{runId}")) {
    errors.push(`${label} must include {runId} so repeated smoke runs stay isolated`);
  }
}

function materializeSessionId(template, runId) {
  return template.replaceAll("{runId}", runId);
}

function routeFromTemplate(template, sessionId) {
  return template.replaceAll("{sessionId}", encodeURIComponent(sessionId));
}

function absoluteRuntimeUrl(route) {
  if (!runtimeUrl) {
    throw new Error("SKENION_RUNTIME_URL is not set");
  }
  if (!route.startsWith("/")) {
    throw new Error(`runtime route must start with /, got ${route}`);
  }
  return `${runtimeUrl}${route}`;
}

async function requestJson(route, { body, headers = {}, method } = {}) {
  const response = await fetch(absoluteRuntimeUrl(route), {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined
      ? headers
      : { "content-type": "application/json", ...headers },
    method: method ?? (body === undefined ? "GET" : "POST")
  });
  if (!response.ok) {
    throw new Error(`${route}: runtime returned HTTP ${response.status}`);
  }
  return response.json();
}

async function validateProjectPayload(file, contracts, errors, label) {
  const resolved = repoPath(file, errors, label);
  if (!resolved) {
    return null;
  }
  let payload;
  try {
    payload = await readJson(resolved);
  } catch (error) {
    errors.push(`${label} could not be read: ${error.message}`);
    return null;
  }
  if (!isRecord(payload) || !isRecord(payload.graph) || !Array.isArray(payload.nodes)) {
    errors.push(`${label} must point to a runtime project payload with { graph, nodes }`);
    return null;
  }

  if (payload.schema === "skenion.project") {
    const { nodes: _nodes, frames: _frames, ...projectDocument } = payload;
    const projectResult = contracts.validateProjectDocumentV01(projectDocument);
    if (!projectResult.ok) {
      errors.push(`${label} project document is invalid: ${projectResult.errors.join("; ")}`);
    }
  }

  const graphResult = contracts.validateGraphDocumentV01(payload.graph);
  if (!graphResult.ok) {
    errors.push(`${label} graph is invalid: ${graphResult.errors.join("; ")}`);
  }

  for (const [index, definition] of payload.nodes.entries()) {
    const result = contracts.validateNodeDefinitionV01(definition);
    if (!result.ok) {
      errors.push(`${label} nodes[${index}] is invalid: ${result.errors.join("; ")}`);
    }
  }

  return payload;
}

async function validatePatch(file, contracts, errors, label) {
  const resolved = repoPath(file, errors, label);
  if (!resolved) {
    return null;
  }
  let patch;
  try {
    patch = await readJson(resolved);
  } catch (error) {
    errors.push(`${label} could not be read: ${error.message}`);
    return null;
  }
  if (typeof contracts.validateGraphPatch === "function") {
    const result = contracts.validateGraphPatch(patch);
    if (!result.ok) {
      errors.push(`${label} is not a valid graph patch: ${result.errors.join("; ")}`);
    }
  }
  return patch;
}

function validateRequiresCapabilities(fixture, errors) {
  const capabilities = fixture.runtime?.requiresCapabilities;
  if (!Array.isArray(capabilities) || capabilities.length === 0) {
    errors.push("runtime.requiresCapabilities must be a non-empty array");
    return;
  }
  for (const [index, capability] of capabilities.entries()) {
    if (!isNonEmptyString(capability)) {
      errors.push(`runtime.requiresCapabilities[${index}] must be a non-empty string`);
    }
  }
}

function validateExpectedCapabilities(capabilities, info, label) {
  const available = new Set(info.capabilities ?? []);
  const missing = capabilities.filter((capability) => !available.has(capability));
  if (missing.length > 0) {
    throw new Error(`${label}: runtime missing required capabilities: ${missing.join(", ")}`);
  }
}

function requireRecord(value, label) {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
}

function requireBoolean(value, label) {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`);
  }
}

function requireInteger(value, label, { min = 0 } = {}) {
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${label} must be an integer >= ${min}`);
  }
}

function requireOptionalInteger(value, label, options) {
  if (value !== null && value !== undefined) {
    requireInteger(value, label, options);
  }
}

function requireString(value, label) {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
}

function requireNonEmptyString(value, label) {
  if (!isNonEmptyString(value)) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function requireRuntimeDiagnostics(value, label) {
  const diagnostics = requireArray(value, `${label}.diagnostics`);
  for (const [index, diagnostic] of diagnostics.entries()) {
    const entry = requireRecord(diagnostic, `${label}.diagnostics[${index}]`);
    requireString(entry.message, `${label}.diagnostics[${index}].message`);
  }
}

function assertRuntimeInfo(value, label) {
  const info = requireRecord(value, label);
  requireNonEmptyString(info.name, `${label}.name`);
  requireNonEmptyString(info.version, `${label}.version`);
  requireNonEmptyString(info.apiVersion, `${label}.apiVersion`);
  requireNonEmptyString(info.contractsBuiltAgainstVersion, `${label}.contractsBuiltAgainstVersion`);
  requireNonEmptyString(info.supportedContractsLine, `${label}.supportedContractsLine`);
  requireNonEmptyString(info.supportedContractsRange, `${label}.supportedContractsRange`);
  for (const [index, capability] of requireArray(info.capabilities, `${label}.capabilities`).entries()) {
    requireNonEmptyString(capability, `${label}.capabilities[${index}]`);
  }
}

function assertRuntimeHealth(value, label) {
  const health = requireRecord(value, label);
  requireBoolean(health.ok, `${label}.ok`);
  requireNonEmptyString(health.service, `${label}.service`);
  requireNonEmptyString(health.version, `${label}.version`);
  requireNonEmptyString(health.apiVersion, `${label}.apiVersion`);
}

function assertSessionInfo(value, label) {
  const info = requireRecord(value, label);
  assertEqual(info.schema, "skenion.runtime.session.info", `${label} schema`);
  assertEqual(info.schemaVersion, schemaVersion, `${label} schemaVersion`);
  requireBoolean(info.ok, `${label}.ok`);
  requireNonEmptyString(info.sessionId, `${label}.sessionId`);
  assertSessionSnapshot(info.snapshot, `${label}.snapshot`);
  const capabilities = requireRecord(info.capabilities, `${label}.capabilities`);
  requireBoolean(capabilities.sessionAddressing, `${label}.capabilities.sessionAddressing`);
  requireBoolean(capabilities.eventReplay, `${label}.capabilities.eventReplay`);
  requireBoolean(capabilities.multiWindow, `${label}.capabilities.multiWindow`);
  requireArray(capabilities.profiles, `${label}.capabilities.profiles`);
  requireNonEmptyString(capabilities.authPolicy, `${label}.capabilities.authPolicy`);
  const replay = requireRecord(info.eventReplay, `${label}.eventReplay`);
  assertEqual(replay.cursorKind, "sequence", `${label} eventReplay cursorKind`);
  requireNonEmptyString(replay.currentCursor, `${label}.eventReplay.currentCursor`);
  requireInteger(replay.earliestSequence, `${label}.eventReplay.earliestSequence`, { min: 1 });
  requireInteger(replay.latestSequence, `${label}.eventReplay.latestSequence`, { min: 0 });
  requireOptionalInteger(replay.replayLimit, `${label}.eventReplay.replayLimit`, { min: 1 });
  if (replay.overflow !== undefined) {
    requireBoolean(replay.overflow, `${label}.eventReplay.overflow`);
  }
  requireRuntimeDiagnostics(info.diagnostics, label);
}

function assertSessionEvent(value, label) {
  const event = requireRecord(value, label);
  assertEqual(event.schema, "skenion.runtime.session.event", `${label} schema`);
  assertEqual(event.schemaVersion, schemaVersion, `${label} schemaVersion`);
  requireNonEmptyString(event.id, `${label}.id`);
  requireNonEmptyString(event.sessionId, `${label}.sessionId`);
  requireInteger(event.sequence, `${label}.sequence`, { min: 1 });
  requireInteger(event.sessionRevision, `${label}.sessionRevision`, { min: 0 });
  requireNonEmptyString(event.kind, `${label}.kind`);
  assertSessionSnapshot(event.snapshot, `${label}.snapshot`);
  assertHistory(event.history, `${label}.history`);
  if (event.mutation !== null && event.mutation !== undefined) {
    assertHistoryEntry(event.mutation, `${label}.mutation`);
  }
  const replay = requireRecord(event.replay, `${label}.replay`);
  requireNonEmptyString(replay.cursor, `${label}.replay.cursor`);
  if (replay.previousCursor !== null && replay.previousCursor !== undefined) {
    requireString(replay.previousCursor, `${label}.replay.previousCursor`);
  }
  requireBoolean(replay.replayed, `${label}.replay.replayed`);
  requireBoolean(replay.overflow, `${label}.replay.overflow`);
  if (replay.gap !== null && replay.gap !== undefined) {
    const gap = requireRecord(replay.gap, `${label}.replay.gap`);
    requireInteger(gap.expectedSequence, `${label}.replay.gap.expectedSequence`, { min: 0 });
    requireInteger(gap.actualSequence, `${label}.replay.gap.actualSequence`, { min: 0 });
    requireNonEmptyString(gap.reason, `${label}.replay.gap.reason`);
  }
  requireRuntimeDiagnostics(event.diagnostics, label);
  requireNonEmptyString(event.createdAt, `${label}.createdAt`);
}

function assertRuntimeSessionResponse(value, label) {
  const response = requireRecord(value, label);
  requireBoolean(response.ok, `${label}.ok`);
  assertSessionSnapshot(response.snapshot, `${label}.snapshot`);
  requireRuntimeDiagnostics(response.diagnostics, label);
}

function assertPatchResponse(value, label) {
  const response = requireRecord(value, label);
  requireBoolean(response.ok, `${label}.ok`);
  requireBoolean(response.applied, `${label}.applied`);
  requireBoolean(response.conflict, `${label}.conflict`);
  assertSessionSnapshot(response.snapshot, `${label}.snapshot`);
  assertHistory(response.history, `${label}.history`);
  requireRuntimeDiagnostics(response.diagnostics, label);
}

function assertSessionSnapshot(value, label) {
  const snapshot = requireRecord(value, label);
  requireInteger(snapshot.sessionRevision, `${label}.sessionRevision`, { min: 0 });
  requireInteger(snapshot.viewRevision, `${label}.viewRevision`, { min: 0 });
  requireInteger(snapshot.controlRevision, `${label}.controlRevision`, { min: 0 });
  if (snapshot.project !== null && snapshot.project !== undefined) {
    const project = requireRecord(snapshot.project, `${label}.project`);
    const graph = requireRecord(project.graph, `${label}.project.graph`);
    requireNonEmptyString(graph.id, `${label}.project.graph.id`);
    requireNonEmptyString(graph.revision, `${label}.project.graph.revision`);
  }
  requireRuntimeDiagnostics(snapshot.diagnostics, label);
}

function assertHistory(value, label) {
  const history = requireRecord(value, label);
  assertEqual(history.schema, "skenion.runtime.history", `${label} schema`);
  assertEqual(history.schemaVersion, schemaVersion, `${label} schemaVersion`);
  for (const [index, entry] of requireArray(history.entries, `${label}.entries`).entries()) {
    assertHistoryEntry(entry, `${label}.entries[${index}]`);
  }
  requireBoolean(history.canUndo, `${label}.canUndo`);
  requireBoolean(history.canRedo, `${label}.canRedo`);
  requireInteger(history.undoDepth, `${label}.undoDepth`, { min: 0 });
  requireInteger(history.redoDepth, `${label}.redoDepth`, { min: 0 });
}

function assertHistoryEntry(value, label) {
  const entry = requireRecord(value, label);
  requireNonEmptyString(entry.id, `${label}.id`);
  requireInteger(entry.sequence, `${label}.sequence`, { min: 1 });
  requireNonEmptyString(entry.kind, `${label}.kind`);
  requireRecord(entry.mutation, `${label}.mutation`);
  requireRecord(entry.inverseMutation, `${label}.inverseMutation`);
  requireNonEmptyString(entry.createdAt, `${label}.createdAt`);
}

function assertControlEventResponse(value, label) {
  const response = requireRecord(value, label);
  requireBoolean(response.ok, `${label}.ok`);
  requireBoolean(response.changed, `${label}.changed`);
  requireOptionalInteger(response.controlRevision, `${label}.controlRevision`, { min: 0 });
  for (const [index, emission] of requireArray(response.emitted, `${label}.emitted`).entries()) {
    const entry = requireRecord(emission, `${label}.emitted[${index}]`);
    requireNonEmptyString(entry.nodeId, `${label}.emitted[${index}].nodeId`);
    requireNonEmptyString(entry.portId, `${label}.emitted[${index}].portId`);
    requireRecord(entry.message, `${label}.emitted[${index}].message`);
  }
  requireRuntimeDiagnostics(response.diagnostics, label);
}

function assertControlStateResponse(value, label) {
  const response = requireRecord(value, label);
  requireBoolean(response.ok, `${label}.ok`);
  requireInteger(response.controlRevision, `${label}.controlRevision`, { min: 0 });
  requireRecord(response.values, `${label}.values`);
  requireRecord(response.channels, `${label}.channels`);
  requireRuntimeDiagnostics(response.diagnostics, label);
}

function assertDeepEqual(left, right, label) {
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    throw new Error(`${label}: expected values to match`);
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(value, label) {
  if (value !== true) {
    throw new Error(`${label}: expected true, got ${JSON.stringify(value)}`);
  }
}

function graphMutation(patch) {
  return {
    graphPatch: patch,
    clientId: "skenion-examples",
    description: "M06.8 runtime session smoke mutation"
  };
}

async function readFirstSessionSseEvent(route, { lastEventId } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  let reader;
  try {
    const headers = lastEventId === undefined ? {} : { "last-event-id": lastEventId };
    const response = await fetch(absoluteRuntimeUrl(route), {
      headers,
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`${route}: runtime returned HTTP ${response.status}`);
    }
    if (!response.body) {
      throw new Error(`${route}: response did not include a readable body`);
    }

    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        throw new Error(`${route}: stream ended before a session event`);
      }
      text += decoder.decode(value, { stream: true });
      const parsed = parseFirstSseEvent(text);
      if (parsed) {
        assertSessionEvent(parsed.data, route);
        return parsed.data;
      }
    }
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`${route}: timed out waiting for session SSE event`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    if (reader) {
      await reader.cancel().catch(() => {});
    }
  }
}

function parseFirstSseEvent(text) {
  const normalized = text.replaceAll("\r\n", "\n");
  const eventTexts = normalized.split("\n\n");
  if (!normalized.endsWith("\n\n")) {
    eventTexts.pop();
  }
  for (const eventText of eventTexts) {
    if (eventText.trim().length === 0) {
      continue;
    }

    let eventType = "message";
    const dataLines = [];
    for (const line of eventText.split("\n")) {
      if (line.startsWith("event:")) {
        eventType = line.slice("event:".length).trimStart();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trimStart());
      }
    }
    if (eventType === "session" && dataLines.length > 0) {
      return {
        eventType,
        data: JSON.parse(dataLines.join("\n"))
      };
    }
  }
  return null;
}

async function validateSameSessionFixture(fixture, contracts, errors) {
  const session = fixture.session;
  if (!isRecord(session)) {
    errors.push("session must be an object");
    return;
  }
  requireRunIdTemplate(session.id, errors, "session.id");
  await validateProjectPayload(session.project, contracts, errors, "session.project");
  await validatePatch(session.patch, contracts, errors, "session.patch");

  if (!Array.isArray(fixture.clients) || !fixture.clients.includes("view-a") || !fixture.clients.includes("view-b")) {
    errors.push("clients must include view-a and view-b");
  }

  const event = fixture.expect?.event;
  if (!isRecord(event)) {
    errors.push("expect.event must be an object");
    return;
  }
  if (event.kind !== "mutate") {
    errors.push("expect.event.kind must be mutate");
  }
  if (event.replayed !== true) {
    errors.push("expect.event.replayed must be true");
  }
  if (event.sessionId !== session.id) {
    errors.push("expected event sessionId must match session.id");
  }
  if (event.afterCursor !== "loaded" && !/^\d+$/.test(String(event.afterCursor))) {
    errors.push("expect.event.afterCursor must be loaded or a non-negative integer string");
  }
  if (event.expectedSequence !== undefined) {
    if (!Number.isInteger(event.expectedSequence) || event.expectedSequence < 1) {
      errors.push("expect.event.expectedSequence must be a positive integer");
    }
    if (/^\d+$/.test(String(event.afterCursor)) && event.expectedSequence <= Number(event.afterCursor)) {
      errors.push("expectedSequence must be greater than afterCursor");
    }
  }
}

async function validateSeparateSessionFixture(fixture, contracts, errors) {
  if (!Array.isArray(fixture.sessions) || fixture.sessions.length !== 2) {
    errors.push("sessions must contain exactly primary and secondary sessions");
    return;
  }
  const roles = new Set();
  const ids = new Set();
  for (const [index, session] of fixture.sessions.entries()) {
    if (!isRecord(session)) {
      errors.push(`sessions[${index}] must be an object`);
      continue;
    }
    if (!["primary", "secondary"].includes(session.role)) {
      errors.push(`sessions[${index}].role must be primary or secondary`);
    }
    roles.add(session.role);
    requireRunIdTemplate(session.id, errors, `sessions[${index}].id`);
    if (ids.has(session.id)) {
      errors.push(`duplicate session id template ${session.id}`);
    }
    ids.add(session.id);
    const payload = await validateProjectPayload(session.project, contracts, errors, `sessions[${index}].project`);
    if (payload && session.expectedGraphId !== payload.graph.id) {
      errors.push(`sessions[${index}].expectedGraphId must match project graph id ${payload.graph.id}`);
    }
    if (session.patch !== undefined) {
      await validatePatch(session.patch, contracts, errors, `sessions[${index}].patch`);
    }
  }
  if (!roles.has("primary") || !roles.has("secondary")) {
    errors.push("sessions must include primary and secondary roles");
  }
  if (fixture.expect?.isolatedSnapshots !== true) {
    errors.push("expect.isolatedSnapshots must be true");
  }
  if (fixture.expect?.isolatedHistory !== true) {
    errors.push("expect.isolatedHistory must be true");
  }
  if (fixture.expect?.isolatedControlState !== true) {
    errors.push("expect.isolatedControlState must be true");
  }
}

function validateSidecarFixture(fixture, errors) {
  const paths = fixture.paths;
  if (!isRecord(paths)) {
    errors.push("paths must be an object");
    return;
  }
  if (paths.runtimeHealth !== "/health") {
    errors.push("paths.runtimeHealth must be /health");
  }
  if (paths.startup !== "/v0/sidecar/startup") {
    errors.push("paths.startup must be /v0/sidecar/startup");
  }
  if (paths.sidecarHealth !== "/v0/sidecar/health") {
    errors.push("paths.sidecarHealth must be /v0/sidecar/health");
  }
  if (fixture.expect?.defaultSessionId !== "default") {
    errors.push("expect.defaultSessionId must be default");
  }
  if (fixture.expect?.defaultSessionPath !== "/v0/sessions/default") {
    errors.push("expect.defaultSessionPath must be /v0/sessions/default");
  }
  if (fixture.expect?.shutdownScope !== "owned-child-only") {
    errors.push("expect.shutdownScope must be owned-child-only");
  }
}

async function validateRemoteLocalNeutralFixture(fixture, contracts, errors) {
  const session = fixture.session;
  if (!isRecord(session)) {
    errors.push("session must be an object");
    return;
  }
  requireRunIdTemplate(session.id, errors, "session.id");
  const payload = await validateProjectPayload(session.project, contracts, errors, "session.project");
  if (payload && fixture.expect?.graphId !== payload.graph.id) {
    errors.push(`expect.graphId must match session.project graph id ${payload.graph.id}`);
  }

  const paths = fixture.paths;
  if (!isRecord(paths)) {
    errors.push("paths must be an object");
    return;
  }
  if ("defaultAlias" in paths) {
    errors.push("paths.defaultAlias is unsupported; use explicitSessionTemplate");
  }
  const expectedPaths = {
    explicitSessionTemplate: "/v0/sessions/{sessionId}",
    sessionInfoTemplate: "/v0/sessions/{sessionId}/info",
    eventsStreamTemplate: "/v0/sessions/{sessionId}/events/stream"
  };
  for (const [key, expected] of Object.entries(expectedPaths)) {
    if (paths[key] !== expected) {
      errors.push(`paths.${key} must be ${expected}`);
    }
    if (typeof paths[key] === "string" && /^[a-z][a-z0-9+.-]*:\/\//i.test(paths[key])) {
      errors.push(`paths.${key} must be path-only, not an absolute URL`);
    }
  }

  const samples = fixture.baseUrlSamples;
  if (!Array.isArray(samples) || samples.length !== 3) {
    errors.push("baseUrlSamples must include local-managed, local-shared, and remote examples");
    return;
  }
  const sampleProfiles = new Set();
  for (const [index, sample] of samples.entries()) {
    if (!isRecord(sample)) {
      errors.push(`baseUrlSamples[${index}] must be an object`);
      continue;
    }
    sampleProfiles.add(sample.profile);
    try {
      const sessionId = materializeSessionId(session.id, "example");
      const route = routeFromTemplate(paths.explicitSessionTemplate, sessionId);
      const url = new URL(`${sample.baseUrl.replace(/\/+$/, "")}${route}`);
      if (url.pathname !== route) {
        errors.push(`baseUrlSamples[${index}] must preserve session route pathname`);
      }
    } catch (error) {
      errors.push(`baseUrlSamples[${index}].baseUrl must be an absolute URL: ${error.message}`);
    }
  }
  for (const profile of ["local-managed", "local-shared", "remote"]) {
    if (!sampleProfiles.has(profile)) {
      errors.push(`baseUrlSamples must include ${profile}`);
    }
    if (!(fixture.expect?.profileModes ?? []).includes(profile)) {
      errors.push(`expect.profileModes must include ${profile}`);
    }
  }
  if (fixture.expect?.pathOnlySessionAddressing !== true) {
    errors.push("expect.pathOnlySessionAddressing must be true");
  }
}

async function validateFixture(file, fixture, contracts) {
  const errors = [];
  if (!isRecord(fixture)) {
    return ["fixture must be an object"];
  }
  if (fixture.schema !== schema) {
    errors.push(`schema must be ${schema}`);
  }
  if (fixture.schemaVersion !== schemaVersion) {
    errors.push(`schemaVersion must be ${schemaVersion}`);
  }
  if (!scenarios.has(fixture.scenario)) {
    errors.push(`unsupported scenario ${fixture.scenario ?? "<missing>"}`);
  }
  if (!isNonEmptyString(fixture.title)) {
    errors.push("title must be a non-empty string");
  }
  if (!isNonEmptyString(fixture.description)) {
    errors.push("description must be a non-empty string");
  }
  validateRequiresCapabilities(fixture, errors);

  if (fixture.scenario === "same-session-multi-view-event-replay") {
    await validateSameSessionFixture(fixture, contracts, errors);
  } else if (fixture.scenario === "separate-session-isolation") {
    await validateSeparateSessionFixture(fixture, contracts, errors);
  } else if (fixture.scenario === "sidecar-handshake-health") {
    validateSidecarFixture(fixture, errors);
  } else if (fixture.scenario === "remote-local-neutral-url-session-semantics") {
    await validateRemoteLocalNeutralFixture(fixture, contracts, errors);
  }

  return errors;
}

async function runSameSessionFixture(fixture, contracts, runtimeInfo, runId) {
  validateExpectedCapabilities(fixture.runtime.requiresCapabilities, runtimeInfo, fixture.title);
  const sessionId = materializeSessionId(fixture.session.id, runId);
  const project = await readJson(path.join(root, fixture.session.project));
  const patch = await readJson(path.join(root, fixture.session.patch));
  const sessionRoute = `/v0/sessions/${encodeURIComponent(sessionId)}`;

  const load = await requestJson(`${sessionRoute}/load`, { body: project });
  assertRuntimeSessionResponse(load, `${fixture.title} load`);
  assertTrue(load.ok, `${fixture.title} load ok`);

  const info = await requestJson(`${sessionRoute}/info`);
  assertSessionInfo(info, `${fixture.title} loaded info`);
  const loadedCursor = info.eventReplay.currentCursor;
  if (!/^\d+$/.test(loadedCursor)) {
    throw new Error(`${fixture.title}: loaded cursor must be numeric, got ${loadedCursor}`);
  }

  const mutation = await requestJson(`${sessionRoute}/mutate`, { body: graphMutation(patch) });
  assertPatchResponse(mutation, `${fixture.title} mutation`);
  assertTrue(mutation.ok, `${fixture.title} mutation ok`);
  assertTrue(mutation.applied, `${fixture.title} mutation applied`);

  const replay = await readFirstSessionSseEvent(
    `${sessionRoute}/events/stream?after=${encodeURIComponent(loadedCursor)}`
  );
  assertSameSessionReplayEvent(fixture, replay, sessionId, Number(loadedCursor), mutation, `${fixture.title} after replay`);

  if (fixture.expect.alsoAcceptsLastEventId) {
    const lastEventReplay = await readFirstSessionSseEvent(`${sessionRoute}/events/stream`, {
      lastEventId: loadedCursor
    });
    assertSameSessionReplayEvent(
      fixture,
      lastEventReplay,
      sessionId,
      Number(loadedCursor),
      mutation,
      `${fixture.title} Last-Event-ID replay`
    );
  }
}

function assertSameSessionReplayEvent(fixture, event, sessionId, loadedCursor, mutation, label) {
  assertEqual(event.sessionId, sessionId, `${label} session id`);
  assertEqual(event.kind, fixture.expect.event.kind, `${label} kind`);
  assertEqual(event.replay.replayed, fixture.expect.event.replayed, `${label} replayed`);
  if (event.sequence <= loadedCursor) {
    throw new Error(`${label}: replay sequence ${event.sequence} must be greater than cursor ${loadedCursor}`);
  }
  if (fixture.expect.event.snapshotRevisionMatchesMutation) {
    assertEqual(
      event.snapshot.sessionRevision,
      mutation.snapshot.sessionRevision,
      `${label} snapshot sessionRevision`
    );
  }
}

async function runSeparateSessionFixture(fixture, contracts, runtimeInfo, runId) {
  validateExpectedCapabilities(fixture.runtime.requiresCapabilities, runtimeInfo, fixture.title);
  const primary = fixture.sessions.find((session) => session.role === "primary");
  const secondary = fixture.sessions.find((session) => session.role === "secondary");
  const primaryId = materializeSessionId(primary.id, runId);
  const secondaryId = materializeSessionId(secondary.id, runId);
  const primaryRoute = `/v0/sessions/${encodeURIComponent(primaryId)}`;
  const secondaryRoute = `/v0/sessions/${encodeURIComponent(secondaryId)}`;

  await requestJson(`${primaryRoute}/load`, {
    body: await readJson(path.join(root, primary.project))
  });
  await requestJson(`${secondaryRoute}/load`, {
    body: await readJson(path.join(root, secondary.project))
  });

  const mutation = await requestJson(`${primaryRoute}/mutate`, {
    body: graphMutation(await readJson(path.join(root, primary.patch)))
  });
  assertPatchResponse(mutation, `${fixture.title} primary mutation`);
  assertTrue(mutation.ok, `${fixture.title} primary mutation ok`);

  const control = await requestJson(`${primaryRoute}/control/event`, {
    body: primary.controlEvent
  });
  assertControlEventResponse(control, `${fixture.title} primary control event`);
  assertTrue(control.ok, `${fixture.title} primary control event ok`);

  const primarySnapshot = await requestJson(primaryRoute);
  const secondarySnapshot = await requestJson(secondaryRoute);
  const primaryHistory = await requestJson(`${primaryRoute}/history`);
  const secondaryHistory = await requestJson(`${secondaryRoute}/history`);
  const secondaryControl = await requestJson(`${secondaryRoute}/control/state`);

  assertRuntimeSessionResponse(primarySnapshot, `${fixture.title} primary snapshot`);
  assertRuntimeSessionResponse(secondarySnapshot, `${fixture.title} secondary snapshot`);
  assertHistory(primaryHistory, `${fixture.title} primary history`);
  assertHistory(secondaryHistory, `${fixture.title} secondary history`);
  assertControlStateResponse(secondaryControl, `${fixture.title} secondary control state`);

  assertEqual(
    primarySnapshot.snapshot.project.graph.id,
    primary.expectedGraphId,
    `${fixture.title} primary graph id`
  );
  assertEqual(
    primarySnapshot.snapshot.project.graph.revision,
    primary.expectedGraphRevisionAfterPatch,
    `${fixture.title} primary graph revision`
  );
  assertEqual(
    secondarySnapshot.snapshot.project.graph.id,
    secondary.expectedGraphId,
    `${fixture.title} secondary graph id`
  );
  assertEqual(
    secondarySnapshot.snapshot.project.graph.revision,
    secondary.expectedGraphRevision,
    `${fixture.title} secondary graph revision`
  );
  assertEqual(
    secondaryHistory.entries.length,
    secondary.expectedHistoryEntries,
    `${fixture.title} secondary history entries`
  );
  assertEqual(
    secondaryControl.controlRevision,
    secondary.expectedControlRevision,
    `${fixture.title} secondary control revision`
  );
  if (primaryHistory.entries.length === 0) {
    throw new Error(`${fixture.title}: primary history should contain the mutation`);
  }
}

async function runSidecarFixture(fixture, contracts, runtimeInfo) {
  validateExpectedCapabilities(fixture.runtime.requiresCapabilities, runtimeInfo, fixture.title);
  const runtimeHealth = await requestJson(fixture.paths.runtimeHealth);
  assertRuntimeHealth(runtimeHealth, `${fixture.title} runtime health`);
  assertEqual(runtimeHealth.service, fixture.expect.runtimeService, `${fixture.title} service`);

  const startup = await requestJson(fixture.paths.startup);
  assertEqual(startup.schema, fixture.expect.startupSchema, `${fixture.title} startup schema`);
  assertEqual(startup.schemaVersion, schemaVersion, `${fixture.title} startup schemaVersion`);
  assertTrue(startup.ok, `${fixture.title} startup ok`);
  assertEqual(startup.defaultSessionId, fixture.expect.defaultSessionId, `${fixture.title} default session id`);
  if (!startup.defaultSessionUrl.endsWith(fixture.expect.defaultSessionPath)) {
    throw new Error(`${fixture.title}: startup.defaultSessionUrl must end with ${fixture.expect.defaultSessionPath}`);
  }
  assertEqual(startup.shutdown.scope, fixture.expect.shutdownScope, `${fixture.title} shutdown scope`);

  const sidecarHealth = await requestJson(fixture.paths.sidecarHealth);
  assertEqual(sidecarHealth.schema, fixture.expect.healthSchema, `${fixture.title} health schema`);
  assertEqual(sidecarHealth.schemaVersion, schemaVersion, `${fixture.title} health schemaVersion`);
  assertTrue(sidecarHealth.ok, `${fixture.title} health ok`);
  assertEqual(sidecarHealth.readiness, fixture.expect.readiness, `${fixture.title} readiness`);
  assertDeepEqual(sidecarHealth.endpoint, startup.endpoint, `${fixture.title} endpoint`);
}

async function runRemoteLocalNeutralFixture(fixture, contracts, runtimeInfo, runId) {
  validateExpectedCapabilities(fixture.runtime.requiresCapabilities, runtimeInfo, fixture.title);
  const sessionId = materializeSessionId(fixture.session.id, runId);
  const sessionRoute = routeFromTemplate(fixture.paths.explicitSessionTemplate, sessionId);
  const infoRoute = routeFromTemplate(fixture.paths.sessionInfoTemplate, sessionId);

  for (const profileMode of fixture.expect.profileModes) {
    const capability = `runtime.profile.${profileMode.replace(/-([a-z])/g, (_, char) => char.toUpperCase())}`;
    if (!runtimeInfo.capabilities.includes(capability)) {
      throw new Error(`${fixture.title}: runtime info missing profile capability ${capability}`);
    }
  }

  const load = await requestJson(`${sessionRoute}/load`, {
    body: await readJson(path.join(root, fixture.session.project))
  });
  assertRuntimeSessionResponse(load, `${fixture.title} load`);
  assertTrue(load.ok, `${fixture.title} load ok`);
  assertEqual(load.snapshot.project.graph.id, fixture.expect.graphId, `${fixture.title} graph id`);

  const info = await requestJson(infoRoute);
  assertSessionInfo(info, `${fixture.title} info`);
  assertEqual(info.sessionId, sessionId, `${fixture.title} session id`);
  assertTrue(info.capabilities.sessionAddressing, `${fixture.title} session addressing capability`);
}

async function runFixture(fixture, contracts, runtimeInfo, runId) {
  if (fixture.scenario === "same-session-multi-view-event-replay") {
    await runSameSessionFixture(fixture, contracts, runtimeInfo, runId);
  } else if (fixture.scenario === "separate-session-isolation") {
    await runSeparateSessionFixture(fixture, contracts, runtimeInfo, runId);
  } else if (fixture.scenario === "sidecar-handshake-health") {
    await runSidecarFixture(fixture, contracts, runtimeInfo);
  } else if (fixture.scenario === "remote-local-neutral-url-session-semantics") {
    await runRemoteLocalNeutralFixture(fixture, contracts, runtimeInfo, runId);
  }
}

const contracts = await importContracts(root, contractsPackage);
const currentFiles = await walk(currentFixtureRoot);
const unsupportedFiles = await walk(unsupportedFixtureRoot);
const validCurrentFiles = currentFiles.filter((file) => file.includes(`${path.sep}valid${path.sep}`));
const invalidCurrentFiles = currentFiles.filter((file) => file.includes(`${path.sep}invalid${path.sep}`));
const validFiles = [
  ...validCurrentFiles
];
const invalidFiles = [
  ...invalidCurrentFiles
];
const failures = [];
const validFixtures = [];
const currentFileSet = new Set(currentFiles);

for (const file of validFiles) {
  const fixture = await readJson(file);
  const errors = await validateFixture(file, fixture, contracts);
  if (errors.length > 0) {
    failures.push(`${rel(file)}: expected valid, got ${errors.join("; ")}`);
  } else {
    validFixtures.push({
      active: currentFileSet.has(file),
      fixture
    });
  }
}

for (const file of invalidFiles) {
  const fixture = await readJson(file);
  const errors = await validateFixture(file, fixture, contracts);
  if (errors.length === 0) {
    failures.push(`${rel(file)}: expected invalid, got valid`);
    continue;
  }
  if (!isNonEmptyString(fixture.expectedInvalidReason)) {
    failures.push(`${rel(file)}: invalid fixtures must declare expectedInvalidReason`);
    continue;
  }
  if (!errors.some((error) => error.includes(fixture.expectedInvalidReason))) {
    failures.push(`${rel(file)}: expected invalid reason containing ${JSON.stringify(fixture.expectedInvalidReason)}, got ${errors.join("; ")}`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}

let runtimeSmokeCount = 0;
let skippedUnsupportedRuntimeSmokeCount = 0;
if (runtimeUrl) {
  const runtimeInfo = await requestJson("/v0/runtime/info");
  assertRuntimeInfo(runtimeInfo, "/v0/runtime/info");
  const runId = `${Date.now().toString(36)}-${process.pid}`;
  const currentRuntimeSession = runtimeInfo.capabilities?.includes("session.load.v0.1");
  const runtimeFixtures = currentRuntimeSession
    ? validFixtures.filter((entry) => entry.active)
    : validFixtures;
  skippedUnsupportedRuntimeSmokeCount = currentRuntimeSession
    ? validFixtures.filter((entry) => !entry.active).length
    : 0;
  for (const { fixture } of runtimeFixtures) {
    await runFixture(fixture, contracts, runtimeInfo, runId);
    runtimeSmokeCount += 1;
  }
}

const runtimeSummary = runtimeUrl
  ? ` and ran ${runtimeSmokeCount} runtime session smoke scenarios against ${runtimeUrl}${skippedUnsupportedRuntimeSmokeCount > 0 ? `, skipping ${skippedUnsupportedRuntimeSmokeCount} unsupported pre-consolidation scenarios against current 0.1 Runtime` : ""}`
  : "";
console.log(
  `validated current 0.1 runtime session smoke fixtures: ${validCurrentFiles.length} valid and ${invalidCurrentFiles.length} invalid with ${contractsPackage}; excluded unsupported pre-consolidation runtime session smoke fixtures: ${unsupportedFiles.length}${runtimeSummary}`
);
