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
const runtimeCrate = manifest.components?.runtime?.crate;
const runtimeBinary = manifest.components?.runtime?.binaries?.[runtimeTarget];
const examples = manifest.components?.examples;
const examplesGate = manifest.releaseGates?.examplesConformance;

requirePackage(contractsPackage, "components.contracts.npm", {
  ecosystem: "npm",
  name: "@skenion/contracts",
  version: trainVersion,
}, errors);
requirePackage(runtimeCrate, "components.runtime.crate", {
  ecosystem: "crates.io",
  name: "skenion-runtime",
  version: trainVersion,
}, errors);
requireExamples(examples, examplesGate, trainVersion, currentRepository, errors);
requireReleaseTargetRef(targetRef, examples, errors);
requireRuntimeBinary(runtimeBinary, runtimeTarget, trainVersion, errors);
const runtimeChecksum = requireRuntimeChecksum(runtimeBinary, runtimeTarget, errors);
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
  runtimeCrate: `${runtimeCrate.name}@${runtimeCrate.version}`,
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
};
await writeFile(path.join(outDir, "examples-release-train.json"), `${JSON.stringify(summary, null, 2)}\n`);
writeOutputs({
  train_id: trainId,
  train_version: trainVersion,
  contracts_npm_version: contractsPackage.version,
  runtime_repository: runtimeBinary.source.repository,
  runtime_tag: runtimeBinary.source.tag,
  runtime_asset: runtimeBinary.source.assetName,
  runtime_sha256: runtimeChecksum,
  runtime_target: runtimeTarget,
  examples_repository: examples.repository,
  examples_tag: examples.tag,
  examples_commit: examples.commit ?? "",
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
