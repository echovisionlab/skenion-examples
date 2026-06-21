import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const contractsPackage = process.env.SKENION_CONTRACTS_PACKAGE
  ?? "@skenion/contracts";

async function importContracts() {
  if (contractsPackage.startsWith(".") || path.isAbsolute(contractsPackage)) {
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
  if (document.schema === "skenion.project") {
    if (document.schemaVersion === "0.2.0") {
      const { nodes = [], frames: _frames, ...projectDocument } = document;
      const projectResult = contracts.validateProjectDocumentV02(projectDocument);
      if (!projectResult.ok) {
        return projectResult;
      }

      const errors = [];
      for (const [index, definition] of nodes.entries()) {
        const result = contracts.validateNodeDefinitionV02(definition);
        if (!result.ok) {
          errors.push(...result.errors.map((error) => `nodes[${index}]: ${error}`));
        }
      }

      return {
        ok: errors.length === 0,
        errors
      };
    }

    return contracts.validateProjectDocument(document);
  }

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
  if (document.schema === "skenion.graph.fragment") {
    return contracts.validateGraphFragmentV02(document);
  }
  if (document.schema === "skenion.node.definition") {
    return document.schemaVersion === "0.2.0"
      ? contracts.validateNodeDefinitionV02(document)
      : contracts.validateNodeDefinition(document);
  }
  if (document.schema === "skenion.graph.patch") {
    return contracts.validateGraphPatch(document);
  }
  if (document.schema === "skenion.extension.manifest") {
    return contracts.validateExtensionManifestV01(document);
  }
  if (document.schema === "skenion.runtime.operation") {
    return contracts.validateRuntimeOperationEnvelope(document);
  }
  if (document.schema === "skenion.runtime.paste-graph-fragment.response") {
    return contracts.validatePasteGraphFragmentResponse(document);
  }
  if (document.schema === "skenion.runtime.collaboration.operation") {
    return contracts.validateRuntimeCollaborationOperationEnvelope(document);
  }
  if (document.schema === "skenion.runtime.collaboration.operation-batch") {
    return contracts.validateRuntimeCollaborationOperationBatch(document);
  }
  if (document.schema === "skenion.runtime.collaboration.operation-result") {
    return contracts.validateRuntimeCollaborationOperationResult(document);
  }
  if (document.schema === "skenion.runtime.collaboration.operation-batch-result") {
    return contracts.validateRuntimeCollaborationOperationBatchResult(document);
  }
  if (document.schema === "skenion.runtime.collaboration.presence") {
    return contracts.validateRuntimeCollaborationPresenceEnvelope(document);
  }
  if (document.schema === "skenion.runtime.collaboration.selection") {
    return contracts.validateRuntimeCollaborationSelectionEnvelope(document);
  }
  if (document.schema === "skenion.runtime.collaboration.event") {
    return contracts.validateRuntimeCollaborationEventEnvelope(document);
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
const legacyCompatibilityFiles = await walk(path.join(root, "compatibility/v0.1"));
const activeCompatibilityFiles = await walk(path.join(root, "compatibility/v0.2"));
const graphFragmentFiles = activeCompatibilityFiles.filter((file) => file.includes(`${path.sep}graph-fragments${path.sep}`));
const runtimeOperationFiles = activeCompatibilityFiles.filter((file) => file.includes(`${path.sep}runtime-operations${path.sep}`));
const collaborationFixtureFiles = activeCompatibilityFiles.filter((file) => file.includes(`${path.sep}collaboration${path.sep}`));
const legacyRuntimeSessionFixtureFiles = legacyCompatibilityFiles.filter((file) => file.includes(`${path.sep}runtime-session-fixtures${path.sep}`));
const activeRuntimeSessionFixtureFiles = activeCompatibilityFiles.filter((file) => file.includes(`${path.sep}runtime-session-fixtures${path.sep}`));
const clockMidiFixtureFiles = legacyCompatibilityFiles.filter((file) => file.includes(`${path.sep}clock-midi-fixtures${path.sep}`));
const runtimeClockMidiFixtureFiles = legacyCompatibilityFiles.filter((file) => file.includes(`${path.sep}runtime-midi-clock-fixtures${path.sep}`));
const supportsClockMidiFixtures =
  typeof contracts.createInitialMidiClockSnapshotV01 === "function"
  && typeof contracts.midiClockSnapshotToClockStateV01 === "function"
  && typeof contracts.applyMidiClockMessageV01 === "function";
const patchFiles = legacyCompatibilityFiles.filter((file) => file.includes(`${path.sep}patches${path.sep}`));
const validPatchFiles = patchFiles.filter((file) => file.includes(`${path.sep}valid${path.sep}`));
const invalidPatchFiles = patchFiles.filter((file) => file.includes(`${path.sep}invalid${path.sep}`));
const ignoredCompatibilityDocumentDirs = [
  `${path.sep}patches${path.sep}`,
  `${path.sep}clock-midi-fixtures${path.sep}`,
  `${path.sep}runtime-midi-clock-fixtures${path.sep}`,
  `${path.sep}runtime-session-fixtures${path.sep}`
];
const isCompatibilityDocumentFile = (file) => ignoredCompatibilityDocumentDirs.every((dir) => !file.includes(dir));
const legacyCompatibilityDocumentFiles = legacyCompatibilityFiles.filter(isCompatibilityDocumentFile);
const activeCompatibilityDocumentFiles = activeCompatibilityFiles.filter(isCompatibilityDocumentFile);
const validActiveCompatibilityDocumentFiles = activeCompatibilityDocumentFiles.filter((file) => !file.includes(`${path.sep}invalid${path.sep}`));
const invalidActiveCompatibilityDocumentFiles = activeCompatibilityDocumentFiles.filter((file) => file.includes(`${path.sep}invalid${path.sep}`));
const validLegacyCompatibilityDocumentFiles = legacyCompatibilityDocumentFiles;
const activeTutorialManifestFile = path.join(root, "tutorials/v0.2/tutorials.manifest.json");
const legacyTutorialManifestFile = path.join(root, "tutorials/v0.1/tutorials.manifest.json");
const activeTutorialManifest = await readJson(activeTutorialManifestFile);
const legacyTutorialManifest = await readJson(legacyTutorialManifestFile);
const activeProjectDocumentFiles = (await walk(path.join(root, "projects/v0.2"))).filter((file) => file.endsWith(".skenion.json"));
const legacyProjectDocumentFiles = (await walk(path.join(root, "projects/v0.1"))).filter((file) => file.endsWith(".skenion.json"));
const projectDocumentFiles = [
  ...activeProjectDocumentFiles,
  ...legacyProjectDocumentFiles
];
const extensionManifestFiles = (await walk(path.join(root, "extensions"))).filter((file) => path.basename(file) === "skenion.extension.json");
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

for (const file of [...validActiveCompatibilityDocumentFiles, ...validLegacyCompatibilityDocumentFiles]) {
  const result = validateDocument(file, await readJson(file), contracts);
  if (!result.ok) {
    failures.push(`${file}: expected document-valid compatibility fixture, got ${result.errors.join("; ")}`);
  }
}

for (const file of invalidActiveCompatibilityDocumentFiles) {
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

for (const file of extensionManifestFiles) {
  const result = validateDocument(file, await readJson(file), contracts);
  if (!result.ok) {
    failures.push(`${file}: expected valid extension manifest, got ${result.errors.join("; ")}`);
  }
}

const subpatchMatrixFile = path.join(root, "compatibility/v0.2/projects/valid/subpatch-contract-matrix.project.json");
const subpatchMatrixProject = await readJson(subpatchMatrixFile);
const derivedPatchContracts = contracts.derivePatchContractsV02(subpatchMatrixProject);
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

const liveHelpProjectFile = path.join(root, "compatibility/v0.2/projects/valid/live-help-graph-fragment.project.json");
const liveHelpProject = await readJson(liveHelpProjectFile);
if (liveHelpProject.help?.workingCopy?.kind !== "help-working-copy") {
  failures.push(`${liveHelpProjectFile}: expected help.workingCopy.kind to be help-working-copy`);
}
if (liveHelpProject.help?.copyableFragment !== "compatibility/v0.2/graph-fragments/valid/live-help-copyable-selection.fragment.json") {
  failures.push(`${liveHelpProjectFile}: expected help.copyableFragment to point at the live-help graph fragment fixture`);
}
if (liveHelpProject.help?.promoteOperation !== "compatibility/v0.2/runtime-operations/valid/promote-help-selection-to-root.operation.json") {
  failures.push(`${liveHelpProjectFile}: expected help.promoteOperation to point at the promote-to-project paste operation fixture`);
}

async function validateTutorialManifest(manifestFile, manifest, options) {
  if (manifest.schema !== "skenion.examples.tutorials.manifest") {
    failures.push(`${manifestFile}: expected schema skenion.examples.tutorials.manifest`);
  }
  if (manifest.schemaVersion !== options.schemaVersion) {
    failures.push(`${manifestFile}: expected schemaVersion ${options.schemaVersion}`);
  }
  if (options.active && manifest.active !== true) {
    failures.push(`${manifestFile}: expected active true`);
  }
  if (!options.active && manifest.coverage !== "legacy-import-migration") {
    failures.push(`${manifestFile}: expected legacy import/migration coverage label`);
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
    if (options.active) {
      if (tutorial.requiresV02ProjectDocument !== true) {
        failures.push(`${manifestFile}: ${tutorial.id} must require a v0.2 project document`);
      }
      if (tutorialDocument.schema !== "skenion.project" || tutorialDocument.schemaVersion !== "0.2.0") {
        failures.push(`${tutorialFile}: active tutorial must be ProjectDocumentV02`);
      }
      if (tutorialGraph?.schemaVersion !== "0.2.0") {
        failures.push(`${tutorialFile}: active tutorial graph must be GraphDocumentV02`);
      }
      if (!Array.isArray(tutorialDocument.patchLibrary)) {
        failures.push(`${tutorialFile}: active tutorial project must declare patchLibrary`);
      }
      if (!tutorial.tags.includes("v0.2")) {
        failures.push(`${manifestFile}: ${tutorial.id} active tutorial tags must include v0.2`);
      }
      if (tutorial.tags.includes("live-help") && !(tutorialGraph?.nodes ?? []).some((node) => node.kind === "core.live-help")) {
        failures.push(`${tutorialFile}: live-help tutorial must include a core.live-help node`);
      }
      if (tutorial.tags.includes("subpatch") && !tutorialDocument.patchLibrary?.some((patch) => patch.graph?.schemaVersion === "0.2.0")) {
        failures.push(`${tutorialFile}: subpatch tutorial must include a v0.2 patch library graph`);
      }
    } else {
      if (tutorialGraph?.schemaVersion !== "0.1.0") {
        failures.push(`${tutorialFile}: legacy tutorial graph must remain v0.1`);
      }
      if (!(tutorialGraph?.nodes ?? []).some((node) => node.kind === "core.comment")) {
        failures.push(`${tutorialFile}: legacy tutorial graph must include at least one core.comment node`);
      }
      for (const helpNodeId of tutorial.helpNodeIds ?? []) {
        if (!contracts.getBuiltinNodeHelp(helpNodeId)) {
          failures.push(`${manifestFile}: ${tutorial.id} references missing help ${helpNodeId}`);
        }
        if (!contracts.getBuiltinNodeHelpGraph(helpNodeId)) {
          failures.push(`${manifestFile}: ${tutorial.id} references missing help graph ${helpNodeId}`);
        }
      }

      const shaderSources = (tutorialGraph?.nodes ?? [])
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
        if (options.active && project.schemaVersion !== "0.2.0") {
          failures.push(`${projectFile}: active tutorial projectPath must point to ProjectDocumentV02`);
        }
        if (!options.active && project.schemaVersion !== "0.1.0") {
          failures.push(`${projectFile}: legacy tutorial projectPath must remain ProjectDocument v0.1`);
        }
      }
    }
  }
}

await validateTutorialManifest(activeTutorialManifestFile, activeTutorialManifest, {
  active: true,
  schemaVersion: "0.2.0"
});
await validateTutorialManifest(legacyTutorialManifestFile, legacyTutorialManifest, {
  active: false,
  schemaVersion: "0.1.0"
});

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
  `validated active v0.2 fixtures: ${validActiveCompatibilityDocumentFiles.length} document-valid compatibility fixtures, ${invalidActiveCompatibilityDocumentFiles.length} contract-invalid compatibility fixtures, ${graphFragmentFiles.length} graph fragments, ${runtimeOperationFiles.length} runtime operation fixtures, ${collaborationFixtureFiles.length} collaboration fixtures, ${activeRuntimeSessionFixtureFiles.length} runtime session smoke fixtures reserved for runtime smoke, ${activeProjectDocumentFiles.length} project documents, and ${activeTutorialManifest.tutorials.length} tutorials; legacy v0.1 fixtures: ${validFiles.length} contract-valid fixtures, ${invalidFiles.length} contract-invalid fixtures, ${validLegacyCompatibilityDocumentFiles.length} document-valid compatibility fixtures, ${clockMidiSummary}, ${runtimeClockMidiFixtureFiles.length} runtime MIDI Clock fixtures reserved for runtime smoke, ${legacyRuntimeSessionFixtureFiles.length} runtime session smoke fixtures reserved for runtime smoke, ${validPatchFiles.length} valid patches, ${invalidPatchFiles.length} invalid patches, ${legacyProjectDocumentFiles.length} project documents, and ${legacyTutorialManifest.tutorials.length} tutorials; shared: ${extensionManifestFiles.length} extension manifests with @skenion/contracts`
);
