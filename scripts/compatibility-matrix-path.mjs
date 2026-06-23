import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";

export function normalizeCompatibilityMatrixInput(input, {
  contractsLine,
  matrixRepository = "skenion/skenion",
  errors,
}) {
  const targetErrors = errors ?? [];
  const trimmed = String(input ?? "").trim();

  if (!isContractsLine(contractsLine)) {
    targetErrors.push("contracts line must be a v0 minor line such as 0.45");
    return null;
  }

  const expectedRepository = normalizeGitHubRepository(matrixRepository);
  const expectedPath = compatibilityMatrixRepositoryPath(contractsLine);
  const initialErrorCount = targetErrors.length;

  if (trimmed.length === 0) {
    targetErrors.push("--matrix path must not be empty");
  }
  if (input !== trimmed) {
    targetErrors.push("--matrix path must not contain surrounding whitespace");
  }
  if (trimmed.includes("\0")) {
    targetErrors.push("--matrix path must not contain null bytes");
  }
  if (trimmed.includes("\\")) {
    targetErrors.push("--matrix path must use forward slashes");
  }
  if (hasDotDotPathSegment(trimmed)) {
    targetErrors.push("--matrix path must not contain .. segments");
  }
  if (hasUrlLikeScheme(trimmed)) {
    targetErrors.push("--matrix path must be a local compatibility matrix file path, not a URL or scheme");
  }
  if (targetErrors.length > initialErrorCount) {
    return null;
  }

  const absolutePath = path.resolve(trimmed);
  const canonicalPath = canonicalizeMatrixPath(absolutePath, targetErrors);
  if (!canonicalPath) {
    return null;
  }

  const repositoryRoot = gitRootForMatrixPath(canonicalPath, targetErrors);
  if (!repositoryRoot) {
    return null;
  }

  const canonicalRepositoryRoot = realpathSync.native(repositoryRoot);
  const repositoryRelativePath = toPosixPath(path.relative(canonicalRepositoryRoot, canonicalPath));
  if (repositoryRelativePath === ".." || repositoryRelativePath.startsWith("../") || path.isAbsolute(repositoryRelativePath)) {
    targetErrors.push(`--matrix must be inside ${matrixRepository}`);
    return null;
  }
  if (repositoryRelativePath !== expectedPath) {
    targetErrors.push(`--matrix must point to ${expectedPath} inside ${matrixRepository}, got ${repositoryRelativePath}`);
    return null;
  }

  const actualRepository = gitOriginRepository(repositoryRoot, targetErrors);
  if (!actualRepository) {
    return null;
  }
  if (actualRepository !== expectedRepository) {
    targetErrors.push(`--matrix must come from ${expectedRepository}, got ${actualRepository}`);
    return null;
  }

  return {
    kind: "path",
    absolutePath: canonicalPath,
    repositoryRelativePath,
    repositoryRoot: canonicalRepositoryRoot,
  };
}

export function compatibilityMatrixRepositoryPath(contractsLine) {
  return `releases/compatibility/contracts-${contractsLine}.json`;
}

export function normalizeGitHubRepository(value) {
  return String(value ?? "")
    .replace(/^https:\/\/github.com\//i, "")
    .replace(/^ssh:\/\/git@github\.com\//i, "")
    .replace(/^git@github\.com:/i, "")
    .replace(/\.git$/i, "")
    .toLowerCase();
}

function gitRootForMatrixPath(matrixPath, targetErrors) {
  try {
    return execFileSync("git", ["-C", path.dirname(matrixPath), "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    targetErrors.push("--matrix must be inside a git checkout for skenion/skenion");
    return "";
  }
}

function canonicalizeMatrixPath(matrixPath, targetErrors) {
  try {
    const directory = realpathSync.native(path.dirname(matrixPath));
    return path.join(directory, path.basename(matrixPath));
  } catch {
    targetErrors.push("--matrix parent directory must exist");
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
    targetErrors.push("--matrix git checkout must have an origin remote for skenion/skenion");
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

function isContractsLine(value) {
  return /^0\.(0|[1-9][0-9]*)$/.test(String(value ?? ""));
}
