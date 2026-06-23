#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const validator = path.join(root, "scripts", "validate-compatibility-matrix.mjs");
const tempRoot = await mkdtemp(path.join(tmpdir(), "skenion-compatibility-matrix-"));

const contractsLine = "0.45";
const contractsVersion = "0.45.0";
const sdkVersion = "0.43.0";
const runtimeVersion = "0.44.2";
const studioVersion = "0.44.3";
const target = "x86_64-unknown-linux-gnu";
const commitSha = "b".repeat(40);
const matrixRef = "c".repeat(40);
const checksumValue = "a".repeat(64);
const hubRoot = path.join(tempRoot, "skenion");
const matrixFile = path.join(hubRoot, "releases", "compatibility", `${contractsLine}.json`);

try {
  await prepareHubRepo();
  runCase("valid-publish-with-independent-component-versions", {
    expectSuccess: true,
  });
  runCase("valid-publish-with-https-source-url", {
    mutate(matrix) {
      matrix.components.runtime.binaries[target].source.url = runtimeReleaseUrl();
    },
    expectSuccess: true,
  });
  runMatrixPathCase("reject-matrix-path-traversal", {
    matrixPath: `${path.join(hubRoot, "releases", "compatibility")}/../../matrix.json`,
    expectedOutput: ["--matrix path must not contain .. segments"],
  });
  runMatrixPathCase("reject-matrix-path-line-mismatch", {
    matrixPath: path.join(hubRoot, "releases", "compatibility", "0.44.json"),
    expectedOutput: [`releases/compatibility/${contractsLine}.json`],
  });
  runMatrixPathCase("reject-legacy-contracts-prefixed-matrix-path", {
    matrixPath: path.join(hubRoot, "releases", "compatibility", `contracts-${contractsLine}.json`),
    expectedOutput: [`releases/compatibility/${contractsLine}.json`],
  });
  runCase("reject-old-matrix-repository", {
    matrixRepository: "echovisionlab/skenion",
    expectedOutput: ["matrix repository must be skenion/skenion"],
  });
  runCase("reject-contracts-outside-line", {
    mutate(matrix) {
      matrix.contracts.npm.version = "0.44.0";
      matrix.contracts.crate.version = "0.44.0";
    },
    expectedOutput: ["contracts.npm.version must be in Contracts line 0.45"],
  });
  runCase("reject-sdk-range-that-misses-contracts", {
    mutate(matrix) {
      matrix.components.sdk.npm["supported-contracts"] = ">=0.44.0 <0.45.0";
    },
    expectedOutput: ["supported Contracts range must contain released Contracts 0.45.0"],
  });
  runCase("reject-old-owner-source", {
    mutate(matrix) {
      matrix.components.examples.repository = "echovisionlab/skenion-examples";
      matrix["release-gates"]["examples-conformance"].repository = "echovisionlab/skenion-examples";
    },
    expectedOutput: ["stale echovisionlab"],
  });
  runCase("reject-stale-echovisionlab-artifact-url", {
    mutate(matrix) {
      matrix.components.runtime.binaries[target].source.url =
        `https://github.com/echovisionlab/skenion-runtime/releases/download/skenion-runtime-v0.34.0/skenion-runtime-v0.34.0-${target}.tar.gz`;
    },
    expectedOutput: ["stale echovisionlab"],
  });
  runCase("reject-absolute-source-url-path", {
    mutate(matrix) {
      matrix.components.runtime.binaries[target].source.url = "/tmp/runtime.tar.gz";
    },
    expectedOutput: ["source.url", "non-https release artifact URL"],
  });
  runCase("reject-relative-source-url-path", {
    mutate(matrix) {
      matrix.components.runtime.binaries[target].source.url = "../runtime.tar.gz";
    },
    expectedOutput: ["source.url", "non-https release artifact URL"],
  });
  runCase("reject-file-source-url", {
    mutate(matrix) {
      matrix.components.runtime.binaries[target].source.url = "file:///tmp/runtime.tar.gz";
    },
    expectedOutput: ["source.url", "non-https release artifact URL"],
  });
  runCase("reject-main-ref", {
    mutate(matrix) {
      matrix["release-gates"]["examples-conformance"].ref = "refs/heads/main";
    },
    expectedOutput: ["refs/heads/main"],
  });
  runCase("reject-sibling-branch-ref", {
    mutate(matrix) {
      matrix.components.runtime.binaries[target].source.ref = "skenion-runtime/main";
    },
    expectedOutput: ["skenion-runtime/main", "exact component release tag"],
  });
  runCase("reject-non-release-ref", {
    mutate(matrix) {
      matrix.components.runtime.binaries[target].source.ref = "release-candidate";
    },
    expectedOutput: ["release-candidate", "exact component release tag"],
  });
  runCase("reject-deps-source", {
    mutate(matrix) {
      matrix.components.runtime.binaries[target].source.cachePath = ".deps/skenion-runtime";
    },
    expectedOutput: [".deps"],
  });
  runCase("reject-sibling-worktree-source", {
    mutate(matrix) {
      matrix.components.runtime.binaries[target].source.localPath =
        "/Volumes/Linear/Skenion/Skenion-runtime/target/release/skenion-runtime";
    },
    expectedOutput: ["target/release"],
  });
  runCase("reject-local-package-override", {
    mutate(matrix) {
      matrix.components.sdk.npm.override = "workspace:*";
    },
    expectedOutput: ["local package override"],
  });
  runCase("reject-old-runtime-asset-name", {
    mutate(matrix) {
      const oldName = `skenion-runtime-${target}.tar.gz`;
      matrix.components.runtime.binaries[target].name = oldName;
      matrix.components.runtime.binaries[target].source["asset-name"] = oldName;
    },
    expectedOutput: [`skenion-runtime-v${runtimeVersion}-${target}.tar.gz`],
  });
  runCase("reject-runtime-registry-gate", {
    mutate(matrix) {
      matrix["release-gates"]["registry-packages"] = {};
      matrix["release-gates"]["registry-packages"]["runtime-crate"] = {
        required: true,
        status: "passed",
        package: {
          ecosystem: "crates.io",
          name: "skenion-runtime",
          version: runtimeVersion,
        },
      };
    },
    expectedOutput: ["release-gates.registry-packages.runtime-crate"],
  });
} finally {
  await rm(tempRoot, { force: true, recursive: true });
}

console.log("validated compatibility matrix negative cases");

function runCase(name, options = {}) {
  const matrix = validMatrix();
  options.mutate?.(matrix);
  writeFileSync(matrixFile, `${JSON.stringify(matrix, null, 2)}\n`);
  const result = spawnSync(process.execPath, [
    validator,
    "--matrix",
    matrixFile,
    "--contracts-line",
    contractsLine,
    "--mode",
    "publish",
    "--runtime-target",
    target,
    "--target-ref",
    commitSha,
    "--matrix-ref",
    matrixRef,
    "--matrix-repository",
    options.matrixRepository ?? "skenion/skenion",
    "--out-dir",
    path.join(tempRoot, name),
  ], {
    cwd: root,
    encoding: "utf8",
  });
  const output = `${result.stdout}${result.stderr}`;

  if (options.expectSuccess) {
    if (result.status !== 0) {
      throw new Error(`${name} failed unexpectedly:\n${output}`);
    }
    return;
  }

  if (result.status === 0) {
    throw new Error(`${name} passed unexpectedly`);
  }
  for (const expected of options.expectedOutput ?? []) {
    if (!output.includes(expected)) {
      throw new Error(`${name} did not include ${JSON.stringify(expected)}:\n${output}`);
    }
  }
}

function runMatrixPathCase(name, options) {
  const result = spawnSync(process.execPath, [
    validator,
    "--matrix",
    options.matrixPath,
    "--contracts-line",
    contractsLine,
    "--mode",
    "publish",
    "--runtime-target",
    target,
    "--target-ref",
    commitSha,
    "--matrix-ref",
    matrixRef,
    "--matrix-repository",
    "skenion/skenion",
    "--out-dir",
    path.join(tempRoot, name),
  ], {
    cwd: root,
    encoding: "utf8",
  });
  const output = `${result.stdout}${result.stderr}`;

  if (result.status === 0) {
    throw new Error(`${name} passed unexpectedly`);
  }
  for (const expected of options.expectedOutput ?? []) {
    if (!output.includes(expected)) {
      throw new Error(`${name} did not include ${JSON.stringify(expected)}:\n${output}`);
    }
  }
}

async function prepareHubRepo() {
  await mkdir(path.join(hubRoot, "releases", "compatibility"), { recursive: true });
  runGit(["init", "--quiet"], hubRoot);
  runGit(["remote", "add", "origin", "git@github.com:skenion/skenion.git"], hubRoot);
}

function runGit(args, cwd) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed:\n${result.stdout}${result.stderr}`);
  }
}

function validMatrix() {
  const contractsNpm = pkg("npm", "@skenion/contracts", contractsVersion);
  const contractsCrate = pkg("crates.io", "skenion-contracts", contractsVersion);
  const sdkNpm = {
    ...pkg("npm", "@skenion/sdk", sdkVersion),
    "supported-contracts": ">=0.45.0 <0.46.0",
  };
  const runtimeArtifact = artifact({
    id: "runtime-linux-x64",
    kind: "runtime-binary",
    version: runtimeVersion,
    repository: "skenion/skenion-runtime",
    tag: `skenion-runtime-v${runtimeVersion}`,
    "asset-name": `skenion-runtime-v${runtimeVersion}-x86_64-unknown-linux-gnu.tar.gz`,
  });

  return {
    schema: "skenion.compatibility-matrix",
    "schema-version": "0.1.0",
    contracts: {
      line: contractsLine,
      range: ">=0.45.0 <0.46.0",
      npm: contractsNpm,
      crate: contractsCrate,
    },
    components: {
      runtime: {
        binaries: {
          [target]: runtimeArtifact,
        },
      },
      sdk: {
        npm: sdkNpm,
      },
      studio: {
        "contracts-line": contractsLine,
        "contracts-range": ">=0.45.0 <0.46.0",
        version: studioVersion,
        release: {
          repository: "skenion/skenion-studio",
          tag: `skenion-studio-v${studioVersion}`,
          status: "verified",
        },
        web: {
          status: "pending",
        },
        "desktop-packages": [],
        "runtime-sidecars": [],
        "artifact-status": "pending",
      },
      docs: {
        manual: {
          version: contractsLine,
          path: `/manual/${contractsLine}/`,
          "pages-url": "https://skenion.github.io/skenion-docs/",
        },
      },
      examples: {
        repository: "skenion/skenion-examples",
        ref: "main",
        commit: commitSha,
      },
    },
    "release-gates": {
      "contracts-registry": {
        required: true,
        status: "passed",
      },
      "runtime-release-assets": {
        required: true,
        status: "passed",
      },
      "sdk-registry": {
        required: true,
        status: "passed",
      },
      "studio-web": {
        required: true,
        status: "pending",
      },
      "studio-desktop": {
        required: true,
        status: "pending",
      },
      "examples-conformance": {
        required: true,
        status: "pending",
      },
      "docs-pages-deployment": {
        required: true,
        status: "pending",
      },
    },
  };
}

function pkg(ecosystem, name, version) {
  return {
    ecosystem,
    name,
    version,
  };
}

function artifact({ id, kind, version, repository, tag, "asset-name": assetName }) {
  return {
    id,
    target,
    kind,
    name: assetName,
    version,
    "support-tier": "release-blocking",
    source: {
      kind: "github-release-asset",
      repository,
      tag,
      "asset-name": assetName,
    },
    checksum: checksum(),
  };
}

function runtimeReleaseUrl() {
  return `https://github.com/skenion/skenion-runtime/releases/download/skenion-runtime-v${runtimeVersion}/skenion-runtime-v${runtimeVersion}-${target}.tar.gz`;
}

function checksum() {
  return {
    algorithm: "sha256",
    value: checksumValue,
  };
}
