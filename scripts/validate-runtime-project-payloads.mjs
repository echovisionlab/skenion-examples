import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const contractsPackage = process.env.SKENION_CONTRACTS_PACKAGE
  ?? path.join(root, ".deps/skenion-contracts/packages/ts/dist");
const runtimeUrl = process.env.SKENION_RUNTIME_URL?.replace(/\/+$/, "");

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

function fail(file, message) {
  throw new Error(`${file}: ${message}`);
}

function validateProjectPayload(file, payload, contracts) {
  if (!payload || typeof payload !== "object" || !("graph" in payload) || !Array.isArray(payload.nodes)) {
    fail(file, "expected { graph, nodes } project payload");
  }

  const graphResult = contracts.validateGraphDocument(payload.graph);
  if (!graphResult.ok) {
    fail(file, `invalid graph document: ${graphResult.errors.join("; ")}`);
  }

  for (const [index, definition] of payload.nodes.entries()) {
    const result = contracts.validateNodeDefinition(definition);
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
    return "missing node definition";
  }
  if (file.endsWith("incompatible-edge.project.json")) {
    return "incompatible edge";
  }
  return "";
}

const contracts = await importContracts();
const projectRoot = path.join(root, "compatibility/v0.1/projects");
const files = await walk(projectRoot);
const validFiles = files.filter((file) => file.includes(`${path.sep}valid${path.sep}`));
const invalidFiles = files.filter((file) => file.includes(`${path.sep}invalid${path.sep}`));

for (const file of files) {
  validateProjectPayload(file, await readJson(file), contracts);
}

if (runtimeUrl) {
  for (const file of validFiles) {
    const response = await postValidate(file, await readJson(file));
    if (response.ok !== true) {
      fail(file, `expected runtime ok:true, got ${JSON.stringify(response.diagnostics)}`);
    }
  }

  for (const file of invalidFiles) {
    const response = await postValidate(file, await readJson(file));
    if (response.ok !== false) {
      fail(file, "expected runtime ok:false, got ok:true");
    }
    const reason = expectedInvalidReason(file);
    const diagnostics = response.diagnostics?.map((diagnostic) => diagnostic.message).join("; ") ?? "";
    if (reason && !diagnostics.includes(reason)) {
      fail(file, `expected diagnostic containing "${reason}", got ${diagnostics}`);
    }
  }
}

console.log(
  `validated ${validFiles.length} valid and ${invalidFiles.length} invalid runtime project payload fixtures`
);
