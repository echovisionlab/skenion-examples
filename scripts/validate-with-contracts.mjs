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
    const graphResult = contracts.validateGraphDocument(document.graph);
    if (!graphResult.ok) {
      return graphResult;
    }

    const errors = [];
    for (const [index, definition] of document.nodes.entries()) {
      const result = contracts.validateNodeDefinition(definition);
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
    return contracts.validateGraphDocument(document);
  }
  if (document.schema === "skenion.node.definition") {
    return contracts.validateNodeDefinition(document);
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
const compatibilityRoot = path.join(root, "compatibility/v0.1");
const compatibilityFiles = await walk(compatibilityRoot);
const patchFiles = compatibilityFiles.filter((file) => file.includes(`${path.sep}patches${path.sep}`));
const validPatchFiles = patchFiles.filter((file) => file.includes(`${path.sep}valid${path.sep}`));
const invalidPatchFiles = patchFiles.filter((file) => file.includes(`${path.sep}invalid${path.sep}`));
const compatibilityDocumentFiles = compatibilityFiles.filter((file) => !file.includes(`${path.sep}patches${path.sep}`));
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

for (const file of compatibilityDocumentFiles) {
  const result = validateDocument(file, await readJson(file), contracts);
  if (!result.ok) {
    failures.push(`${file}: expected document-valid compatibility fixture, got ${result.errors.join("; ")}`);
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

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}

console.log(
  `validated ${validFiles.length} contract-valid fixtures, ${invalidFiles.length} contract-invalid fixtures, ${compatibilityDocumentFiles.length} compatibility fixtures, ${validPatchFiles.length} valid patches, and ${invalidPatchFiles.length} invalid patches with @skenion/contracts`
);
