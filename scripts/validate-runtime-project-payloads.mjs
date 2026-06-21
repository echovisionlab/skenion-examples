import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const contractsPackage = "@skenion/contracts";
const runtimeUrl = process.env.SKENION_RUNTIME_URL?.replace(/\/+$/, "");

async function importContracts() {
  // Runtime JSON fixtures must validate against the released package, not a
  // sibling contracts checkout or contracts main.
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

function fail(file, message) {
  throw new Error(`${file}: ${message}`);
}

function validateProjectPayload(file, payload, contracts) {
  if (!payload || typeof payload !== "object" || !("graph" in payload) || !Array.isArray(payload.nodes)) {
    fail(file, "expected { graph, nodes } project payload");
  }

  if (payload.schema === "skenion.project") {
    if (payload.schemaVersion !== "0.2.0") {
      fail(file, `unsupported project schemaVersion ${payload.schemaVersion ?? "<missing>"}`);
    }
    const { nodes: _nodes, frames: _frames, ...projectDocument } = payload;
    const projectResult = contracts.validateProjectDocumentV02(projectDocument);
    if (!projectResult.ok) {
      fail(file, `invalid project document: ${projectResult.errors.join("; ")}`);
    }
  }

  const graphResult = payload.graph?.schemaVersion === "0.2.0"
    ? contracts.validateGraphDocumentV02(payload.graph)
    : contracts.validateGraphDocument(payload.graph);
  if (!graphResult.ok) {
    fail(file, `invalid graph document: ${graphResult.errors.join("; ")}`);
  }

  for (const [index, definition] of payload.nodes.entries()) {
    const result = definition.schemaVersion === "0.2.0"
      ? contracts.validateNodeDefinitionV02(definition)
      : contracts.validateNodeDefinition(definition);
    if (!result.ok) {
      fail(file, `invalid node definition ${index}: ${result.errors.join("; ")}`);
    }
  }
}

async function postValidate(file, payload) {
  const response = await fetch(`${runtimeUrl}/v0/validate`, {
    body: JSON.stringify(payload),
    headers: {
      "content-type": "application/json"
    },
    method: "POST"
  });
  if (!response.ok) {
    fail(file, `runtime returned HTTP ${response.status}`);
  }
  return response.json();
}

function expectedInvalidReason(file) {
  if (file.endsWith("missing-definition.project.json")) {
    return ["missing node definition"];
  }
  if (file.endsWith("incompatible-edge.project.json")) {
    return ["incompatible edge", "not compatible", "port snapshot mismatch"];
  }
  if (file.endsWith("ambiguous-algebraic-loop.project.json")) {
    return ["ambiguous-algebraic-loop"];
  }
  return [];
}

function hasDiagnosticCode(response, code) {
  return (response.diagnostics ?? []).some((diagnostic) => diagnostic.code === code);
}

const contracts = await importContracts();
const legacyFiles = await walk(path.join(root, "compatibility/v0.1/projects"));
const activeFiles = await walk(path.join(root, "compatibility/v0.2/projects"));
const validLegacyFiles = legacyFiles.filter((file) => file.includes(`${path.sep}valid${path.sep}`));
const invalidLegacyFiles = legacyFiles.filter((file) => file.includes(`${path.sep}invalid${path.sep}`));
const validActiveFiles = activeFiles.filter((file) => file.includes(`${path.sep}valid${path.sep}`));
const invalidActiveFiles = activeFiles.filter((file) => file.includes(`${path.sep}invalid${path.sep}`));
const validFiles = [
  ...validActiveFiles,
  ...validLegacyFiles
];
const invalidFiles = [
  ...invalidActiveFiles,
  ...invalidLegacyFiles
];

for (const file of validFiles) {
  validateProjectPayload(file, await readJson(file), contracts);
}

for (const file of invalidFiles) {
  try {
    validateProjectPayload(file, await readJson(file), contracts);
  } catch (error) {
    if (file.includes(`${path.sep}v0.2${path.sep}`)) {
      continue;
    }
    throw error;
  }
}

if (runtimeUrl) {
  let legacyUnsupportedCount = 0;

  for (const file of validActiveFiles) {
    const response = await postValidate(file, await readJson(file));
    if (response.ok !== true) {
      fail(file, `expected runtime ok:true, got ${JSON.stringify(response.diagnostics)}`);
    }
  }

  for (const file of invalidActiveFiles) {
    const response = await postValidate(file, await readJson(file));
    if (response.ok !== false) {
      fail(file, "expected runtime ok:false, got ok:true");
    }
    const reasons = expectedInvalidReason(file);
    const diagnostics = response.diagnostics?.map((diagnostic) => diagnostic.message).join("; ") ?? "";
    if (reasons.length > 0 && !reasons.some((reason) => diagnostics.includes(reason))) {
      fail(file, `expected diagnostic containing one of ${JSON.stringify(reasons)}, got ${diagnostics}`);
    }
  }

  for (const file of validLegacyFiles) {
    const response = await postValidate(file, await readJson(file));
    if (response.ok === true) {
      continue;
    }
    if (hasDiagnosticCode(response, "project.active-v0.1-unsupported")) {
      legacyUnsupportedCount += 1;
      continue;
    }
    fail(file, `expected legacy runtime ok:true or active-v0.1 quarantine, got ${JSON.stringify(response.diagnostics)}`);
  }

  for (const file of invalidLegacyFiles) {
    const response = await postValidate(file, await readJson(file));
    if (response.ok !== false) {
      fail(file, "expected legacy runtime ok:false, got ok:true");
    }
  }

  if (legacyUnsupportedCount > 0) {
    console.log(
      `runtime quarantined ${legacyUnsupportedCount} legacy v0.1 project payload fixtures as project.active-v0.1-unsupported`
    );
  }
}

console.log(
  `validated active v0.2 runtime project payload fixtures: ${validActiveFiles.length} valid and ${invalidActiveFiles.length} invalid; legacy v0.1 runtime project payload fixtures: ${validLegacyFiles.length} valid and ${invalidLegacyFiles.length} invalid with released ${contractsPackage}`
);
