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
const currentRepository = normalizeRepository(process.env.GITHUB_REPOSITORY ?? "echovisionlab/Skenion-examples");
const errors = [];

assertSemver(trainVersion, "train version", errors);
const manifest = await readManifest(manifestInput);
const trainId = trainVersion.replace(/\.[0-9]+$/, "");

requireEqual(manifest.schema, "skenion.release-train", "manifest.schema", errors);
requireEqual(manifest.schemaVersion, "0.1.0", "manifest.schemaVersion", errors);
requireEqual(manifest.trainVersion, trainVersion, "manifest.trainVersion", errors);
requireEqual(manifest.trainId, trainId, "manifest.trainId", errors);

const contractsPackage = manifest.components?.contracts?.npm;
const contractsCrate = manifest.components?.contracts?.crate;
const runtimeCrate = manifest.components?.runtime?.crate;
const runtimeBinary = manifest.components?.runtime?.binaries?.[runtimeTarget];
const sdkPackage = manifest.components?.sdk?.npm;
const studioWebPackage = manifest.components?.studio?.web;
const studioDesktopPackage = manifest.components?.studio?.desktop;
const manual = manifest.components?.docs?.manual;
const examples = manifest.components?.examples;
const examplesGate = manifest.releaseGates?.examplesConformance;

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
requirePackage(runtimeCrate, "components.runtime.crate", {
  ecosystem: "crates.io",
  name: "skenion-runtime",
  version: trainVersion,
}, errors);
requirePackage(sdkPackage, "components.sdk.npm", {
  ecosystem: "npm",
  name: "@skenion/sdk",
  version: trainVersion,
}, errors);
requirePackage(studioWebPackage, "components.studio.web", {
  ecosystem: "npm",
  name: "@skenion/studio-web",
  version: trainVersion,
}, errors);
requirePackage(studioDesktopPackage, "components.studio.desktop", {
  ecosystem: "npm",
  name: "@skenion/studio-desktop",
  version: trainVersion,
}, errors);
requireExamples(examples, examplesGate, trainVersion, currentRepository, errors);
requireReleaseTargetRef(targetRef, examples, errors);
requireManual(manual, manifest.releaseGates?.docsPagesDeployment, trainVersion, trainId, errors);
requireRuntimeBinary(runtimeBinary, runtimeTarget, trainVersion, errors);
const runtimeChecksum = requireRuntimeChecksum(runtimeBinary, runtimeTarget, errors);
requireRuntimeTier(manifest.components?.runtime?.binaries, manifest.releaseGates?.runtimeSmoke, trainVersion, errors);
requireStudioCompatibility(manifest.components?.studio, manifest.releaseGates?.studioPackageSmoke, trainVersion, errors);
requireRegistryPackageGates(manifest.releaseGates?.registryPackages, {
  contractsNpm: contractsPackage,
  contractsCrate,
  runtimeCrate,
  sdkNpm: sdkPackage,
  studioWeb: studioWebPackage,
  studioDesktop: studioDesktopPackage,
}, errors);
requireArtifactCollectionGate(manifest.releaseGates?.githubReleaseAssets?.runtime, "runtime", manifest.components?.runtime?.binaries, `skenion-runtime-v${trainVersion}`, errors);
requireArtifactCollectionGate(manifest.releaseGates?.githubReleaseAssets?.studio, "studio", [
  ...Object.values(manifest.components?.studio?.desktopPackages ?? {}),
  ...Object.values(manifest.components?.studio?.runtimeSidecars ?? {}),
], `skenion-studio-v${trainVersion}`, errors);
requireChecksumGate(manifest.releaseGates?.checksumVerification, manifest, errors);
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
  schemaVersion: "1.0.0",
  mode,
  trainId,
  trainVersion,
  contractsPackage: `${contractsPackage.name}@${contractsPackage.version}`,
  contractsCrate: `${contractsCrate.name}@${contractsCrate.version}`,
  runtimeCrate: `${runtimeCrate.name}@${runtimeCrate.version}`,
  sdkPackage: `${sdkPackage.name}@${sdkPackage.version}`,
  studioPackages: {
    web: `${studioWebPackage.name}@${studioWebPackage.version}`,
    desktop: `${studioDesktopPackage.name}@${studioDesktopPackage.version}`,
  },
  runtimeTarget,
  runtimeAsset: {
    repository: runtimeBinary.source.repository,
    tag: runtimeBinary.source.tag,
    assetName: runtimeBinary.source.assetName,
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
    pagesUrl: manual.pagesUrl,
  },
};
await writeFile(path.join(outDir, "examples-release-train.json"), `${JSON.stringify(summary, null, 2)}\n`);
writeOutputs({
  train_id: trainId,
  train_version: trainVersion,
  contracts_npm_version: contractsPackage.version,
  contracts_crate_version: contractsCrate.version,
  sdk_npm_version: sdkPackage.version,
  studio_web_version: studioWebPackage.version,
  studio_desktop_version: studioDesktopPackage.version,
  runtime_repository: runtimeBinary.source.repository,
  runtime_tag: runtimeBinary.source.tag,
  runtime_asset: runtimeBinary.source.assetName,
  runtime_sha256: runtimeChecksum,
  runtime_target: runtimeTarget,
  examples_repository: examples.repository,
  examples_tag: examples.tag,
  examples_commit: examples.commit ?? "",
  manual_version: manual.version,
  manual_path: manual.path,
  manual_pages_url: manual.pagesUrl,
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
    targetErrors.push("releaseGates.examplesConformance must be an object");
    return;
  }
  requireEqual(gate.repository, examples.repository, "releaseGates.examplesConformance.repository", targetErrors);
  requireEqual(gate.ref, examples.tag, "releaseGates.examplesConformance.ref", targetErrors);
  if (!isStrictExamplesReleaseTag(gate.ref, expectedVersion)) {
    targetErrors.push(`releaseGates.examplesConformance.ref must be exactly skenion-examples-v${expectedVersion}`);
  }
  if (gate.tag !== undefined && !isStrictExamplesReleaseTag(gate.tag, expectedVersion)) {
    targetErrors.push(`releaseGates.examplesConformance.tag must be exactly skenion-examples-v${expectedVersion}`);
  }
  requireEqual(gate.version, expectedVersion, "releaseGates.examplesConformance.version", targetErrors);
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
  if (normalizeRepository(artifact.source.repository) !== "echovisionlab/Skenion-runtime".toLowerCase()) {
    targetErrors.push(`components.runtime.binaries.${target}.source.repository must be echovisionlab/Skenion-runtime`);
  }
  requireEqual(artifact.source.tag, `skenion-runtime-v${expectedVersion}`, `components.runtime.binaries.${target}.source.tag`, targetErrors);
  if (!artifact.source.assetName || artifact.source.assetName.includes("/") || artifact.source.assetName.includes("\\")) {
    targetErrors.push(`components.runtime.binaries.${target}.source.assetName must be a release asset name`);
  }
}

function requireManual(manual, gate, expectedVersion, expectedTrainId, targetErrors) {
  if (!isObject(manual)) {
    targetErrors.push("components.docs.manual must be an object");
    return;
  }
  requireEqual(manual.version, expectedVersion, "components.docs.manual.version", targetErrors);
  requireEqual(manual.path, `/manual/${expectedTrainId}/`, "components.docs.manual.path", targetErrors);
  if (!isHttpsUrl(manual.pagesUrl)) {
    targetErrors.push("components.docs.manual.pagesUrl must be an https URL");
  } else if (!manual.pagesUrl.includes(manual.path)) {
    targetErrors.push("components.docs.manual.pagesUrl must include components.docs.manual.path");
  }

  if (!isObject(gate)) {
    targetErrors.push("releaseGates.docsPagesDeployment must be an object");
    return;
  }
  requireGateStatus(gate, "releaseGates.docsPagesDeployment", targetErrors);
  requireEqual(gate.required, true, "releaseGates.docsPagesDeployment.required", targetErrors);
  requireEqual(gate.manualVersion, manual.version, "releaseGates.docsPagesDeployment.manualVersion", targetErrors);
  requireEqual(gate.manualPath, manual.path, "releaseGates.docsPagesDeployment.manualPath", targetErrors);
  requireEqual(gate.pagesUrl, manual.pagesUrl, "releaseGates.docsPagesDeployment.pagesUrl", targetErrors);
}

function requireRuntimeTier(binaries, gates, expectedVersion, targetErrors) {
  if (!isObject(binaries)) {
    targetErrors.push("components.runtime.binaries must be an object");
    return;
  }
  for (const [target, artifact] of Object.entries(binaries)) {
    requireRuntimeBinary(artifact, target, expectedVersion, targetErrors);
    requireArtifactChecksum(artifact, `components.runtime.binaries.${target}`, artifact?.supportTier === "release-blocking", targetErrors);
    const gate = gates?.[target];
    requireRuntimeSmokeGate(gate, artifact, target, targetErrors);
  }
}

function requireStudioCompatibility(studio, gates, expectedVersion, targetErrors) {
  if (!isObject(studio)) {
    targetErrors.push("components.studio must be an object");
    return;
  }
  const desktopPackages = studio.desktopPackages;
  const runtimeSidecars = studio.runtimeSidecars;
  if (!isObject(desktopPackages)) {
    targetErrors.push("components.studio.desktopPackages must be an object");
    return;
  }
  if (!isObject(runtimeSidecars)) {
    targetErrors.push("components.studio.runtimeSidecars must be an object");
    return;
  }
  for (const [target, desktopPackage] of Object.entries(desktopPackages)) {
    requireStudioArtifact(desktopPackage, target, "studio-desktop-package", expectedVersion, targetErrors);
    const sidecar = runtimeSidecars[target];
    requireStudioArtifact(sidecar, target, "studio-runtime-sidecar", expectedVersion, targetErrors);
    const releaseBlocking = desktopPackage?.supportTier === "release-blocking" || sidecar?.supportTier === "release-blocking";
    requireArtifactChecksum(desktopPackage, `components.studio.desktopPackages.${target}`, releaseBlocking, targetErrors);
    requireArtifactChecksum(sidecar, `components.studio.runtimeSidecars.${target}`, releaseBlocking, targetErrors);
    requireStudioSmokeGate(gates?.[target], desktopPackage, sidecar, target, releaseBlocking, targetErrors);
  }
}

function requireStudioArtifact(artifact, target, kind, expectedVersion, targetErrors) {
  const label = kind === "studio-desktop-package"
    ? `components.studio.desktopPackages.${target}`
    : `components.studio.runtimeSidecars.${target}`;
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
  if (normalizeRepository(artifact.source.repository) !== "echovisionlab/Skenion-studio".toLowerCase()) {
    targetErrors.push(`${label}.source.repository must be echovisionlab/Skenion-studio`);
  }
  requireEqual(artifact.source.tag, `skenion-studio-v${expectedVersion}`, `${label}.source.tag`, targetErrors);
  if (!artifact.source.assetName || artifact.source.assetName.includes("/") || artifact.source.assetName.includes("\\")) {
    targetErrors.push(`${label}.source.assetName must be a release asset name`);
  }
}

function requireRuntimeSmokeGate(gate, artifact, target, targetErrors) {
  const label = `releaseGates.runtimeSmoke.${target}`;
  if (!isObject(gate)) {
    targetErrors.push(`${label} must be an object`);
    return;
  }
  requireGateStatus(gate, label, targetErrors);
  requireEqual(gate.target, target, `${label}.target`, targetErrors);
  requireEqual(gate.artifactId, artifact?.id, `${label}.artifactId`, targetErrors);
  if (artifact?.supportTier === "release-blocking") {
    requireEqual(gate.required, true, `${label}.required`, targetErrors);
    requirePassedGate(gate, label, targetErrors);
  }
}

function requireStudioSmokeGate(gate, desktopPackage, sidecar, target, releaseBlocking, targetErrors) {
  const label = `releaseGates.studioPackageSmoke.${target}`;
  if (!isObject(gate)) {
    targetErrors.push(`${label} must be an object`);
    return;
  }
  requireGateStatus(gate, label, targetErrors);
  requireEqual(gate.target, target, `${label}.target`, targetErrors);
  requireEqual(gate.desktopPackageArtifactId, desktopPackage?.id, `${label}.desktopPackageArtifactId`, targetErrors);
  requireEqual(gate.runtimeSidecarArtifactId, sidecar?.id, `${label}.runtimeSidecarArtifactId`, targetErrors);
  if (releaseBlocking) {
    requireEqual(gate.required, true, `${label}.required`, targetErrors);
    requirePassedGate(gate, label, targetErrors);
  }
}

function requireRegistryPackageGates(gates, packages, targetErrors) {
  if (!isObject(gates)) {
    targetErrors.push("releaseGates.registryPackages must be an object");
    return;
  }
  for (const [name, expectedPackage] of Object.entries(packages)) {
    const gate = gates[name];
    const label = `releaseGates.registryPackages.${name}`;
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
  const label = `releaseGates.githubReleaseAssets.${labelName}`;
  if (!isObject(gate)) {
    targetErrors.push(`${label} must be an object`);
    return;
  }
  requireGateStatus(gate, label, targetErrors);
  requireEqual(gate.required, true, `${label}.required`, targetErrors);
  requireEqual(gate.tag, expectedTag, `${label}.tag`, targetErrors);
  if (!Array.isArray(gate.artifactIds) || gate.artifactIds.length === 0) {
    targetErrors.push(`${label}.artifactIds must be a non-empty array`);
    return;
  }
  const artifactList = Array.isArray(artifacts) ? artifacts : Object.values(artifacts ?? {});
  const expectedIds = new Set(artifactList.map((artifact) => artifact?.id).filter(Boolean));
  for (const artifactId of gate.artifactIds) {
    if (!expectedIds.has(artifactId)) {
      targetErrors.push(`${label}.artifactIds contains unknown artifact id ${JSON.stringify(artifactId)}`);
    }
  }
  requirePassedGate(gate, label, targetErrors);
}

function requireChecksumGate(gate, manifestDocument, targetErrors) {
  if (!isObject(gate)) {
    targetErrors.push("releaseGates.checksumVerification must be an object");
    return;
  }
  requireGateStatus(gate, "releaseGates.checksumVerification", targetErrors);
  requireEqual(gate.required, true, "releaseGates.checksumVerification.required", targetErrors);
  const artifactsById = new Map();
  for (const artifact of collectArtifacts(manifestDocument)) {
    if (artifact?.id) {
      artifactsById.set(artifact.id, artifact);
    }
  }
  for (const artifactId of gate.artifactIds ?? []) {
    if (!artifactsById.has(artifactId)) {
      targetErrors.push(`releaseGates.checksumVerification.artifactIds contains unknown artifact id ${JSON.stringify(artifactId)}`);
    }
  }
  const expectedChecksums = gate.expectedChecksums ?? {};
  for (const artifact of artifactsById.values()) {
    if (artifact.supportTier !== "release-blocking") {
      continue;
    }
    const checksum = expectedChecksums[artifact.id];
    if (mode !== "prepare" && !isObject(checksum)) {
      targetErrors.push(`releaseGates.checksumVerification.expectedChecksums.${artifact.id} must be present in publish/verify mode`);
      continue;
    }
    if (isObject(checksum)) {
      requireEqual(checksum.algorithm, "sha256", `releaseGates.checksumVerification.expectedChecksums.${artifact.id}.algorithm`, targetErrors);
      if (checksum.value !== artifact.checksum?.value) {
        targetErrors.push(`releaseGates.checksumVerification.expectedChecksums.${artifact.id}.value must match ${artifact.id} checksum`);
      }
    }
  }
  requirePassedGate(gate, "releaseGates.checksumVerification", targetErrors);
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
    /node_modules/i,
    /\.deps/i,
    /target\/debug/i,
    /target\/release/i,
    /\/Volumes\/Linear\/Skenion\//i,
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
  const studioDesktopPackages = manifestDocument.components?.studio?.desktopPackages ?? {};
  const studioRuntimeSidecars = manifestDocument.components?.studio?.runtimeSidecars ?? {};
  return [
    ...Object.values(runtimeBinaries),
    ...Object.values(studioDesktopPackages),
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
