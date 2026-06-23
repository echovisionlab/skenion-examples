#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeTrainManifestInput } from "./release-train-manifest-path.mjs";

const root = process.cwd();
const args = parseArgs(process.argv.slice(2));
const manifestPath = requireArg("manifest");
const trainVersion = requireArg("train-version");
const manifestPathErrors = [];
const manifestSource = normalizeTrainManifestInput(manifestPath, {
  trainVersion,
  manifestRepository: "skenion/skenion",
  errors: manifestPathErrors,
});
if (manifestPathErrors.length > 0) {
  throw new Error(manifestPathErrors.join("; "));
}
const releaseMode = process.env.SKENION_RELEASE_MODE === "1";
const sdkPackageOverride = process.env.SKENION_SDK_PACKAGE;
const sdkPackage = sdkPackageOverride ?? "@skenion/sdk";
const linkedSdkPackage = path.join(root, ".deps/skenion-sdk/dist/index.js");

if (releaseMode && sdkPackageOverride && sdkPackageOverride !== "@skenion/sdk") {
  throw new Error("release mode must use the released @skenion/sdk package, not a SKENION_SDK_PACKAGE override");
}
if (releaseMode && existsSync(linkedSdkPackage)) {
  throw new Error("release mode must not consume .deps/skenion-sdk; remove the sibling checkout from the release job");
}

const sdk = await importSdk();
const manifest = await readJson(manifestSource.absolutePath);
const sdkPackageJson = await readInstalledPackageJson("@skenion/sdk");
const contractsPackageJson = await readInstalledPackageJson("@skenion/contracts");

if (sdkPackageJson.version !== trainVersion) {
  throw new Error(`installed @skenion/sdk version ${sdkPackageJson.version} does not match ${trainVersion}`);
}
if (contractsPackageJson.version !== trainVersion) {
  throw new Error(`installed @skenion/contracts version ${contractsPackageJson.version} does not match ${trainVersion}`);
}

const releaseBlockingRuntimeTargets = releaseBlockingTargets(manifest.components?.runtime?.binaries);
const releaseBlockingStudioSidecarTargets = releaseBlockingTargets(manifest.components?.studio?.["runtime-sidecars"]);
const trainValidation = sdk.validateReleaseTrainManifestForSdk(manifest, {
  sdkPackageVersion: sdkPackageJson.version,
  contractsPackageVersion: contractsPackageJson.version,
  contractsDependencyRange: sdkPackageJson.peerDependencies?.["@skenion/contracts"],
  requiredRuntimeTargets: releaseBlockingRuntimeTargets,
  requiredStudioSidecarTargets: releaseBlockingStudioSidecarTargets,
});
if (!trainValidation.ok) {
  throw new Error(`released SDK rejected train manifest: ${trainValidation.diagnostics.map((diagnostic) => diagnostic.message).join("; ")}`);
}

let projectCount = 0;
let runtimePayloadCount = 0;
let patchContractCount = 0;
for (const file of await projectFixtureFiles()) {
  const document = await readJson(file);
  if (document?.schema !== "skenion.project" && document?.graph && Array.isArray(document?.nodes)) {
    const graph = sdk.readGraphDocument(document.graph);
    assertDefaultViewState(file, graph);
    runtimePayloadCount += 1;
    continue;
  }

  const project = sdk.readProjectDocument(projectDocumentPayload(document));
  assertStudioViewState(file, project);
  patchContractCount += sdk.deriveProjectPatchContracts(project).length;
  projectCount += 1;
}

let fragmentCount = 0;
let pasteOperationCount = 0;
for (const file of await validGraphFragmentFiles()) {
  const fragment = sdk.validateGraphFragment(await readJson(file));
  const request = sdk.createPasteGraphFragmentRequest({
    target: sdk.createGraphTargetRef({
      baseRevision: "sdk-release-conformance",
      path: sdk.patchPath.root(),
    }),
    fragment,
    placement: {
      kind: "position",
      x: 0,
      y: 0,
    },
    options: {
      idConflictPolicy: "remap",
      outsideEndpointPolicy: "reject",
      preserveRelativePositions: true,
    },
  });
  sdk.createPasteGraphFragmentOperation({
    id: `sdk-release-conformance-${fragmentCount + 1}`,
    request,
  });
  fragmentCount += 1;
  pasteOperationCount += 1;
}

const runtimeClient = sdk.createRuntimeClient({
  baseUrl: "http://127.0.0.1:3761",
  sessionId: "sdk-release-conformance",
});
const validateUrl = runtimeClient.sessionUrl({ route: "validate" }).toString();
if (!validateUrl.endsWith("/v0/sessions/sdk-release-conformance/validate")) {
  throw new Error(`released SDK produced unexpected Runtime validate URL ${validateUrl}`);
}
sdk.createRuntimeEventReplayCursorState("0");

console.log(
  `validated released SDK helpers with ${projectCount} Studio project fixtures, ${runtimePayloadCount} runtime project payloads, ${patchContractCount} derived patch contracts, ${fragmentCount} graph fragments, ${pasteOperationCount} paste operations, and manifest ${manifest["train-version"]}`
);

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      throw new Error(`unexpected argument ${arg}`);
    }
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`missing value for --${key}`);
    }
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}

function requireArg(name) {
  const value = args[name];
  if (!value) {
    throw new Error(`--${name} is required`);
  }
  return value;
}

async function importSdk() {
  if (sdkPackage.startsWith(".") || path.isAbsolute(sdkPackage)) {
    const entry = sdkPackage.endsWith(".js")
      ? sdkPackage
      : path.join(sdkPackage, "index.js");
    return import(pathToFileURL(path.resolve(root, entry)).href);
  }

  return import(sdkPackage);
}

async function readInstalledPackageJson(packageName) {
  const segments = packageName.startsWith("@")
    ? packageName.split("/")
    : [packageName];
  return readJson(path.join(root, "node_modules", ...segments, "package.json"));
}

async function readJson(file) {
  return JSON.parse(await readFile(path.resolve(root, file), "utf8"));
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

async function projectFixtureFiles() {
  return [
    ...(await walk(path.join(root, "projects/v0.1"))).filter((file) => file.endsWith(".skenion.json")),
    ...(await walk(path.join(root, "tutorials/v0.1"))).filter((file) => file.endsWith(".project.json")),
    ...(await walk(path.join(root, "compatibility/v0.1/projects/valid"))),
  ];
}

async function validGraphFragmentFiles() {
  return walk(path.join(root, "compatibility/v0.1/graph-fragments/valid"));
}

function assertStudioViewState(file, project) {
  const viewNodeIds = new Set(Object.keys(project.viewState?.canvas?.nodes ?? {}));
  for (const node of project.graph.nodes) {
    if (!viewNodeIds.has(node.id)) {
      throw new Error(`${file}: Studio viewState missing root graph node ${node.id}`);
    }
  }

  for (const patch of project.patchLibrary ?? []) {
    const patchView = patch.viewState?.canvas?.nodes && Object.keys(patch.viewState.canvas.nodes).length > 0
      ? patch.viewState
      : sdk.createDefaultViewStateForGraph(patch.graph);
    const patchViewNodeIds = new Set(Object.keys(patchView?.canvas?.nodes ?? {}));
    for (const node of patch.graph.nodes) {
      if (!patchViewNodeIds.has(node.id)) {
        throw new Error(`${file}: Studio viewState missing patch ${patch.id} node ${node.id}`);
      }
    }
  }
}

function assertDefaultViewState(file, graph) {
  const viewState = sdk.createDefaultViewStateForGraph(graph);
  const viewNodeIds = new Set(Object.keys(viewState?.canvas?.nodes ?? {}));
  for (const node of graph.nodes) {
    if (!viewNodeIds.has(node.id)) {
      throw new Error(`${file}: released SDK default viewState missing graph node ${node.id}`);
    }
  }
}

function projectDocumentPayload(document) {
  if (document?.schema !== "skenion.project") {
    return document;
  }
  const { nodes: _nodes, frames: _frames, ...projectDocument } = document;
  return projectDocument;
}

function releaseBlockingTargets(artifacts) {
  return Object.entries(artifacts ?? {})
    .filter(([, artifact]) => artifact?.["support-tier"] === "release-blocking")
    .map(([target]) => target);
}
