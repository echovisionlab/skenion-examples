import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const releaseMode = process.env.SKENION_RELEASE_MODE === "1";
const contractsDir = process.env.SKENION_CONTRACTS_DIR;
const currentCompatibilityRoot = path.join(root, "compatibility/v0.1");
const unsupportedVersionSegment = `${path.sep}unsupported-versions${path.sep}`;
const explicitCanonicalTypeAliases = new Map([
  ["message.any", "value.core.message"],
  ["control.message.any", "value.core.message"],
  ["event.bang", "value.core.bang"],
  ["number.float", "value.core.float64"],
  ["control.number.float", "value.core.float64"],
  ["number.int", "value.core.int64"],
  ["control.number.int", "value.core.int64"],
  ["number.uint", "value.core.uint64"],
  ["control.number.uint", "value.core.uint64"],
  ["boolean", "value.core.bool"],
  ["control.bool", "value.core.bool"],
  ["string", "value.core.string"],
  ["color", "value.core.color"],
  ["signal.audio", "value.core.float32"],
  ["gpu.texture2d", "value.core.tensor"],
  ["render.frame", "value.core.tensor"],
  ["value.number", "value.core.float64"],
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

  if (type.startsWith("value.core.") && !canonicalTypes.has(type)) {
    return explicit ?? "a current value.core.* type id from Contracts ValueTypeIdV01";
  }

  if ((type.startsWith("value.") || type.startsWith("value<")) && !canonicalTypes.has(type)) {
    return explicit ?? "a current value.core.* type id from Contracts ValueTypeIdV01";
  }

  const suffixMatches = [...canonicalTypes].filter((canonicalType) => canonicalType.endsWith(`.${type}`));
  return suffixMatches.length === 1 ? suffixMatches[0] : "";
}

function shouldAuditFile(file) {
  return !file.includes(unsupportedVersionSegment);
}

const { canonicalTypes, canonicalTypesSource } = await loadCanonicalTypes();
if (canonicalTypes.size === 0) {
  fail(`${canonicalTypesSource}: Contracts ValueTypeIdV01 type list must not be empty`);
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
  `audited current 0.1 fixtures: ${currentCompatibilityFiles.length} JSON files and ${portTypeReferenceCount} port type references against ${canonicalTypes.size} Contracts value type ids from ${canonicalTypesSource}`
);

async function loadCanonicalTypes() {
  const source = await resolveContractsTypesSource();
  const text = await readFile(source, "utf8");
  const match = text.match(/export\s+type\s+ValueTypeIdV01\s*=\s*([^;]+);/u);
  if (!match) {
    fail(`${source}: expected exported ValueTypeIdV01 union`);
  }

  const canonicalTypes = new Set(
    [...match[1].matchAll(/"([^"]+)"/gu)]
      .map((item) => item[1])
      .filter((type) => type.startsWith("value.core."))
  );
  return {
    canonicalTypes,
    canonicalTypesSource: source,
  };
}

async function resolveContractsTypesSource() {
  if (contractsDir) {
    const candidates = [
      path.join(contractsDir, "packages/ts/dist/types.d.ts"),
      path.join(contractsDir, "packages/ts/src/types.ts"),
      path.join(contractsDir, "dist/types.d.ts"),
      path.join(contractsDir, "src/types.ts"),
    ];
    for (const candidate of candidates) {
      try {
        await readFile(candidate, "utf8");
        return candidate;
      } catch {
        // Try the next known Contracts source layout.
      }
    }
    fail(`${contractsDir}: could not locate Contracts types source for ValueTypeIdV01`);
  }

  const contractsIndex = import.meta.resolve("@skenion/contracts");
  return path.join(path.dirname(new URL(contractsIndex).pathname), "types.d.ts");
}
