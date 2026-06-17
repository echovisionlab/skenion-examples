import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const contractsDir = process.env.SKENION_CONTRACTS_DIR
  ?? path.join(root, ".deps/skenion-contracts");
const builtinsDir = path.join(contractsDir, "builtins/v0.1/nodes");
const builtinsManifestFile = path.join(contractsDir, "builtins/v0.1/builtins.manifest.json");
const expectedProjectFixtures = [
  "clear-color-render.project.json",
  "control-layer-demo.project.json",
  "event-bang.project.json",
  "fullscreen-shader.project.json",
  "fullscreen-shader-multi-uniform.project.json",
  "fullscreen-shader-uniform.project.json",
  "minimal-value.project.json",
  "studio-port-demo.project.json",
  "value-semantics-demo.project.json"
];

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

function stable(value) {
  if (Array.isArray(value)) {
    return value.map(stable);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stable(child)])
    );
  }
  return value;
}

function assertEqual(label, actual, expected) {
  const actualJson = JSON.stringify(stable(actual));
  const expectedJson = JSON.stringify(stable(expected));
  if (actualJson !== expectedJson) {
    fail(`${label}: does not match contracts builtin`);
  }
}

function assertSetEqual(label, actual, expected) {
  const actualOnly = [...actual].filter((value) => !expected.has(value)).sort();
  const expectedOnly = [...expected].filter((value) => !actual.has(value)).sort();
  if (actualOnly.length > 0 || expectedOnly.length > 0) {
    const details = [
      actualOnly.length > 0 ? `unexpected: ${actualOnly.join(", ")}` : null,
      expectedOnly.length > 0 ? `missing: ${expectedOnly.join(", ")}` : null
    ].filter(Boolean).join("; ");
    fail(`${label}: ${details}`);
  }
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

function graphNodes(document) {
  if (document?.schema === "skenion.graph") {
    return document.nodes ?? [];
  }
  return document?.graph?.nodes ?? [];
}

function graphEdges(document) {
  if (document?.schema === "skenion.graph") {
    return document.edges ?? [];
  }
  return document?.graph?.edges ?? [];
}

const builtinFiles = await walk(builtinsDir);
const builtinsManifest = await readJson(builtinsManifestFile);
const expectedBuiltinIds = new Set(builtinsManifest.nodes ?? []);
const canonicalDataKinds = new Set(builtinsManifest.canonicalDataKinds ?? []);
if (builtinsManifest.schema !== "skenion.builtins.manifest") {
  fail(`${builtinsManifestFile}: expected schema skenion.builtins.manifest`);
}
if (builtinsManifest.schemaVersion !== "0.1.0") {
  fail(`${builtinsManifestFile}: expected schemaVersion 0.1.0`);
}
if (expectedBuiltinIds.size === 0) {
  fail(`${builtinsManifestFile}: nodes must not be empty`);
}
if (canonicalDataKinds.size === 0) {
  fail(`${builtinsManifestFile}: canonicalDataKinds must not be empty`);
}

const builtins = new Map();
for (const file of builtinFiles) {
  const definition = await readJson(file);
  builtins.set(definition.id, definition);
}
assertSetEqual("contracts builtin manifest nodes", new Set(builtins.keys()), expectedBuiltinIds);

for (const fixture of expectedProjectFixtures) {
  const file = path.join(root, "compatibility/v0.1/projects/valid", fixture);
  await readJson(file);
}

const compatibilityFiles = [
  ...await walk(path.join(root, "compatibility/v0.1")),
  ...await walk(path.join(root, "compatibility/v0.2"))
];

for (const file of compatibilityFiles) {
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

const nodeManifestFiles = await walk(path.join(root, "compatibility/v0.1/nodes"));
for (const file of nodeManifestFiles) {
  const definition = await readJson(file);
  const builtin = builtins.get(definition.id);
  if (builtin) {
    assertEqual(file, definition, builtin);
  }
}

const validV01Files = (await walk(path.join(root, "compatibility/v0.1")))
  .filter((file) => !file.includes(`${path.sep}invalid${path.sep}`));

for (const file of validV01Files) {
  const document = await readJson(file);
  for (const definition of document.nodes ?? []) {
    const builtin = builtins.get(definition.id);
    if (builtin) {
      assertEqual(`${file} nodes[] ${definition.id}`, definition, builtin);
    }
  }

  for (const node of graphNodes(document)) {
    const builtin = builtins.get(node.kind);
    if (!builtin) {
      continue;
    }
    assertEqual(`${file} graph node ${node.id} ports`, node.ports, builtin.ports);
  }

  for (const edge of graphEdges(document)) {
    const sourceNode = graphNodes(document).find((node) => node.id === edge.from?.node);
    if (
      (sourceNode?.kind === "core.value-f32" || sourceNode?.kind === "core.color-rgba")
      && edge.from.port !== "value"
    ) {
      fail(`${file}: ${sourceNode.kind} edge source must use port value`);
    }
  }

  if (document.schema === "skenion.graph.patch") {
    for (const op of document.ops ?? []) {
      if (op.node?.kind && builtins.has(op.node.kind)) {
        assertEqual(`${file} patch node ${op.node.id} ports`, op.node.ports, builtins.get(op.node.kind).ports);
      }
      if (op.edge?.from?.node?.startsWith("value_") && op.edge.from.port !== "value") {
        fail(`${file}: value_* patch edge source must use port value`);
      }
      if (op.edge?.from?.node?.startsWith("color_") && op.edge.from.port !== "value") {
        fail(`${file}: color_* patch edge source must use port value`);
      }
    }
  }
}

console.log(
  `audited ${nodeManifestFiles.length} v0.1 node manifests, ${validV01Files.length} valid v0.1 compatibility files, and ${builtinFiles.length} contracts builtins`
);
