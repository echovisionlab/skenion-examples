import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const linkedContractsPackage = path.join(root, ".deps/skenion-contracts/packages/ts/dist/index.js");
const contractsPackage = process.env.SKENION_CONTRACTS_PACKAGE
  ?? (existsSync(linkedContractsPackage) ? linkedContractsPackage : "@skenion/contracts");

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

const contracts = await importContracts();
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
