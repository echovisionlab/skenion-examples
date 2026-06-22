#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const args = parseArgs(process.argv.slice(2));
const mode = requireChoice(args.mode ?? "prepare", ["prepare", "publish", "verify"], "--mode");
const tag = requireArg("tag");
const trainVersion = requireArg("train-version");
const expectedCommit = args.commit || "";
const dryRun = args["dry-run"] !== "false";
const expectedCommitIsSha = /^[0-9a-f]{40}$/i.test(expectedCommit);

if (!isStrictSemver(trainVersion)) {
  throw new Error("--train-version must be registry-compatible SemVer without leading zeros");
}
if (!isStrictExamplesReleaseTag(tag, trainVersion)) {
  throw new Error(`--tag must be exactly skenion-examples-v${trainVersion}`);
}
if (!expectedCommitIsSha && mode !== "prepare") {
  throw new Error("--commit must be a recorded 40-character git SHA in publish/verify mode");
}

const head = git(["rev-parse", "HEAD"]);
const targetCommit = expectedCommitIsSha ? expectedCommit : head;
git(["cat-file", "-e", `${targetCommit}^{commit}`]);

if (mode === "prepare") {
  const marker = expectedCommit && !expectedCommitIsSha ? `; manifest commit marker is ${expectedCommit}` : "";
  console.log(`Would bind ${tag} to ${targetCommit}${marker}${dryRun ? " (dry run)" : ""}.`);
  process.exit(0);
}

const existingCommit = resolveRemoteTag(tag);
if (mode === "verify") {
  if (!existingCommit) {
    throw new Error(`release tag ${tag} does not exist on origin`);
  }
  if (expectedCommit && existingCommit !== expectedCommit) {
    throw new Error(`release tag ${tag} points at ${existingCommit}, expected ${expectedCommit}`);
  }
  console.log(`Verified ${tag} at ${existingCommit}.`);
  process.exit(0);
}

if (existingCommit) {
  if (existingCommit !== targetCommit) {
    throw new Error(`release tag ${tag} already points at ${existingCommit}, expected ${targetCommit}`);
  }
  console.log(`Release tag ${tag} already exists at ${existingCommit}.`);
  process.exit(0);
}

if (dryRun) {
  console.log(`Would create and push ${tag} at ${targetCommit} (dry run).`);
  process.exit(0);
}

git(["tag", "-a", tag, targetCommit, "-m", `Skenion examples ${tag}`], { stdio: "inherit" });
git(["push", "origin", `refs/tags/${tag}`], { stdio: "inherit" });
console.log(`Created and pushed ${tag} at ${targetCommit}.`);

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

function requireChoice(value, choices, label) {
  if (!choices.includes(value)) {
    throw new Error(`${label} must be one of ${choices.join(", ")}`);
  }
  return value;
}

function resolveRemoteTag(name) {
  const output = git(["ls-remote", "--tags", "origin", `refs/tags/${name}`, `refs/tags/${name}^{}`]);
  const lines = output.split("\n").filter(Boolean);
  const peeled = lines.find((line) => line.endsWith(`refs/tags/${name}^{}`));
  const direct = lines.find((line) => line.endsWith(`refs/tags/${name}`));
  const selected = peeled || direct;
  return selected ? selected.split(/\s+/)[0] : "";
}

function git(gitArgs, options = {}) {
  return execFileSync("git", gitArgs, {
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
  }).trim();
}

function isStrictExamplesReleaseTag(value, expectedVersion) {
  return value === `skenion-examples-v${expectedVersion}` && isStrictSemver(expectedVersion);
}

function isStrictSemver(value) {
  return /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(String(value ?? ""));
}
