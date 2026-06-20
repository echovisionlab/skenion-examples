import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const contractsPackage = process.env.SKENION_CONTRACTS_PACKAGE
  ?? path.join(root, ".deps/skenion-contracts/packages/ts/dist");

async function importContracts() {
  if (contractsPackage.startsWith(".") || contractsPackage.startsWith("/") || contractsPackage.includes(path.sep)) {
    const entry = contractsPackage.endsWith(".js")
      ? contractsPackage
      : path.join(contractsPackage, "index.js");
    return import(pathToFileURL(path.resolve(root, entry)).href);
  }

  return import(contractsPackage);
}

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

function validateDocument(file, document, contracts) {
  if (document && typeof document === "object" && "graph" in document && Array.isArray(document.nodes)) {
    const graphResult = document.graph?.schemaVersion === "0.2.0"
      ? contracts.validateGraphDocumentV02(document.graph)
      : contracts.validateGraphDocument(document.graph);
    if (!graphResult.ok) {
      return graphResult;
    }

    const errors = [];
    for (const [index, definition] of document.nodes.entries()) {
      const result = definition.schemaVersion === "0.2.0"
        ? contracts.validateNodeDefinitionV02(definition)
        : contracts.validateNodeDefinition(definition);
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
    return document.schemaVersion === "0.2.0"
      ? contracts.validateGraphDocumentV02(document)
      : contracts.validateGraphDocument(document);
  }
  if (document.schema === "skenion.node.definition") {
    return document.schemaVersion === "0.2.0"
      ? contracts.validateNodeDefinitionV02(document)
      : contracts.validateNodeDefinition(document);
  }
  if (document.schema === "skenion.graph.patch") {
    return contracts.validateGraphPatch(document);
  }
  if (document.schema === "skenion.project") {
    return contracts.validateProjectDocument(document);
  }

  return {
    ok: false,
    errors: [`unsupported schema ${document.schema ?? "<missing>"}`]
  };
}

function clockMidiMessage(event) {
  if (event.message === "tick") {
    return { kind: "tick", receivedHostTimeNs: event.atNs };
  }
  if (event.message === "start") {
    return { kind: "start", receivedHostTimeNs: event.atNs };
  }
  if (event.message === "stop") {
    return { kind: "stop", receivedHostTimeNs: event.atNs };
  }
  if (event.message === "continue") {
    return { kind: "continue", receivedHostTimeNs: event.atNs };
  }
  if (event.message === "spp") {
    return {
      kind: "song-position-pointer",
      songPositionSixteenth: event.songPositionSixteenth,
      receivedHostTimeNs: event.atNs
    };
  }
  return null;
}

function validateClockMidiFixture(file, fixture, contracts) {
  const errors = [];
  if (fixture.schema !== "skenion.clock-midi.fixture") {
    errors.push(`expected schema skenion.clock-midi.fixture, got ${fixture.schema ?? "<missing>"}`);
  }
  if (fixture.schemaVersion !== "0.1.0") {
    errors.push(`expected schemaVersion 0.1.0, got ${fixture.schemaVersion ?? "<missing>"}`);
  }
  if (!Array.isArray(fixture.events)) {
    errors.push("events must be an array");
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  let snapshot = contracts.createInitialMidiClockSnapshotV01({
    sourceId: fixture.sourceId,
    timeSignature: fixture.timeSignature ?? null
  });
  let state = contracts.midiClockSnapshotToClockStateV01(snapshot);
  const diagnostics = [];

  for (const [index, event] of fixture.events.entries()) {
    const message = clockMidiMessage(event);
    if (!message) {
      errors.push(`events[${index}] unsupported message ${event.message ?? "<missing>"}`);
      continue;
    }
    const result = contracts.applyMidiClockMessageV01(snapshot, message);
    snapshot = result.snapshot;
    state = result.clockState;
    diagnostics.push(...result.diagnostics);
  }

  if (fixture.expectedDiagnostic) {
    if (!diagnostics.some((diagnostic) => diagnostic.code === fixture.expectedDiagnostic)) {
      errors.push(`expected diagnostic ${fixture.expectedDiagnostic}, got ${diagnostics.map((diagnostic) => diagnostic.code).join(", ") || "<none>"}`);
    }
    return { ok: errors.length === 0, errors };
  }

  if (diagnostics.length > 0) {
    errors.push(`unexpected diagnostics: ${diagnostics.map((diagnostic) => diagnostic.code).join(", ")}`);
  }

  for (const [fieldName, expected] of Object.entries(fixture.expected ?? {})) {
    const field = state[fieldName];
    if (!field) {
      errors.push(`missing expected ClockState field ${fieldName}`);
      continue;
    }
    if (field.value !== expected.value) {
      errors.push(`${fieldName}.value expected ${expected.value}, got ${field.value}`);
    }
    if (field.authority !== expected.authority) {
      errors.push(`${fieldName}.authority expected ${expected.authority}, got ${field.authority}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

const contracts = await importContracts();
const fixtureRoot = path.join(root, "fixtures/contract/v0.1");
const validFiles = (await walk(fixtureRoot)).filter((file) => file.includes(`${path.sep}valid${path.sep}`));
const invalidFiles = (await walk(fixtureRoot)).filter((file) => file.includes(`${path.sep}invalid${path.sep}`));
const compatibilityFiles = [
  ...await walk(path.join(root, "compatibility/v0.1")),
  ...await walk(path.join(root, "compatibility/v0.2"))
];
const clockMidiFixtureFiles = compatibilityFiles.filter((file) => file.includes(`${path.sep}clock-midi-fixtures${path.sep}`));
const supportsClockMidiFixtures =
  typeof contracts.createInitialMidiClockSnapshotV01 === "function"
  && typeof contracts.midiClockSnapshotToClockStateV01 === "function"
  && typeof contracts.applyMidiClockMessageV01 === "function";
const patchFiles = compatibilityFiles.filter((file) => file.includes(`${path.sep}patches${path.sep}`));
const validPatchFiles = patchFiles.filter((file) => file.includes(`${path.sep}valid${path.sep}`));
const invalidPatchFiles = patchFiles.filter((file) => file.includes(`${path.sep}invalid${path.sep}`));
const compatibilityDocumentFiles = compatibilityFiles.filter((file) => !file.includes(`${path.sep}patches${path.sep}`) && !file.includes(`${path.sep}clock-midi-fixtures${path.sep}`));
const validCompatibilityDocumentFiles = compatibilityDocumentFiles.filter((file) => !file.includes(`${path.sep}invalid${path.sep}`));
const invalidCompatibilityDocumentFiles = compatibilityDocumentFiles.filter((file) => file.includes(`${path.sep}invalid${path.sep}`) && file.includes(`${path.sep}v0.2${path.sep}`));
const documentValidCompatibilityFiles = compatibilityDocumentFiles.filter((file) => file.includes(`${path.sep}invalid${path.sep}`) && file.includes(`${path.sep}v0.1${path.sep}`));
const tutorialManifestFile = path.join(root, "tutorials/v0.1/tutorials.manifest.json");
const tutorialManifest = await readJson(tutorialManifestFile);
const projectDocumentFiles = (await walk(path.join(root, "projects"))).filter((file) => file.endsWith(".skenion.json"));
const failures = [];

for (const file of validFiles) {
  const result = validateDocument(file, await readJson(file), contracts);
  if (!result.ok) {
    failures.push(`${file}: expected valid, got ${result.errors.join("; ")}`);
  }
}

for (const file of invalidFiles) {
  const result = validateDocument(file, await readJson(file), contracts);
  if (result.ok) {
    failures.push(`${file}: expected invalid, got valid`);
  }
}

for (const file of [...validCompatibilityDocumentFiles, ...documentValidCompatibilityFiles]) {
  const result = validateDocument(file, await readJson(file), contracts);
  if (!result.ok) {
    failures.push(`${file}: expected document-valid compatibility fixture, got ${result.errors.join("; ")}`);
  }
}

for (const file of invalidCompatibilityDocumentFiles) {
  const result = validateDocument(file, await readJson(file), contracts);
  if (result.ok) {
    failures.push(`${file}: expected contract-invalid compatibility fixture, got valid`);
  }
}

if (supportsClockMidiFixtures) {
  for (const file of clockMidiFixtureFiles) {
    const result = validateClockMidiFixture(file, await readJson(file), contracts);
    if (!result.ok) {
      failures.push(`${file}: expected MIDI Clock fixture to validate, got ${result.errors.join("; ")}`);
    }
  }
}

for (const file of validPatchFiles) {
  const result = validateDocument(file, await readJson(file), contracts);
  if (!result.ok) {
    failures.push(`${file}: expected valid graph patch, got ${result.errors.join("; ")}`);
  }
}

for (const file of invalidPatchFiles) {
  const result = validateDocument(file, await readJson(file), contracts);
  if (file.endsWith("unsupported-op.patch.json")) {
    if (result.ok) {
      failures.push(`${file}: expected schema-invalid graph patch, got valid`);
    }
  } else if (!result.ok) {
    failures.push(`${file}: expected schema-valid runtime-invalid graph patch, got ${result.errors.join("; ")}`);
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

if (tutorialManifest.schema !== "skenion.examples.tutorials.manifest") {
  failures.push(`${tutorialManifestFile}: expected schema skenion.examples.tutorials.manifest`);
}
if (tutorialManifest.schemaVersion !== "0.1.0") {
  failures.push(`${tutorialManifestFile}: expected schemaVersion 0.1.0`);
}
if (!Array.isArray(tutorialManifest.tutorials) || tutorialManifest.tutorials.length === 0) {
  failures.push(`${tutorialManifestFile}: tutorials must be a non-empty array`);
}
const tutorialIds = new Set();
for (const [index, tutorial] of (tutorialManifest.tutorials ?? []).entries()) {
  if (typeof tutorial.id !== "string" || tutorial.id.length === 0) {
    failures.push(`${tutorialManifestFile}: tutorials[${index}].id must be a non-empty string`);
    continue;
  }
  if (tutorialIds.has(tutorial.id)) {
    failures.push(`${tutorialManifestFile}: duplicate tutorial id ${tutorial.id}`);
  }
  tutorialIds.add(tutorial.id);
  if (typeof tutorial.title !== "string" || tutorial.title.length === 0) {
    failures.push(`${tutorialManifestFile}: ${tutorial.id} title must be a non-empty string`);
  }
  if (typeof tutorial.description !== "string" || tutorial.description.length === 0) {
    failures.push(`${tutorialManifestFile}: ${tutorial.id} description must be a non-empty string`);
  }
  if (!Array.isArray(tutorial.tags) || tutorial.tags.length === 0) {
    failures.push(`${tutorialManifestFile}: ${tutorial.id} tags must be a non-empty array`);
  }
  if (typeof tutorial.path !== "string" || tutorial.path.length === 0) {
    failures.push(`${tutorialManifestFile}: ${tutorial.id} path must be a non-empty string`);
    continue;
  }
  const tutorialFile = path.join(root, tutorial.path);
  const tutorialGraph = await readJson(tutorialFile);
  const result = validateDocument(tutorialFile, tutorialGraph, contracts);
  if (!result.ok) {
    failures.push(`${tutorialFile}: expected valid tutorial graph, got ${result.errors.join("; ")}`);
  }
  if (!(tutorialGraph.nodes ?? []).some((node) => node.kind === "core.comment")) {
    failures.push(`${tutorialFile}: tutorial graph must include at least one core.comment node`);
  }
  for (const helpNodeId of tutorial.helpNodeIds ?? []) {
    if (!contracts.getBuiltinNodeHelp(helpNodeId)) {
      failures.push(`${tutorialManifestFile}: ${tutorial.id} references missing help ${helpNodeId}`);
    }
    if (!contracts.getBuiltinNodeHelpGraph(helpNodeId)) {
      failures.push(`${tutorialManifestFile}: ${tutorial.id} references missing help graph ${helpNodeId}`);
    }
  }

  if (tutorial.projectPath !== undefined) {
    if (typeof tutorial.projectPath !== "string" || tutorial.projectPath.length === 0) {
      failures.push(`${tutorialManifestFile}: ${tutorial.id} projectPath must be a non-empty string`);
    } else {
      const projectFile = path.join(root, tutorial.projectPath);
      const project = await readJson(projectFile);
      const projectResult = validateDocument(projectFile, project, contracts);
      if (!projectResult.ok) {
        failures.push(`${projectFile}: expected valid tutorial project, got ${projectResult.errors.join("; ")}`);
      }
    }
  }

  const shaderSources = (tutorialGraph.nodes ?? [])
    .filter((node) => node.kind === "render.fullscreen-shader")
    .map((node) => node.params?.source ?? "");
  const diagnostics = shaderSources.flatMap((source) => (
    contracts.analyzeShaderInterfaceV01(source, { language: "wgsl" }).diagnostics.map((diagnostic) => diagnostic.code)
  ));
  for (const expectedDiagnostic of tutorial.expectedDiagnostics ?? []) {
    if (!diagnostics.includes(expectedDiagnostic)) {
      failures.push(`${tutorialFile}: expected shader diagnostic ${expectedDiagnostic}, got ${diagnostics.join(", ") || "<none>"}`);
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}

const clockMidiSummary = supportsClockMidiFixtures
  ? `${clockMidiFixtureFiles.length} MIDI Clock fixtures`
  : `0 MIDI Clock fixtures (${clockMidiFixtureFiles.length} skipped; @skenion/contracts does not expose clock.midi-clock parser yet)`;

console.log(
  `validated ${validFiles.length} contract-valid fixtures, ${invalidFiles.length} contract-invalid fixtures, ${validCompatibilityDocumentFiles.length + documentValidCompatibilityFiles.length} document-valid compatibility fixtures, ${invalidCompatibilityDocumentFiles.length} contract-invalid compatibility fixtures, ${clockMidiSummary}, ${validPatchFiles.length} valid patches, ${invalidPatchFiles.length} invalid patches, ${projectDocumentFiles.length} project documents, and ${tutorialManifest.tutorials.length} tutorials with @skenion/contracts`
);
