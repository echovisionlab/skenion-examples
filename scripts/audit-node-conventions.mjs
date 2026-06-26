import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const releaseMode = process.env.SKENION_RELEASE_MODE === "1";
const contractsDir = process.env.SKENION_CONTRACTS_DIR;
const currentCompatibilityRoot = path.join(root, "compatibility/v0.1");
const unsupportedVersionSegment = `${path.sep}unsupported-versions${path.sep}`;
const explicitCanonicalTypeAliases = new Map([
  ["message.any", "control.message.any"],
  ["number.float", "control.number.float"],
  ["number.int", "control.number.int"],
  ["number.uint", "control.number.uint"],
  ["boolean", "control.bool"],
  ["value.number", "control.number.float"],
]);

if (releaseMode && contractsDir) {
  throw new Error("release mode must use the released @skenion/contracts package, not SKENION_CONTRACTS_DIR");
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

function fail(message) {
  throw new Error(message);
}

function collectPortTypeReferences(value, out = [], pointer = "$") {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      collectPortTypeReferences(item, out, `${pointer}[${index}]`);
    }
    return out;
  }
  if (value && typeof value === "object") {
    if (isPortSpecLike(value)) {
      out.push({
        location: `${pointer}.type`,
        type: value.type,
      });
      for (const [index, acceptedType] of (value.accepts ?? []).entries()) {
        if (typeof acceptedType === "string") {
          out.push({
            location: `${pointer}.accepts[${index}]`,
            type: acceptedType,
          });
        }
      }
    }
    if (typeof value.resolvedType === "string") {
      out.push({
        location: `${pointer}.resolvedType`,
        type: value.resolvedType,
      });
    }
    for (const [key, child] of Object.entries(value)) {
      collectPortTypeReferences(child, out, `${pointer}.${key}`);
    }
  }
  return out;
}

function isPortSpecLike(value) {
  return (
    (value.direction === "input" || value.direction === "output") &&
    typeof value.type === "string"
  );
}

function canonicalSuggestionForType(type, canonicalTypes) {
  const explicit = explicitCanonicalTypeAliases.get(type);
  if (explicit && canonicalTypes.has(explicit)) {
    return explicit;
  }

  if (type.startsWith("value.") || type.startsWith("value<")) {
    return explicit ?? "a domain-qualified control.*, event.*, signal.*, resource, gpu, render, or other current port type";
  }

  const suffixMatches = [...canonicalTypes].filter((canonicalType) => canonicalType.endsWith(`.${type}`));
  return suffixMatches.length === 1 ? suffixMatches[0] : "";
}

function shouldAuditFile(file) {
  return !file.includes(unsupportedVersionSegment);
}

const { builtinsManifest, builtinsManifestSource } = await loadBuiltinsManifest();
const canonicalTypes = new Set(builtinsManifest.canonicalTypes ?? []);
if (builtinsManifest.schema !== "skenion.builtins.manifest") {
  fail(`${builtinsManifestSource}: expected schema skenion.builtins.manifest`);
}
if (builtinsManifest.schemaVersion !== "0.1.0") {
  fail(`${builtinsManifestSource}: expected schemaVersion 0.1.0`);
}
if (canonicalTypes.size === 0) {
  fail(`${builtinsManifestSource}: canonicalTypes must not be empty`);
}

const currentCompatibilityFiles = (await walk(currentCompatibilityRoot)).filter(shouldAuditFile);
let portTypeReferenceCount = 0;
for (const file of currentCompatibilityFiles) {
  const document = await readJson(file);
  const portTypeReferences = collectPortTypeReferences(document);
  portTypeReferenceCount += portTypeReferences.length;
  for (const { location, type } of portTypeReferences) {
    const canonicalType = canonicalSuggestionForType(type, canonicalTypes);
    if (canonicalType) {
      fail(`${file}: non-canonical port type ${JSON.stringify(type)} at ${location}; use ${canonicalType}`);
    }
  }
}

console.log(
  `audited current 0.1 fixtures: ${currentCompatibilityFiles.length} JSON files and ${portTypeReferenceCount} port type references against ${canonicalTypes.size} Contracts canonical types from ${builtinsManifestSource}`
);

async function loadBuiltinsManifest() {
  if (contractsDir) {
    const builtinsManifestFile = path.join(contractsDir, "builtins/v0.1/builtins.manifest.json");
    return {
      builtinsManifest: await readJson(builtinsManifestFile),
      builtinsManifestSource: builtinsManifestFile,
    };
  }

  return {
    builtinsManifest: (await import("@skenion/contracts")).builtinManifestV01,
    builtinsManifestSource: "@skenion/contracts.builtinManifestV01",
  };
}
