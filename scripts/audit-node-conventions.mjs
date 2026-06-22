import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const contractsDir = process.env.SKENION_CONTRACTS_DIR
  ?? path.join(root, ".deps/skenion-contracts");
const builtinsManifestFile = path.join(contractsDir, "builtins/v0.1/builtins.manifest.json");
const currentCompatibilityRoot = path.join(root, "compatibility/v0.1");

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

function fail(message) {
  throw new Error(message);
}

function collectDataKinds(value, out = []) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectDataKinds(item, out);
    }
    return out;
  }
  if (value && typeof value === "object") {
    if (typeof value.dataKind === "string") {
      out.push(value.dataKind);
    }
    for (const child of Object.values(value)) {
      collectDataKinds(child, out);
    }
  }
  return out;
}

const builtinsManifest = await readJson(builtinsManifestFile);
const canonicalDataKinds = new Set(builtinsManifest.canonicalDataKinds ?? []);
if (builtinsManifest.schema !== "skenion.builtins.manifest") {
  fail(`${builtinsManifestFile}: expected schema skenion.builtins.manifest`);
}
if (builtinsManifest.schemaVersion !== "0.1.0") {
  fail(`${builtinsManifestFile}: expected schemaVersion 0.1.0`);
}
if (canonicalDataKinds.size === 0) {
  fail(`${builtinsManifestFile}: canonicalDataKinds must not be empty`);
}

const currentCompatibilityFiles = await walk(currentCompatibilityRoot);
for (const file of currentCompatibilityFiles) {
  const document = await readJson(file);
  const dataKinds = collectDataKinds(document);
  for (const dataKind of dataKinds) {
    const numberCanonical = `number.${dataKind}`;
    const eventCanonical = `event.${dataKind}`;
    if (canonicalDataKinds.has(numberCanonical)) {
      fail(`${file}: non-canonical dataKind ${dataKind} found; use ${numberCanonical}`);
    }
    if (canonicalDataKinds.has(eventCanonical)) {
      fail(`${file}: non-canonical dataKind ${dataKind} found; use ${eventCanonical}`);
    }
  }
}

console.log(
  `audited current 0.1 fixtures: ${currentCompatibilityFiles.length} JSON files for canonical type spelling against ${canonicalDataKinds.size} Contracts data kinds`
);
