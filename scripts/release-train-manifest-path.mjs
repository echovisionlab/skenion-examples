import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";

export function normalizeTrainManifestInput(input, {
  trainVersion,
  manifestRepository = "skenion/skenion",
  errors,
}) {
  const targetErrors = errors ?? [];
  const trimmed = String(input ?? "").trim();

  if (!isStrictSemver(trainVersion)) {
    targetErrors.push("train version must be registry-compatible SemVer without leading zeros");
    return null;
  }

  const expectedRepository = normalizeGitHubRepository(manifestRepository);
  const expectedPath = trainManifestRepositoryPath(trainVersion);
  const initialErrorCount = targetErrors.length;

  if (trimmed.length === 0) {
    targetErrors.push("--manifest path must not be empty");
  }
  if (input !== trimmed) {
    targetErrors.push("--manifest path must not contain surrounding whitespace");
  }
  if (trimmed.includes("\0")) {
    targetErrors.push("--manifest path must not contain null bytes");
  }
  if (trimmed.includes("\\")) {
    targetErrors.push("--manifest path must use forward slashes");
  }
  if (hasDotDotPathSegment(trimmed)) {
    targetErrors.push("--manifest path must not contain .. segments");
  }
  if (hasUrlLikeScheme(trimmed)) {
    targetErrors.push("--manifest path must be a local train manifest file path, not a URL or scheme");
  }
  if (targetErrors.length > initialErrorCount) {
    return null;
  }

  const absolutePath = path.resolve(trimmed);
  const canonicalPath = canonicalizeManifestPath(absolutePath, targetErrors);
  if (!canonicalPath) {
    return null;
  }

  const repositoryRoot = gitRootForManifestPath(canonicalPath, targetErrors);
  if (!repositoryRoot) {
    return null;
  }

  const canonicalRepositoryRoot = realpathSync.native(repositoryRoot);
  const repositoryRelativePath = toPosixPath(path.relative(canonicalRepositoryRoot, canonicalPath));
  if (repositoryRelativePath === ".." || repositoryRelativePath.startsWith("../") || path.isAbsolute(repositoryRelativePath)) {
    targetErrors.push(`--manifest must be inside ${manifestRepository}`);
    return null;
  }
  if (repositoryRelativePath !== expectedPath) {
    targetErrors.push(`--manifest must point to ${expectedPath} inside ${manifestRepository}, got ${repositoryRelativePath}`);
    return null;
  }

  const actualRepository = gitOriginRepository(repositoryRoot, targetErrors);
  if (!actualRepository) {
    return null;
  }
  if (actualRepository !== expectedRepository) {
    targetErrors.push(`--manifest must come from ${expectedRepository}, got ${actualRepository}`);
    return null;
  }

  return {
    kind: "path",
    absolutePath: canonicalPath,
    repositoryRelativePath,
    repositoryRoot: canonicalRepositoryRoot,
  };
}

export function trainManifestRepositoryPath(trainVersion) {
  return `releases/trains/${trainVersion}.json`;
}

export function normalizeGitHubRepository(value) {
  return String(value ?? "")
    .replace(/^https:\/\/github.com\//i, "")
    .replace(/^ssh:\/\/git@github\.com\//i, "")
    .replace(/^git@github\.com:/i, "")
    .replace(/\.git$/i, "")
    .toLowerCase();
}

function gitRootForManifestPath(manifestPath, targetErrors) {
  try {
    return execFileSync("git", ["-C", path.dirname(manifestPath), "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    targetErrors.push("--manifest must be inside a git checkout for skenion/skenion");
    return "";
  }
}

function canonicalizeManifestPath(manifestPath, targetErrors) {
  try {
    const directory = realpathSync.native(path.dirname(manifestPath));
    return path.join(directory, path.basename(manifestPath));
  } catch {
    targetErrors.push("--manifest parent directory must exist");
    return "";
  }
}

function gitOriginRepository(repositoryRoot, targetErrors) {
  try {
    const originUrl = execFileSync("git", ["-C", repositoryRoot, "remote", "get-url", "origin"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return normalizeGitHubRepository(originUrl);
  } catch {
    targetErrors.push("--manifest git checkout must have an origin remote for skenion/skenion");
    return "";
  }
}

function hasDotDotPathSegment(value) {
  return value.split("/").includes("..");
}

function hasUrlLikeScheme(value) {
  return /^[a-z][a-z0-9+.-]*:/i.test(value);
}

function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

function isStrictSemver(value) {
  return /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(String(value ?? ""));
}
