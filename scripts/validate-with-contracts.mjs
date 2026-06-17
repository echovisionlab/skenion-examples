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

  return {
    ok: false,
    errors: [`unsupported schema ${document.schema ?? "<missing>"}`]
  };
}

const contracts = await importContracts();
const fixtureRoot = path.join(root, "fixtures/contract/v0.1");
const validFiles = (await walk(fixtureRoot)).filter((file) => file.includes(`${path.sep}valid${path.sep}`));
const invalidFiles = (await walk(fixtureRoot)).filter((file) => file.includes(`${path.sep}invalid${path.sep}`));
const compatibilityFiles = [
  ...await walk(path.join(root, "compatibility/v0.1")),
  ...await walk(path.join(root, "compatibility/v0.2"))
];
const patchFiles = compatibilityFiles.filter((file) => file.includes(`${path.sep}patches${path.sep}`));
const validPatchFiles = patchFiles.filter((file) => file.includes(`${path.sep}valid${path.sep}`));
const invalidPatchFiles = patchFiles.filter((file) => file.includes(`${path.sep}invalid${path.sep}`));
const compatibilityDocumentFiles = compatibilityFiles.filter((file) => !file.includes(`${path.sep}patches${path.sep}`));
const validCompatibilityDocumentFiles = compatibilityDocumentFiles.filter((file) => !file.includes(`${path.sep}invalid${path.sep}`));
const invalidCompatibilityDocumentFiles = compatibilityDocumentFiles.filter((file) => file.includes(`${path.sep}invalid${path.sep}`) && file.includes(`${path.sep}v0.2${path.sep}`));
const documentValidCompatibilityFiles = compatibilityDocumentFiles.filter((file) => file.includes(`${path.sep}invalid${path.sep}`) && file.includes(`${path.sep}v0.1${path.sep}`));
const tutorialManifestFile = path.join(root, "tutorials/v0.1/tutorials.manifest.json");
const tutorialManifest = await readJson(tutorialManifestFile);
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
  for (const helpNodeId of tutorial.helpNodeIds ?? []) {
    if (!contracts.getBuiltinNodeHelp(helpNodeId)) {
      failures.push(`${tutorialManifestFile}: ${tutorial.id} references missing help ${helpNodeId}`);
    }
    if (!contracts.getBuiltinNodeHelpGraph(helpNodeId)) {
      failures.push(`${tutorialManifestFile}: ${tutorial.id} references missing help graph ${helpNodeId}`);
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

console.log(
  `validated ${validFiles.length} contract-valid fixtures, ${invalidFiles.length} contract-invalid fixtures, ${validCompatibilityDocumentFiles.length + documentValidCompatibilityFiles.length} document-valid compatibility fixtures, ${invalidCompatibilityDocumentFiles.length} contract-invalid compatibility fixtures, ${validPatchFiles.length} valid patches, ${invalidPatchFiles.length} invalid patches, and ${tutorialManifest.tutorials.length} tutorials with @skenion/contracts`
);
