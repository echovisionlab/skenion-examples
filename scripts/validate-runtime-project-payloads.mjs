import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const linkedContractsPackage = path.join(root, ".deps/skenion-contracts/packages/ts/dist/index.js");
const releaseMode = process.env.SKENION_RELEASE_MODE === "1";
const contractsPackageOverride = process.env.SKENION_CONTRACTS_PACKAGE;
if (releaseMode && contractsPackageOverride && contractsPackageOverride !== "@skenion/contracts") {
  throw new Error("release mode must use the released @skenion/contracts package, not a SKENION_CONTRACTS_PACKAGE override");
}
if (releaseMode && existsSync(linkedContractsPackage)) {
  throw new Error("release mode must not consume .deps/skenion-contracts; remove the sibling checkout from the release job");
}
const contractsPackage = process.env.SKENION_CONTRACTS_PACKAGE
  ?? (releaseMode ? "@skenion/contracts" : (existsSync(linkedContractsPackage) ? linkedContractsPackage : "@skenion/contracts"));
const runtimeUrl = process.env.SKENION_RUNTIME_URL?.replace(/\/+$/, "");

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

function fail(file, message) {
  throw new Error(`${file}: ${message}`);
}

function validateProjectPayload(file, payload, contracts) {
  if (!payload || typeof payload !== "object" || !("graph" in payload) || !Array.isArray(payload.nodes)) {
    fail(file, "expected { graph, nodes } project payload");
  }

  if (payload.schema === "skenion.project") {
    const { nodes: _nodes, frames: _frames, ...projectDocument } = payload;
    const projectResult = contracts.validateProjectDocumentV01(projectDocument);
    if (!projectResult.ok) {
      fail(file, `invalid project document: ${projectResult.errors.join("; ")}`);
    }
  }

  const graphResult = contracts.validateGraphDocumentV01(payload.graph);
  if (!graphResult.ok) {
    fail(file, `invalid graph document: ${graphResult.errors.join("; ")}`);
  }

  for (const [index, definition] of payload.nodes.entries()) {
    const result = contracts.validateNodeDefinitionV01(definition);
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

const contracts = await importContracts();
const currentFiles = await walk(path.join(root, "compatibility/v0.1/projects"));
const unsupportedFiles = await walk(path.join(root, "compatibility/unsupported/pre-consolidation-v0.1/projects"));
const validCurrentFiles = currentFiles.filter((file) => file.includes(`${path.sep}valid${path.sep}`));
const invalidCurrentFiles = currentFiles.filter((file) => file.includes(`${path.sep}invalid${path.sep}`));
const unsupportedProjectFiles = unsupportedFiles.filter((file) => file.endsWith(".json"));

for (const file of validCurrentFiles) {
  validateProjectPayload(file, await readJson(file), contracts);
}

for (const file of invalidCurrentFiles) {
  try {
    validateProjectPayload(file, await readJson(file), contracts);
  } catch (error) {
    continue;
  }
  fail(file, "expected contract-invalid project payload, got valid");
}

if (runtimeUrl) {
  for (const file of validCurrentFiles) {
    const response = await postValidate(file, await readJson(file));
    if (response.ok !== true) {
      fail(file, `expected runtime ok:true, got ${JSON.stringify(response.diagnostics)}`);
    }
  }

  for (const file of invalidCurrentFiles) {
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
}

console.log(
  `validated current 0.1 runtime project payload fixtures: ${validCurrentFiles.length} valid and ${invalidCurrentFiles.length} invalid with ${contractsPackage}; excluded unsupported pre-consolidation project payload fixtures: ${unsupportedProjectFiles.length}`
);
