#!/usr/bin/env node
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

const args = parseArgs(process.argv.slice(2));
const manifestInput = requireArg("manifest");
const trainVersion = requireArg("train-version");
const mode = normalizeMode(args.mode ?? "prepare");
const outDir = args["out-dir"] ?? ".skenion-train";
const runtimeTarget = args["runtime-target"] ?? "x86_64-unknown-linux-gnu";
const targetRef = args["target-ref"] ?? "";
const manifestRef = args["manifest-ref"] ?? "";
const manifestRepository = normalizeRepository(args["manifest-repository"] ?? "skenion/skenion");
const currentRepository = normalizeRepository(process.env.GITHUB_REPOSITORY ?? "skenion/skenion-examples");
const errors = [];

assertSemver(trainVersion, "train version", errors);
requireManifestRef(manifestRef, mode, errors);
requireManifestRepository(manifestRepository, mode, errors);
const manifest = await readManifest(manifestInput);
const trainId = trainVersion.replace(/\.[0-9]+$/, "");

requireEqual(manifest.schema, "skenion.release-train", "manifest.schema", errors);
requireEqual(manifest["schema-version"], "0.1.0", "manifest.schema-version", errors);
requireEqual(manifest["train-version"], trainVersion, "manifest.train-version", errors);
requireEqual(manifest["train-id"], trainId, "manifest.train-id", errors);

const contractsPackage = manifest.components?.contracts?.npm;
const contractsCrate = manifest.components?.contracts?.crate;
const runtimeBinary = manifest.components?.runtime?.binaries?.[runtimeTarget];
const sdkPackage = manifest.components?.sdk?.npm;
const manual = manifest.components?.docs?.manual;
const examples = manifest.components?.examples;
const examplesGate = manifest["release-gates"]?.["examples-conformance"];

requirePackage(contractsPackage, "components.contracts.npm", {
  ecosystem: "npm",
  name: "@skenion/contracts",
  version: trainVersion,
}, errors);
requirePackage(contractsCrate, "components.contracts.crate", {
  ecosystem: "crates.io",
  name: "skenion-contracts",
  version: trainVersion,
}, errors);
requirePackage(sdkPackage, "components.sdk.npm", {
  ecosystem: "npm",
  name: "@skenion/sdk",
  version: trainVersion,
}, errors);
requireExamples(examples, examplesGate, trainVersion, currentRepository, errors);
requireReleaseTargetRef(targetRef, examples, errors);
requireManual(manual, manifest["release-gates"]?.["docs-pages-deployment"], trainVersion, trainId, errors);
requireRuntimeBinary(runtimeBinary, runtimeTarget, trainVersion, errors);
const runtimeChecksum = requireRuntimeChecksum(runtimeBinary, runtimeTarget, errors);
requireRuntimeTier(manifest.components?.runtime?.binaries, manifest["release-gates"]?.["runtime-smoke"], trainVersion, errors);
requireStudioCompatibility(manifest.components?.studio, manifest["release-gates"]?.["studio-package-smoke"], trainVersion, errors);
requireRegistryPackageGates(manifest["release-gates"]?.["registry-packages"], {
  "contracts-npm": contractsPackage,
  "contracts-crate": contractsCrate,
  "sdk-npm": sdkPackage,
}, errors);
requireArtifactCollectionGate(manifest["release-gates"]?.["github-release-assets"]?.runtime, "runtime", manifest.components?.runtime?.binaries, `skenion-runtime-v${trainVersion}`, errors);
requireArtifactCollectionGate(manifest["release-gates"]?.["github-release-assets"]?.studio, "studio", [
  ...Object.values(manifest.components?.studio?.["desktop-packages"] ?? {}),
  manifest.components?.studio?.["web-bundle"],
  ...Object.values(manifest.components?.studio?.["runtime-sidecars"] ?? {}),
], `skenion-studio-v${trainVersion}`, errors);
requireChecksumGate(manifest["release-gates"]?.["checksum-verification"], manifest, errors);
rejectLocalReleaseSources(manifest, errors);

if (errors.length > 0) {
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

await mkdir(outDir, { recursive: true });
const summary = {
  schema: "skenion.examples.release-train.validation",
  "schema-version": "1.0.0",
  mode,
  "train-id": trainId,
  "train-version": trainVersion,
  "manifest-repository": manifestRepository,
  "contracts-package": `${contractsPackage.name}@${contractsPackage.version}`,
  "contracts-crate": `${contractsCrate.name}@${contractsCrate.version}`,
  "sdk-package": `${sdkPackage.name}@${sdkPackage.version}`,
  "runtime-target": runtimeTarget,
  "runtime-asset": {
    repository: runtimeBinary.source.repository,
    tag: runtimeBinary.source.tag,
    "asset-name": runtimeBinary.source["asset-name"],
    sha256: runtimeChecksum,
  },
  examples: {
    repository: examples.repository,
    version: examples.version,
    tag: examples.tag,
    commit: examples.commit ?? null,
  },
  manual: {
    version: manual.version,
    path: manual.path,
    "pages-url": manual["pages-url"],
  },
};
await writeFile(path.join(outDir, "examples-release-train.json"), `${JSON.stringify(summary, null, 2)}\n`);
writeOutputs({
  train_id: trainId,
  train_version: trainVersion,
  contracts_npm_version: contractsPackage.version,
  contracts_crate_version: contractsCrate.version,
  sdk_npm_version: sdkPackage.version,
  runtime_repository: runtimeBinary.source.repository,
  runtime_tag: runtimeBinary.source.tag,
  runtime_asset: runtimeBinary.source["asset-name"],
  runtime_sha256: runtimeChecksum,
  runtime_target: runtimeTarget,
  examples_repository: examples.repository,
  examples_tag: examples.tag,
  examples_commit: examples.commit ?? "",
  manual_version: manual.version,
  manual_path: manual.path,
  manual_pages_url: manual["pages-url"],
  summary: `Examples ${examples.tag} validated against released Contracts/Runtime ${trainVersion}`,
});

console.log(`Validated examples release train inputs for ${trainVersion} in ${mode} mode.`);

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

async function readManifest(input) {
  const raw = input.trim().startsWith("{")
    ? input
    : await readFile(path.resolve(input), "utf8");
  return JSON.parse(raw);
}

function normalizeMode(value) {
  if (!["prepare", "publish", "verify"].includes(value)) {
    throw new Error("--mode must be prepare, publish, or verify");
  }
  return value;
}

function assertSemver(value, label, targetErrors) {
  if (!isStrictSemver(value)) {
    targetErrors.push(`${label} must be registry-compatible SemVer without leading zeros`);
  }
}

function requireManifestRef(value, currentMode, targetErrors) {
  if (currentMode === "prepare") {
    return;
  }
  if (!isGitSha(value)) {
    targetErrors.push("manifest ref must be an explicit 40-character git SHA in publish/verify mode");
  }
}

function requireManifestRepository(value, currentMode, targetErrors) {
  if (currentMode === "prepare") {
    return;
  }
  if (value !== "skenion/skenion") {
    targetErrors.push("manifest repository must be skenion/skenion in publish/verify mode");
  }
}

function requireEqual(actual, expected, label, targetErrors) {
  if (actual !== expected) {
    targetErrors.push(`${label} must be ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function requirePackage(actual, label, expected, targetErrors) {
  if (!isObject(actual)) {
    targetErrors.push(`${label} must be an object`);
    return;
  }
  for (const [key, value] of Object.entries(expected)) {
    requireEqual(actual[key], value, `${label}.${key}`, targetErrors);
  }
}

function requireExamples(examples, gate, expectedVersion, currentRepo, targetErrors) {
  if (!isObject(examples)) {
    targetErrors.push("components.examples must be an object");
    return;
  }
  if (normalizeRepository(examples.repository) !== currentRepo) {
    targetErrors.push(`components.examples.repository must match this repository (${currentRepo})`);
  }
  requireEqual(examples.version, expectedVersion, "components.examples.version", targetErrors);
  if (!isStrictExamplesReleaseTag(examples.tag, expectedVersion)) {
    targetErrors.push(`components.examples.tag must be exactly skenion-examples-v${expectedVersion}`);
  }
  if (examples.commit !== undefined && !isSafeCommitMarker(examples.commit)) {
    targetErrors.push("components.examples.commit must be a non-empty commit marker without branch/path syntax");
  }
  if (mode !== "prepare" && !isGitSha(examples.commit)) {
    targetErrors.push("components.examples.commit must be a recorded 40-character git SHA in publish/verify mode");
  }

  if (!isObject(gate)) {
    targetErrors.push("release-gates.examples-conformance must be an object");
    return;
  }
  requireEqual(gate.repository, examples.repository, "release-gates.examples-conformance.repository", targetErrors);
  requireEqual(gate.ref, examples.tag, "release-gates.examples-conformance.ref", targetErrors);
  if (!isStrictExamplesReleaseTag(gate.ref, expectedVersion)) {
    targetErrors.push(`release-gates.examples-conformance.ref must be exactly skenion-examples-v${expectedVersion}`);
  }
  if (gate.tag !== undefined && !isStrictExamplesReleaseTag(gate.tag, expectedVersion)) {
    targetErrors.push(`release-gates.examples-conformance.tag must be exactly skenion-examples-v${expectedVersion}`);
  }
  requireEqual(gate.version, expectedVersion, "release-gates.examples-conformance.version", targetErrors);
}

function requireReleaseTargetRef(value, examples, targetErrors) {
  if (mode === "prepare") {
    if (value && !isSafeReleaseTargetRef(value, examples?.version ?? trainVersion)) {
      targetErrors.push("target ref must be a SHA or product-owned examples release tag in prepare mode");
    }
    return;
  }

  if (!isGitSha(value)) {
    targetErrors.push("target ref must be an explicit 40-character git SHA in publish/verify mode");
    return;
  }
  if (isGitSha(examples?.commit) && value.toLowerCase() !== examples.commit.toLowerCase()) {
    targetErrors.push("target ref must match components.examples.commit in publish/verify mode");
  }
}

function requireRuntimeBinary(artifact, target, expectedVersion, targetErrors) {
  if (!isObject(artifact)) {
    targetErrors.push(`components.runtime.binaries.${target} must be present`);
    return;
  }
  requireEqual(artifact.target, target, `components.runtime.binaries.${target}.target`, targetErrors);
  requireEqual(artifact.kind, "runtime-binary", `components.runtime.binaries.${target}.kind`, targetErrors);
  requireEqual(artifact.version, expectedVersion, `components.runtime.binaries.${target}.version`, targetErrors);
  if (!isObject(artifact.source)) {
    targetErrors.push(`components.runtime.binaries.${target}.source must be an object`);
    return;
  }
  requireEqual(artifact.source.kind, "github-release-asset", `components.runtime.binaries.${target}.source.kind`, targetErrors);
  if (normalizeRepository(artifact.source.repository) !== "skenion/skenion-runtime") {
    targetErrors.push(`components.runtime.binaries.${target}.source.repository must be skenion/skenion-runtime`);
  }
  requireEqual(artifact.source.tag, `skenion-runtime-v${expectedVersion}`, `components.runtime.binaries.${target}.source.tag`, targetErrors);
  if (!artifact.source["asset-name"] || artifact.source["asset-name"].includes("/") || artifact.source["asset-name"].includes("\\")) {
    targetErrors.push(`components.runtime.binaries.${target}.source["asset-name"] must be a release asset name`);
  }
}

function requireManual(manual, gate, expectedVersion, expectedTrainId, targetErrors) {
  if (!isObject(manual)) {
    targetErrors.push("components.docs.manual must be an object");
    return;
  }
  requireEqual(manual.version, expectedVersion, "components.docs.manual.version", targetErrors);
  requireEqual(manual.path, `/manual/${expectedTrainId}/`, "components.docs.manual.path", targetErrors);
  if (!isHttpsUrl(manual["pages-url"])) {
    targetErrors.push("components.docs.manual.pages-url must be an https URL");
  } else if (!manual["pages-url"].includes(manual.path)) {
    targetErrors.push("components.docs.manual.pages-url must include components.docs.manual.path");
  }

  if (!isObject(gate)) {
    targetErrors.push("release-gates.docs-pages-deployment must be an object");
    return;
  }
  requireGateStatus(gate, "release-gates.docs-pages-deployment", targetErrors);
  requireEqual(gate.required, true, "release-gates.docs-pages-deployment.required", targetErrors);
  requireEqual(gate["manual-version"], manual.version, "release-gates.docs-pages-deployment.manual-version", targetErrors);
  requireEqual(gate["manual-path"], manual.path, "release-gates.docs-pages-deployment.manual-path", targetErrors);
  requireEqual(gate["pages-url"], manual["pages-url"], "release-gates.docs-pages-deployment.pages-url", targetErrors);
  requirePassedGate(gate, "release-gates.docs-pages-deployment", targetErrors);
}

function requireRuntimeTier(binaries, gates, expectedVersion, targetErrors) {
  if (!isObject(binaries)) {
    targetErrors.push("components.runtime.binaries must be an object");
    return;
  }
  for (const [target, artifact] of Object.entries(binaries)) {
    requireRuntimeBinary(artifact, target, expectedVersion, targetErrors);
    requireArtifactChecksum(artifact, `components.runtime.binaries.${target}`, artifact?.["support-tier"] === "release-blocking", targetErrors);
    const gate = gates?.[target];
    requireRuntimeSmokeGate(gate, artifact, target, targetErrors);
  }
}

function requireStudioCompatibility(studio, gates, expectedVersion, targetErrors) {
  if (!isObject(studio)) {
    targetErrors.push("components.studio must be an object");
    return;
  }
  const desktopPackages = studio["desktop-packages"];
  const runtimeSidecars = studio["runtime-sidecars"];
  const webBundle = studio["web-bundle"];
  if (!isObject(desktopPackages)) {
    targetErrors.push("components.studio.desktop-packages must be an object");
    return;
  }
  if (!isObject(runtimeSidecars)) {
    targetErrors.push("components.studio.runtime-sidecars must be an object");
    return;
  }
  requireStudioWebBundleArtifact(webBundle, expectedVersion, targetErrors);
  for (const [target, desktopPackage] of Object.entries(desktopPackages)) {
    requireStudioArtifact(desktopPackage, target, "studio-desktop-package", expectedVersion, targetErrors);
    const sidecar = runtimeSidecars[target];
    requireStudioArtifact(sidecar, target, "studio-runtime-sidecar", expectedVersion, targetErrors);
    const releaseBlocking = desktopPackage?.["support-tier"] === "release-blocking" || sidecar?.["support-tier"] === "release-blocking";
    requireArtifactChecksum(desktopPackage, `components.studio.desktop-packages.${target}`, releaseBlocking, targetErrors);
    requireArtifactChecksum(sidecar, `components.studio.runtime-sidecars.${target}`, releaseBlocking, targetErrors);
    requireStudioSmokeGate(gates?.[target], desktopPackage, sidecar, target, releaseBlocking, targetErrors);
  }
}

function requireStudioWebBundleArtifact(artifact, expectedVersion, targetErrors) {
  const label = `components.studio["web-bundle"]`;
  if (!isObject(artifact)) {
    targetErrors.push(`${label} must be an object`);
    return;
  }
  if (typeof artifact.id !== "string" || artifact.id.trim() === "") {
    targetErrors.push(`${label}.id must be a non-empty string`);
  }
  requireEqual(artifact.kind, "studio-web-bundle", `${label}.kind`, targetErrors);
  requireEqual(artifact.version, expectedVersion, `${label}.version`, targetErrors);
  requireEqual(artifact.name, `skenion-studio-web-bundle-v${expectedVersion}.tar.gz`, `${label}.name`, targetErrors);
  if (!isObject(artifact.source)) {
    targetErrors.push(`${label}.source must be an object`);
    return;
  }
  requireEqual(artifact.source.kind, "github-release-asset", `${label}.source.kind`, targetErrors);
  if (normalizeRepository(artifact.source.repository) !== "skenion/skenion-studio") {
    targetErrors.push(`${label}.source.repository must be skenion/skenion-studio`);
  }
  requireEqual(artifact.source.tag, `skenion-studio-v${expectedVersion}`, `${label}.source.tag`, targetErrors);
  requireEqual(
    artifact.source["asset-name"],
    `skenion-studio-web-bundle-v${expectedVersion}.tar.gz`,
    `${label}.source["asset-name"]`,
    targetErrors
  );
  if (!artifact.source["asset-name"] || artifact.source["asset-name"].includes("/") || artifact.source["asset-name"].includes("\\")) {
    targetErrors.push(`${label}.source["asset-name"] must be a release asset name`);
  }
  requireArtifactChecksum(artifact, label, true, targetErrors);
}

function requireStudioArtifact(artifact, target, kind, expectedVersion, targetErrors) {
  const label = kind === "studio-desktop-package"
    ? `components.studio.desktop-packages.${target}`
    : `components.studio.runtime-sidecars.${target}`;
  if (!isObject(artifact)) {
    targetErrors.push(`${label} must be present`);
    return;
  }
  requireEqual(artifact.target, target, `${label}.target`, targetErrors);
  requireEqual(artifact.kind, kind, `${label}.kind`, targetErrors);
  requireEqual(artifact.version, expectedVersion, `${label}.version`, targetErrors);
  if (!isObject(artifact.source)) {
    targetErrors.push(`${label}.source must be an object`);
    return;
  }
  requireEqual(artifact.source.kind, "github-release-asset", `${label}.source.kind`, targetErrors);
  if (normalizeRepository(artifact.source.repository) !== "skenion/skenion-studio") {
    targetErrors.push(`${label}.source.repository must be skenion/skenion-studio`);
  }
  requireEqual(artifact.source.tag, `skenion-studio-v${expectedVersion}`, `${label}.source.tag`, targetErrors);
  if (!artifact.source["asset-name"] || artifact.source["asset-name"].includes("/") || artifact.source["asset-name"].includes("\\")) {
    targetErrors.push(`${label}.source["asset-name"] must be a release asset name`);
  }
}

function requireRuntimeSmokeGate(gate, artifact, target, targetErrors) {
  const label = `release-gates.runtime-smoke.${target}`;
  if (!isObject(gate)) {
    targetErrors.push(`${label} must be an object`);
    return;
  }
  requireGateStatus(gate, label, targetErrors);
  requireEqual(gate.target, target, `${label}.target`, targetErrors);
  requireEqual(gate["artifact-id"], artifact?.id, `${label}.artifact-id`, targetErrors);
  if (artifact?.["support-tier"] === "release-blocking") {
    requireEqual(gate.required, true, `${label}.required`, targetErrors);
    requirePassedGate(gate, label, targetErrors);
  }
}

function requireStudioSmokeGate(gate, desktopPackage, sidecar, target, releaseBlocking, targetErrors) {
  const label = `release-gates.studio-package-smoke.${target}`;
  if (!isObject(gate)) {
    targetErrors.push(`${label} must be an object`);
    return;
  }
  requireGateStatus(gate, label, targetErrors);
  requireEqual(gate.target, target, `${label}.target`, targetErrors);
  requireEqual(gate["desktop-package-artifact-id"], desktopPackage?.id, `${label}.desktop-package-artifact-id`, targetErrors);
  requireEqual(gate["runtime-sidecar-artifact-id"], sidecar?.id, `${label}.runtime-sidecar-artifact-id`, targetErrors);
  if (releaseBlocking) {
    requireEqual(gate.required, true, `${label}.required`, targetErrors);
    requirePassedGate(gate, label, targetErrors);
  }
}

function requireRegistryPackageGates(gates, packages, targetErrors) {
  if (!isObject(gates)) {
    targetErrors.push("release-gates.registry-packages must be an object");
    return;
  }
  const expectedGateNames = new Set(Object.keys(packages));
  for (const name of Object.keys(gates)) {
    if (!expectedGateNames.has(name)) {
      targetErrors.push(`release-gates.registry-packages.${name} is not a release-train registry package gate`);
    }
  }
  for (const [name, expectedPackage] of Object.entries(packages)) {
    const gate = gates[name];
    const label = `release-gates.registry-packages.${name}`;
    if (!isObject(gate)) {
      targetErrors.push(`${label} must be an object`);
      continue;
    }
    requireGateStatus(gate, label, targetErrors);
    requireEqual(gate.required, true, `${label}.required`, targetErrors);
    requirePackage(gate.package, `${label}.package`, expectedPackage, targetErrors);
    requirePassedGate(gate, label, targetErrors);
  }
}

function requireArtifactCollectionGate(gate, labelName, artifacts, expectedTag, targetErrors) {
  const label = `release-gates.github-release-assets.${labelName}`;
  if (!isObject(gate)) {
    targetErrors.push(`${label} must be an object`);
    return;
  }
  requireGateStatus(gate, label, targetErrors);
  requireEqual(gate.required, true, `${label}.required`, targetErrors);
  requireEqual(gate.tag, expectedTag, `${label}.tag`, targetErrors);
  if (!Array.isArray(gate["artifact-ids"]) || gate["artifact-ids"].length === 0) {
    targetErrors.push(`${label}.artifact-ids must be a non-empty array`);
    return;
  }
  const artifactList = Array.isArray(artifacts) ? artifacts : Object.values(artifacts ?? {});
  const expectedIds = new Set(artifactList.map((artifact) => artifact?.id).filter(Boolean));
  const actualIds = new Set(gate["artifact-ids"]);
  for (const artifactId of expectedIds) {
    if (!actualIds.has(artifactId)) {
      targetErrors.push(`${label}.artifact-ids must include ${JSON.stringify(artifactId)}`);
    }
  }
  for (const artifactId of gate["artifact-ids"]) {
    if (!expectedIds.has(artifactId)) {
      targetErrors.push(`${label}.artifact-ids contains unknown artifact id ${JSON.stringify(artifactId)}`);
    }
  }
  requirePassedGate(gate, label, targetErrors);
}

function requireChecksumGate(gate, manifestDocument, targetErrors) {
  if (!isObject(gate)) {
    targetErrors.push("release-gates.checksum-verification must be an object");
    return;
  }
  requireGateStatus(gate, "release-gates.checksum-verification", targetErrors);
  requireEqual(gate.required, true, "release-gates.checksum-verification.required", targetErrors);
  const artifactsById = new Map();
  for (const artifact of collectArtifacts(manifestDocument)) {
    if (artifact?.id) {
      artifactsById.set(artifact.id, artifact);
    }
  }
  const actualArtifactIds = new Set(gate["artifact-ids"] ?? []);
  for (const artifactId of artifactsById.keys()) {
    if (!actualArtifactIds.has(artifactId)) {
      targetErrors.push(`release-gates.checksum-verification.artifact-ids must include ${JSON.stringify(artifactId)}`);
    }
  }
  for (const artifactId of gate["artifact-ids"] ?? []) {
    if (!artifactsById.has(artifactId)) {
      targetErrors.push(`release-gates.checksum-verification.artifact-ids contains unknown artifact id ${JSON.stringify(artifactId)}`);
    }
  }
  const expectedChecksums = gate["expected-checksums"] ?? {};
  for (const artifact of artifactsById.values()) {
    if (!requiresReleaseChecksum(artifact)) {
      continue;
    }
    const checksum = expectedChecksums[artifact.id];
    if (mode !== "prepare" && !isObject(checksum)) {
      targetErrors.push(`release-gates.checksum-verification.expected-checksums.${artifact.id} must be present in publish/verify mode`);
      continue;
    }
    if (isObject(checksum)) {
      requireEqual(checksum.algorithm, "sha256", `release-gates.checksum-verification.expected-checksums.${artifact.id}.algorithm`, targetErrors);
      if (checksum.value !== artifact.checksum?.value) {
        targetErrors.push(`release-gates.checksum-verification.expected-checksums.${artifact.id}.value must match ${artifact.id} checksum`);
      }
    }
  }
  requirePassedGate(gate, "release-gates.checksum-verification", targetErrors);
}

function requiresReleaseChecksum(artifact) {
  return artifact["support-tier"] === "release-blocking" || artifact.kind === "studio-web-bundle";
}

function requireArtifactChecksum(artifact, label, releaseBlocking, targetErrors) {
  if (!isObject(artifact?.checksum)) {
    if (mode !== "prepare" && releaseBlocking) {
      targetErrors.push(`${label}.checksum must be present for release-blocking artifacts in publish/verify mode`);
    }
    return;
  }
  requireEqual(artifact.checksum.algorithm, "sha256", `${label}.checksum.algorithm`, targetErrors);
  if (artifact.checksum.value === null || artifact.checksum.value === undefined || artifact.checksum.value === "") {
    if (mode !== "prepare" && releaseBlocking) {
      targetErrors.push(`${label}.checksum.value must be pinned for release-blocking artifacts in publish/verify mode`);
    }
    return;
  }
  if (!/^[a-f0-9]{64}$/i.test(artifact.checksum.value)) {
    targetErrors.push(`${label}.checksum.value must be a 64-character SHA-256 hex digest`);
  }
}

function requireGateStatus(gate, label, targetErrors) {
  if (!["pending", "passed", "failed", "waived"].includes(gate.status)) {
    targetErrors.push(`${label}.status must be pending, passed, failed, or waived`);
  }
}

function requirePassedGate(gate, label, targetErrors) {
  if (mode === "prepare") {
    return;
  }
  if (gate.required === true && gate.status !== "passed") {
    targetErrors.push(`${label}.status must be passed in publish/verify mode`);
  }
}

function requireRuntimeChecksum(artifact, target, targetErrors) {
  const label = `components.runtime.binaries.${target}.checksum`;
  if (!isObject(artifact?.checksum)) {
    if (mode !== "prepare") {
      targetErrors.push(`${label} must be present in publish/verify mode`);
    }
    return "";
  }
  if (artifact.checksum.algorithm !== "sha256") {
    targetErrors.push(`${label}.algorithm must be sha256`);
  }
  if (artifact.checksum.value === null || artifact.checksum.value === undefined || artifact.checksum.value === "") {
    if (mode !== "prepare") {
      targetErrors.push(`${label}.value must be a manifest-pinned SHA-256 in publish/verify mode`);
    }
    return "";
  }
  if (!/^[a-f0-9]{64}$/i.test(artifact.checksum.value)) {
    targetErrors.push(`${label}.value must be a 64-character SHA-256 hex digest`);
    return "";
  }
  return artifact.checksum.value.toLowerCase();
}

function rejectLocalReleaseSources(manifest, targetErrors) {
  const serialized = JSON.stringify(manifest);
  const forbidden = [
    /echovisionlab\//i,
    /node_modules/i,
    /\.deps/i,
    /target\/debug/i,
    /target\/release/i,
    /\/Volumes\/Linear\/skenion\//i,
    /file:/i,
    /refs\/heads\/main/i,
  ];
  for (const pattern of forbidden) {
    if (pattern.test(serialized)) {
      targetErrors.push(`release manifest contains forbidden local/sibling/main source pattern ${pattern}`);
    }
  }
  for (const ref of collectRefs(manifest)) {
    if (!isImmutableReleaseRef(ref)) {
      targetErrors.push(`release source ref ${JSON.stringify(ref)} is branch-shaped or not an immutable release ref`);
    }
  }
}

function collectArtifacts(manifestDocument) {
  const runtimeBinaries = manifestDocument.components?.runtime?.binaries ?? {};
  const studioDesktopPackages = manifestDocument.components?.studio?.["desktop-packages"] ?? {};
  const studioRuntimeSidecars = manifestDocument.components?.studio?.["runtime-sidecars"] ?? {};
  return [
    ...Object.values(runtimeBinaries),
    ...Object.values(studioDesktopPackages),
    manifestDocument.components?.studio?.["web-bundle"],
    ...Object.values(studioRuntimeSidecars),
  ].filter(isObject);
}

function collectRefs(value, refs = []) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectRefs(item, refs);
    }
  } else if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (["ref", "tag", "targetRef"].includes(key) && typeof item === "string") {
        refs.push(item);
      }
      collectRefs(item, refs);
    }
  }
  return refs;
}

function isImmutableReleaseRef(value) {
  return typeof value === "string"
    && value.length > 0
    && !["main", "master", "HEAD"].includes(value)
    && !value.startsWith("refs/")
    && !value.includes("/")
    && !value.includes("..")
    && !value.includes(" ");
}

function isStrictExamplesReleaseTag(value, expectedVersion) {
  return value === `skenion-examples-v${expectedVersion}` && isStrictSemver(expectedVersion);
}

function isSafeReleaseTargetRef(value, expectedVersion) {
  return isGitSha(value) || isStrictExamplesReleaseTag(value, expectedVersion);
}

function isSafeCommitMarker(value) {
  return typeof value === "string"
    && value.length > 0
    && !["main", "master", "HEAD"].includes(value)
    && !value.startsWith("refs/")
    && !value.includes("/")
    && !value.includes("\\")
    && !value.includes("..")
    && !value.includes(" ");
}

function isGitSha(value) {
  return /^[0-9a-f]{40}$/i.test(String(value ?? ""));
}

function isStrictSemver(value) {
  return /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(String(value ?? ""));
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeRepository(value) {
  return String(value ?? "").replace(/^https:\/\/github.com\//i, "").replace(/\.git$/i, "").toLowerCase();
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function writeOutputs(outputs) {
  if (!process.env.GITHUB_OUTPUT) {
    return;
  }
  const lines = Object.entries(outputs).map(([key, value]) => `${key}=${value}`);
  execFileSync("sh", ["-c", "cat >> \"$GITHUB_OUTPUT\""], {
    input: `${lines.join("\n")}\n`,
    env: process.env,
  });
}
