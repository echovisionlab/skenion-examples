#!/usr/bin/env node
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  normalizeCompatibilityMatrixInput,
  normalizeGitHubRepository,
} from "./compatibility-matrix-path.mjs";

const args = parseArgs(process.argv.slice(2));
const matrixInput = requireArg("matrix");
const contractsLine = requireArg("contracts-line");
const mode = normalizeMode(args.mode ?? "prepare");
const outDir = args["out-dir"] ?? ".skenion-matrix";
const runtimeTarget = args["runtime-target"] ?? "x86_64-unknown-linux-gnu";
const targetRef = args["target-ref"] ?? "";
const matrixRef = args["matrix-ref"] ?? "";
const matrixRepository = normalizeRepository(args["matrix-repository"] ?? "skenion/skenion");
const currentRepository = normalizeRepository(process.env.GITHUB_REPOSITORY ?? "skenion/skenion-examples");
const errors = [];

requireContractsLine(contractsLine, errors);
requireMatrixRef(matrixRef, mode, errors);
requireMatrixRepository(matrixRepository, mode, errors);
const matrixSource = normalizeCompatibilityMatrixInput(matrixInput, {
  contractsLine,
  matrixRepository: "skenion/skenion",
  errors,
});
if (errors.length > 0) {
  reportErrorsAndExit(errors);
}

const matrix = await readMatrix(matrixSource);
const contracts = matrix.contracts ?? matrix.components?.contracts;
const contractsPackage = contracts?.npm;
const contractsCrate = contracts?.crate;
const runtimeBinary = matrix.components?.runtime?.binaries?.[runtimeTarget];
const sdkPackage = matrix.components?.sdk?.npm;
const sdkContractsRange = sdkPackage?.["supported-contracts"]
  ?? sdkPackage?.["supported-contracts-range"]
  ?? matrix.components?.sdk?.["supported-contracts"]
  ?? matrix.components?.sdk?.["supported-contracts-range"]
  ?? matrix.components?.sdk?.["contracts-range"]
  ?? matrix.components?.sdk?.range;
const manual = matrix.components?.docs?.manual;
const examples = matrix.components?.examples;
const examplesGate = matrix["release-gates"]?.["examples-conformance"];
const contractsRange = contracts?.range ?? matrix["contracts-range"];
const examplesVersion = examples?.version ?? contractsPackage?.version;
const examplesTag = examples?.tag ?? (isStrictSemver(examplesVersion) ? `skenion-examples-v${examplesVersion}` : "");

requireEqual(matrix.schema, "skenion.compatibility-matrix", "matrix.schema", errors);
requireEqual(matrix["schema-version"], "0.1.0", "matrix.schema-version", errors);
requireEqual(contracts?.line ?? matrix["contracts-line"], contractsLine, "contracts.line", errors);
requireEqual(contractsRange, contractsLineRange(contractsLine), "contracts.range", errors);

requirePackage(contractsPackage, "contracts.npm", {
  ecosystem: "npm",
  name: "@skenion/contracts",
}, errors);
requirePackage(contractsCrate, "contracts.crate", {
  ecosystem: "crates.io",
  name: "skenion-contracts",
}, errors);
requirePackage(sdkPackage, "components.sdk.npm", {
  ecosystem: "npm",
  name: "@skenion/sdk",
}, errors);

if (isObject(contractsPackage)) {
  requireSemverInLine(contractsPackage.version, contractsLine, "contracts.npm.version", errors);
}
if (isObject(contractsCrate)) {
  requireEqual(contractsCrate.version, contractsPackage?.version, "contracts.crate.version", errors);
}
if (isObject(sdkPackage)) {
  assertSemver(sdkPackage.version, "components.sdk.npm.version", errors);
}
if (!rangeContainsVersion(sdkContractsRange, contractsPackage?.version)) {
  errors.push(
    `components.sdk.npm supported Contracts range must contain released Contracts ${contractsPackage?.version}; got ${JSON.stringify(sdkContractsRange)}`
  );
}

requireExamples(examples, examplesGate, currentRepository, examplesVersion, examplesTag, errors);
requireReleaseTargetRef(targetRef, examples, examplesVersion, errors);
requireManual(manual, matrix["release-gates"]?.["docs-pages-deployment"], contractsLine, errors);
requireRuntimeBinary(runtimeBinary, runtimeTarget, errors);
const runtimeChecksum = requireRuntimeChecksum(runtimeBinary, runtimeTarget, errors);
requireRuntimeArtifacts(matrix.components?.runtime?.binaries, matrix["release-gates"]?.["runtime-release-assets"], errors);
requireStudioMetadata(matrix.components?.studio, {
  web: matrix["release-gates"]?.["studio-web"],
  desktop: matrix["release-gates"]?.["studio-desktop"],
}, errors);
requireRegistryGate(matrix["release-gates"]?.["contracts-registry"], "release-gates.contracts-registry", errors);
requireRegistryGate(matrix["release-gates"]?.["sdk-registry"], "release-gates.sdk-registry", errors);
rejectRuntimeRegistryPublishing(matrix, errors);
rejectLocalReleaseSources(matrix, errors);

if (errors.length > 0) {
  reportErrorsAndExit(errors);
}

await mkdir(outDir, { recursive: true });
const summary = {
  schema: "skenion.examples.compatibility-matrix.validation",
  "schema-version": "1.0.0",
  mode,
  "contracts-line": contractsLine,
  "contracts-range": contractsRange,
  "matrix-repository": matrixRepository,
  "contracts-package": `${contractsPackage.name}@${contractsPackage.version}`,
  "contracts-crate": `${contractsCrate.name}@${contractsCrate.version}`,
  "sdk-package": `${sdkPackage.name}@${sdkPackage.version}`,
  "sdk-supported-contracts": sdkContractsRange,
  "runtime-target": runtimeTarget,
  "runtime-asset": {
    repository: runtimeBinary.source.repository,
    tag: runtimeBinary.source.tag,
    "asset-name": runtimeBinary.source["asset-name"],
    sha256: runtimeChecksum,
  },
  examples: {
    repository: examples.repository,
    version: examplesVersion,
    tag: examplesTag,
    commit: examples.commit ?? null,
  },
  manual: {
    version: manual.version,
    path: manual.path,
    "pages-url": manual["pages-url"],
  },
};
await writeFile(path.join(outDir, "examples-compatibility-matrix.json"), `${JSON.stringify(summary, null, 2)}\n`);
writeOutputs({
  contracts_line: contractsLine,
  contracts_range: contractsRange,
  contracts_npm_version: contractsPackage.version,
  contracts_crate_version: contractsCrate.version,
  sdk_npm_version: sdkPackage.version,
  sdk_contracts_range: sdkContractsRange,
  runtime_repository: runtimeBinary.source.repository,
  runtime_tag: runtimeBinary.source.tag,
  runtime_asset: runtimeBinary.source["asset-name"],
  runtime_sha256: runtimeChecksum,
  runtime_target: runtimeTarget,
  examples_version: examplesVersion,
  examples_tag: examplesTag,
  examples_commit: examples.commit ?? "",
  manual_version: manual.version,
  manual_path: manual.path,
  manual_pages_url: manual["pages-url"],
  summary: `Examples ${examples.tag} validated against Contracts line ${contractsLine}`,
});

console.log(`Validated examples compatibility matrix for Contracts ${contractsLine} in ${mode} mode.`);

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

async function readMatrix(source) {
  const raw = await readFile(source.absolutePath, "utf8");
  return JSON.parse(raw);
}

function normalizeMode(value) {
  if (!["prepare", "publish", "verify"].includes(value)) {
    throw new Error("--mode must be prepare, publish, or verify");
  }
  return value;
}

function requireContractsLine(value, targetErrors) {
  if (!isContractsLine(value)) {
    targetErrors.push("contracts line must be a v0 minor line such as 0.45");
  }
}

function assertSemver(value, label, targetErrors) {
  if (!isStrictSemver(value)) {
    targetErrors.push(`${label} must be registry-compatible SemVer without leading zeros`);
  }
}

function requireSemverInLine(value, line, label, targetErrors) {
  assertSemver(value, label, targetErrors);
  if (isStrictSemver(value) && !versionInContractsLine(value, line)) {
    targetErrors.push(`${label} must be in Contracts line ${line}, got ${value}`);
  }
}

function requireMatrixRef(value, currentMode, targetErrors) {
  if (currentMode === "prepare") {
    return;
  }
  if (!isGitSha(value)) {
    targetErrors.push("matrix ref must be an explicit 40-character git SHA in publish/verify mode");
  }
}

function requireMatrixRepository(value, currentMode, targetErrors) {
  if (currentMode === "prepare") {
    return;
  }
  if (value !== "skenion/skenion") {
    targetErrors.push("matrix repository must be skenion/skenion in publish/verify mode");
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

function requireExamples(examples, gate, currentRepo, examplesVersion, examplesTag, targetErrors) {
  if (!isObject(examples)) {
    targetErrors.push("components.examples must be an object");
    return;
  }
  if (normalizeRepository(examples.repository) !== currentRepo) {
    targetErrors.push(`components.examples.repository must match this repository (${currentRepo})`);
  }
  assertSemver(examplesVersion, "components.examples.version or contracts.npm.version", targetErrors);
  if (!isStrictExamplesReleaseTag(examplesTag, examplesVersion)) {
    targetErrors.push(`components.examples.tag must be exactly skenion-examples-v${examplesVersion}`);
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
  if (gate.repository !== undefined) {
    requireEqual(gate.repository, examples.repository, "release-gates.examples-conformance.repository", targetErrors);
  }
  if (gate.ref !== undefined) {
    requireEqual(gate.ref, examplesTag, "release-gates.examples-conformance.ref", targetErrors);
  }
  if (gate.tag !== undefined && !isStrictExamplesReleaseTag(gate.tag, examplesVersion)) {
    targetErrors.push(`release-gates.examples-conformance.tag must be exactly skenion-examples-v${examplesVersion}`);
  }
  if (gate.version !== undefined) {
    requireEqual(gate.version, examplesVersion, "release-gates.examples-conformance.version", targetErrors);
  }
  requireGateStatus(gate, "release-gates.examples-conformance", targetErrors);
  requireEqual(gate.required, true, "release-gates.examples-conformance.required", targetErrors);
  if (mode !== "prepare" && !["pending", "passed"].includes(gate.status)) {
    targetErrors.push("release-gates.examples-conformance.status must be pending or passed before this conformance workflow runs");
  }
}

function requireReleaseTargetRef(value, examples, examplesVersion, targetErrors) {
  if (mode === "prepare") {
    if (value && !isSafeReleaseTargetRef(value, examplesVersion)) {
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

function requireRuntimeBinary(artifact, target, targetErrors) {
  if (!isObject(artifact)) {
    targetErrors.push(`components.runtime.binaries.${target} must be present`);
    return;
  }
  assertSemver(artifact.version, `components.runtime.binaries.${target}.version`, targetErrors);
  const expectedAssetName = runtimeAssetName(target, artifact.version);
  requireEqual(artifact.target, target, `components.runtime.binaries.${target}.target`, targetErrors);
  requireEqual(artifact.kind, "runtime-binary", `components.runtime.binaries.${target}.kind`, targetErrors);
  requireEqual(artifact.name, expectedAssetName, `components.runtime.binaries.${target}.name`, targetErrors);
  if (!isObject(artifact.source)) {
    targetErrors.push(`components.runtime.binaries.${target}.source must be an object`);
    return;
  }
  requireEqual(artifact.source.kind, "github-release-asset", `components.runtime.binaries.${target}.source.kind`, targetErrors);
  if (normalizeRepository(artifact.source.repository) !== "skenion/skenion-runtime") {
    targetErrors.push(`components.runtime.binaries.${target}.source.repository must be skenion/skenion-runtime`);
  }
  requireEqual(artifact.source.tag, `skenion-runtime-v${artifact.version}`, `components.runtime.binaries.${target}.source.tag`, targetErrors);
  requireEqual(artifact.source["asset-name"], expectedAssetName, `components.runtime.binaries.${target}.source["asset-name"]`, targetErrors);
  if (!artifact.source["asset-name"] || artifact.source["asset-name"].includes("/") || artifact.source["asset-name"].includes("\\")) {
    targetErrors.push(`components.runtime.binaries.${target}.source["asset-name"] must be a release asset name`);
  }
}

function requireRuntimeArtifacts(binaries, gate, targetErrors) {
  if (!isObject(binaries)) {
    targetErrors.push("components.runtime.binaries must be an object");
    return;
  }
  for (const [target, artifact] of Object.entries(binaries)) {
    requireRuntimeBinary(artifact, target, targetErrors);
    requireArtifactChecksum(artifact, `components.runtime.binaries.${target}`, artifact?.["support-tier"] === "release-blocking", targetErrors);
  }
  if (!isObject(gate)) {
    targetErrors.push("release-gates.runtime-release-assets must be an object");
    return;
  }
  requireGateStatus(gate, "release-gates.runtime-release-assets", targetErrors);
  requireEqual(gate.required, true, "release-gates.runtime-release-assets.required", targetErrors);
  requirePassedGate(gate, "release-gates.runtime-release-assets", targetErrors);
}

function requireStudioMetadata(studio, gates, targetErrors) {
  if (!isObject(studio)) {
    targetErrors.push("components.studio must be an object");
    return;
  }
  requireEqual(studio["contracts-line"], contractsLine, "components.studio.contracts-line", targetErrors);
  requireEqual(studio["contracts-range"], contractsLineRange(contractsLine), "components.studio.contracts-range", targetErrors);
  assertSemver(studio.version, "components.studio.version", targetErrors);

  const webGate = gates.web;
  if (!isObject(webGate)) {
    targetErrors.push("release-gates.studio-web must be an object");
  } else {
    requireGateStatus(webGate, "release-gates.studio-web", targetErrors);
    requireEqual(webGate.required, true, "release-gates.studio-web.required", targetErrors);
  }

  const desktopGate = gates.desktop;
  if (!isObject(desktopGate)) {
    targetErrors.push("release-gates.studio-desktop must be an object");
  } else {
    requireGateStatus(desktopGate, "release-gates.studio-desktop", targetErrors);
    requireEqual(desktopGate.required, true, "release-gates.studio-desktop.required", targetErrors);
  }

  const webBundle = studio["web-bundle"];
  if (webBundle !== undefined) {
    requireStudioWebBundleArtifact(webBundle, targetErrors);
  }
  for (const [target, desktopPackage] of studioArtifactEntries(studio["desktop-packages"])) {
    requireStudioArtifact(desktopPackage, target, "studio-desktop-package", targetErrors);
    requireArtifactChecksum(desktopPackage, `components.studio.desktop-packages.${target}`, desktopPackage?.["support-tier"] === "release-blocking", targetErrors);
  }
  for (const [target, sidecar] of studioArtifactEntries(studio["runtime-sidecars"])) {
    requireStudioArtifact(sidecar, target, "studio-runtime-sidecar", targetErrors);
    requireArtifactChecksum(sidecar, `components.studio.runtime-sidecars.${target}`, sidecar?.["support-tier"] === "release-blocking", targetErrors);
  }
}

function requireRegistryGate(gate, label, targetErrors) {
  if (!isObject(gate)) {
    targetErrors.push(`${label} must be an object`);
    return;
  }
  requireGateStatus(gate, label, targetErrors);
  requireEqual(gate.required, true, `${label}.required`, targetErrors);
  requirePassedGate(gate, label, targetErrors);
}

function rejectRuntimeRegistryPublishing(matrixDocument, targetErrors) {
  const runtimeComponent = matrixDocument.components?.runtime;
  for (const key of ["npm", "crate", "package"]) {
    if (runtimeComponent?.[key] !== undefined) {
      targetErrors.push(`components.runtime.${key} is not allowed; Runtime distribution must use GitHub Release binaries`);
    }
  }
  const registryPackages = matrixDocument["release-gates"]?.["registry-packages"];
  if (isObject(registryPackages)) {
    for (const [name, gate] of Object.entries(registryPackages)) {
      const packageName = gate?.package?.name ?? "";
      if (name === "runtime-crate" || name === "runtime-npm" || packageName === "skenion-runtime" || packageName === "@skenion/runtime") {
        targetErrors.push(`release-gates.registry-packages.${name} is not a compatibility-matrix registry package gate`);
      }
    }
  }
}

function requireManual(manual, gate, expectedContractsLine, targetErrors) {
  if (!isObject(manual)) {
    targetErrors.push("components.docs.manual must be an object");
    return;
  }
  if (!isStrictSemver(manual.version) && manual.version !== expectedContractsLine) {
    targetErrors.push("components.docs.manual.version must be SemVer or the Contracts line");
  }
  if (manual["contracts-line"] !== undefined) {
    requireEqual(manual["contracts-line"], expectedContractsLine, "components.docs.manual.contracts-line", targetErrors);
  }
  requireEqual(manual.path, `/manual/${expectedContractsLine}/`, "components.docs.manual.path", targetErrors);
  if (!isHttpsUrl(manual["pages-url"])) {
    targetErrors.push("components.docs.manual.pages-url must be an https URL");
  }

  if (!isObject(gate)) {
    targetErrors.push("release-gates.docs-pages-deployment must be an object");
    return;
  }
  requireGateStatus(gate, "release-gates.docs-pages-deployment", targetErrors);
  requireEqual(gate.required, true, "release-gates.docs-pages-deployment.required", targetErrors);
  if (gate["manual-version"] !== undefined) {
    requireEqual(gate["manual-version"], manual.version, "release-gates.docs-pages-deployment.manual-version", targetErrors);
  }
  if (gate["manual-path"] !== undefined) {
    requireEqual(gate["manual-path"], manual.path, "release-gates.docs-pages-deployment.manual-path", targetErrors);
  }
  if (gate["pages-url"] !== undefined) {
    requireEqual(gate["pages-url"], manual["pages-url"], "release-gates.docs-pages-deployment.pages-url", targetErrors);
  }
}

function requireStudioWebBundleArtifact(artifact, targetErrors) {
  const label = `components.studio["web-bundle"]`;
  if (!isObject(artifact)) {
    targetErrors.push(`${label} must be an object`);
    return;
  }
  if (typeof artifact.id !== "string" || artifact.id.trim() === "") {
    targetErrors.push(`${label}.id must be a non-empty string`);
  }
  assertSemver(artifact.version, `${label}.version`, targetErrors);
  requireEqual(artifact.kind, "studio-web-bundle", `${label}.kind`, targetErrors);
  requireEqual(artifact.name, `skenion-studio-web-bundle-v${artifact.version}.tar.gz`, `${label}.name`, targetErrors);
  if (!isObject(artifact.source)) {
    targetErrors.push(`${label}.source must be an object`);
    return;
  }
  requireEqual(artifact.source.kind, "github-release-asset", `${label}.source.kind`, targetErrors);
  if (normalizeRepository(artifact.source.repository) !== "skenion/skenion-studio") {
    targetErrors.push(`${label}.source.repository must be skenion/skenion-studio`);
  }
  requireEqual(artifact.source.tag, `skenion-studio-v${artifact.version}`, `${label}.source.tag`, targetErrors);
  requireEqual(
    artifact.source["asset-name"],
    `skenion-studio-web-bundle-v${artifact.version}.tar.gz`,
    `${label}.source["asset-name"]`,
    targetErrors
  );
  if (!artifact.source["asset-name"] || artifact.source["asset-name"].includes("/") || artifact.source["asset-name"].includes("\\")) {
    targetErrors.push(`${label}.source["asset-name"] must be a release asset name`);
  }
  requireArtifactChecksum(artifact, label, true, targetErrors);
}

function requireStudioArtifact(artifact, target, kind, targetErrors) {
  const label = kind === "studio-desktop-package"
    ? `components.studio.desktop-packages.${target}`
    : `components.studio.runtime-sidecars.${target}`;
  if (!isObject(artifact)) {
    targetErrors.push(`${label} must be present`);
    return;
  }
  assertSemver(artifact.version, `${label}.version`, targetErrors);
  requireEqual(artifact.target, target, `${label}.target`, targetErrors);
  requireEqual(artifact.kind, kind, `${label}.kind`, targetErrors);
  if (!isObject(artifact.source)) {
    targetErrors.push(`${label}.source must be an object`);
    return;
  }
  requireEqual(artifact.source.kind, "github-release-asset", `${label}.source.kind`, targetErrors);
  if (normalizeRepository(artifact.source.repository) !== "skenion/skenion-studio") {
    targetErrors.push(`${label}.source.repository must be skenion/skenion-studio`);
  }
  requireEqual(artifact.source.tag, `skenion-studio-v${artifact.version}`, `${label}.source.tag`, targetErrors);
  const assetName = artifact.source["asset-name"];
  if (!assetName || assetName.includes("/") || assetName.includes("\\")) {
    targetErrors.push(`${label}.source["asset-name"] must be a release asset name`);
  } else {
    requireEqual(artifact.name, assetName, `${label}.name`, targetErrors);
  }
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
      targetErrors.push(`${label}.value must be a matrix-pinned SHA-256 in publish/verify mode`);
    }
    return "";
  }
  if (!/^[a-f0-9]{64}$/i.test(artifact.checksum.value)) {
    targetErrors.push(`${label}.value must be a 64-character SHA-256 hex digest`);
    return "";
  }
  return artifact.checksum.value.toLowerCase();
}

function rejectLocalReleaseSources(matrixDocument, targetErrors) {
  for (const { fieldPath, value } of collectStringFields(matrixDocument)) {
    const reason = forbiddenReleaseSourceReason(value, fieldPath);
    if (reason) {
      targetErrors.push(`compatibility matrix ${fieldPath} contains forbidden ${reason}: ${JSON.stringify(value)}`);
    }
  }

  for (const { fieldPath, value } of collectRefs(matrixDocument)) {
    if (!isAllowedReleaseRef(value)) {
      targetErrors.push(`release source ref ${fieldPath}=${JSON.stringify(value)} must be an exact component release tag or 40-character git SHA`);
    }
  }
}

function studioArtifactEntries(value) {
  if (Array.isArray(value)) {
    return value
      .filter(isObject)
      .map((artifact, index) => [artifact.target ?? String(index), artifact]);
  }
  if (isObject(value)) {
    return Object.entries(value);
  }
  return [];
}

function collectStringFields(value, fieldPath = "$", fields = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectStringFields(item, `${fieldPath}[${index}]`, fields));
  } else if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      collectStringFields(item, `${fieldPath}.${key}`, fields);
    }
  } else if (typeof value === "string") {
    fields.push({ fieldPath, value });
  }
  return fields;
}

function forbiddenReleaseSourceReason(value, fieldPath) {
  if (/\bechovisionlab\//i.test(value)) {
    return "stale echovisionlab artifact reference";
  }
  if (isUrlReleaseSourceField(fieldPath) && !isHttpsUrl(value)) {
    return "non-https release artifact URL";
  }
  if (/\b(?:file|link|workspace):/i.test(value)) {
    return "local package override";
  }
  if (/(^|[\\/])(?:\.deps|node_modules)([\\/]|$)/i.test(value)) {
    return "local dependency path";
  }
  if (/(^|[\\/])target[\\/](?:debug|release)([\\/]|$)/i.test(value)) {
    return "local build output path";
  }
  if (/\/Volumes\/(?:Linear|dev)\/Skenion\//i.test(value)) {
    return "sibling workspace path";
  }
  if (isPathLikeReleaseSourceField(fieldPath) && isLocalPathSyntax(value) && !isAllowedMatrixPath(fieldPath)) {
    return "local path";
  }
  return "";
}

function isPathLikeReleaseSourceField(fieldPath) {
  return ["path", "localPath", "cachePath", "packagePath", "override", "specifier", "url"].includes(fieldPathKey(fieldPath));
}

function isUrlReleaseSourceField(fieldPath) {
  return fieldPathKey(fieldPath) === "url";
}

function fieldPathKey(fieldPath) {
  const segments = fieldPath.split(".");
  return segments[segments.length - 1];
}

function isAllowedMatrixPath(fieldPath) {
  return fieldPath === "$.components.docs.manual.path"
    || fieldPath === "$.release-gates.docs-pages-deployment.manual-path";
}

function isLocalPathSyntax(value) {
  return value.startsWith("/")
    || value.startsWith("./")
    || value.startsWith("../")
    || value.startsWith(".\\")
    || value.startsWith("..\\")
    || value.startsWith("~/")
    || /^[a-z]:[\\/]/i.test(value);
}

function collectRefs(value, refs = [], fieldPath = "$") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectRefs(item, refs, `${fieldPath}[${index}]`));
  } else if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      const nextFieldPath = `${fieldPath}.${key}`;
      if (["ref", "tag", "targetRef"].includes(key) && typeof item === "string" && !isInformationalExamplesRef(nextFieldPath)) {
        refs.push({ fieldPath: nextFieldPath, value: item });
      }
      collectRefs(item, refs, nextFieldPath);
    }
  }
  return refs;
}

function isInformationalExamplesRef(fieldPath) {
  return fieldPath === "$.components.examples.ref";
}

function isAllowedReleaseRef(value) {
  return isGitSha(value) || isExactComponentReleaseTag(value);
}

function isExactComponentReleaseTag(value) {
  return typeof value === "string"
    && /^skenion(?:-[a-z0-9]+)+-v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(value);
}

function runtimeAssetName(target, version) {
  return `skenion-runtime-v${version}-${target}.tar.gz`;
}

function isStrictExamplesReleaseTag(value, version) {
  return value === `skenion-examples-v${version}` && isStrictSemver(version);
}

function isSafeReleaseTargetRef(value, version) {
  return isGitSha(value) || isStrictExamplesReleaseTag(value, version);
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

function contractsLineRange(line) {
  const [, minor] = line.split(".");
  return `>=0.${minor}.0 <0.${Number(minor) + 1}.0`;
}

function versionInContractsLine(version, line) {
  const parsed = parseSemver(version);
  const [, minor] = line.split(".");
  return parsed !== null && parsed.major === 0 && parsed.minor === Number(minor);
}

function rangeContainsVersion(range, version) {
  if (!isStrictSemver(version) || typeof range !== "string") {
    return false;
  }
  const normalized = range.trim();
  if (isStrictSemver(normalized)) {
    return normalized === version;
  }
  const match = normalized.match(/^>=([0-9]+\.[0-9]+\.[0-9]+) <([0-9]+\.[0-9]+\.[0-9]+)$/);
  if (!match) {
    return false;
  }
  return compareSemver(version, match[1]) >= 0 && compareSemver(version, match[2]) < 0;
}

function parseSemver(value) {
  const match = String(value ?? "").match(/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/);
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareSemver(left, right) {
  const leftParsed = parseSemver(left);
  const rightParsed = parseSemver(right);
  for (const key of ["major", "minor", "patch"]) {
    if (leftParsed[key] !== rightParsed[key]) {
      return leftParsed[key] - rightParsed[key];
    }
  }
  return 0;
}

function isContractsLine(value) {
  return /^0\.(0|[1-9][0-9]*)$/.test(String(value ?? ""));
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
  return normalizeGitHubRepository(value);
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

function reportErrorsAndExit(targetErrors) {
  for (const error of targetErrors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}
