#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const validator = path.join(root, "scripts", "validate-release-train.mjs");
const tempRoot = await mkdtemp(path.join(tmpdir(), "skenion-release-train-"));

const version = "0.43.0";
const trainId = "0.43";
const target = "x86_64-unknown-linux-gnu";
const commitSha = "b".repeat(40);
const manifestRef = "c".repeat(40);
const checksumValue = "a".repeat(64);
const conductorRoot = path.join(tempRoot, "skenion");
const conductorManifestFile = path.join(conductorRoot, "releases", "trains", `${version}.json`);

try {
  await prepareConductorRepo();
  runCase("valid-publish-without-runtime-crate", {
    expectSuccess: true,
  });
  runCase("valid-publish-with-https-source-url", {
    mutate(manifest) {
      manifest.components.runtime.binaries[target].source.url = runtimeReleaseUrl();
    },
    expectSuccess: true,
  });
  runManifestPathCase("reject-manifest-path-traversal", {
    manifestPath: `${path.join(conductorRoot, "releases", "trains")}/../../manifest.json`,
    expectedOutput: ["--manifest path must not contain .. segments"],
  });
  runManifestPathCase("reject-manifest-path-version-mismatch", {
    manifestPath: path.join(conductorRoot, "releases", "trains", "0.42.0.json"),
    expectedOutput: [`releases/trains/${version}.json`],
  });
  runCase("reject-old-manifest-repository", {
    manifestRepository: "echovisionlab/skenion",
    expectedOutput: ["manifest repository must be skenion/skenion"],
  });
  runCase("reject-old-owner-source", {
    mutate(manifest) {
      manifest.components.examples.repository = "echovisionlab/skenion-examples";
      manifest["release-gates"]["examples-conformance"].repository = "echovisionlab/skenion-examples";
    },
    expectedOutput: ["stale echovisionlab"],
  });
  runCase("reject-stale-echovisionlab-artifact-url", {
    mutate(manifest) {
      manifest.components.runtime.binaries[target].source.url =
        `https://github.com/echovisionlab/skenion-runtime/releases/download/skenion-runtime-v0.34.0/skenion-runtime-v0.34.0-${target}.tar.gz`;
    },
    expectedOutput: ["stale echovisionlab"],
  });
  runCase("reject-absolute-source-url-path", {
    mutate(manifest) {
      manifest.components.runtime.binaries[target].source.url = "/tmp/runtime.tar.gz";
    },
    expectedOutput: ["source.url", "non-https release artifact URL"],
  });
  runCase("reject-relative-source-url-path", {
    mutate(manifest) {
      manifest.components.runtime.binaries[target].source.url = "../runtime.tar.gz";
    },
    expectedOutput: ["source.url", "non-https release artifact URL"],
  });
  runCase("reject-file-source-url", {
    mutate(manifest) {
      manifest.components.runtime.binaries[target].source.url = "file:///tmp/runtime.tar.gz";
    },
    expectedOutput: ["source.url", "non-https release artifact URL"],
  });
  runCase("reject-main-ref", {
    mutate(manifest) {
      manifest["release-gates"]["examples-conformance"].ref = "refs/heads/main";
    },
    expectedOutput: ["refs/heads/main"],
  });
  runCase("reject-sibling-branch-ref", {
    mutate(manifest) {
      manifest.components.runtime.binaries[target].source.ref = "skenion-runtime/main";
    },
    expectedOutput: ["skenion-runtime/main", "exact train release tag"],
  });
  runCase("reject-non-release-ref", {
    mutate(manifest) {
      manifest.components.runtime.binaries[target].source.ref = "release-candidate";
    },
    expectedOutput: ["release-candidate", "exact train release tag"],
  });
  runCase("reject-deps-source", {
    mutate(manifest) {
      manifest.components.runtime.binaries[target].source.cachePath = ".deps/skenion-runtime";
    },
    expectedOutput: [".deps"],
  });
  runCase("reject-sibling-worktree-source", {
    mutate(manifest) {
      manifest.components.runtime.binaries[target].source.localPath =
        "/Volumes/Linear/Skenion/Skenion-runtime/target/release/skenion-runtime";
    },
    expectedOutput: ["target/release"],
  });
  runCase("reject-local-package-override", {
    mutate(manifest) {
      manifest.components.sdk.npm.override = "workspace:*";
    },
    expectedOutput: ["local package override"],
  });
  runCase("reject-old-runtime-asset-name", {
    mutate(manifest) {
      const oldName = `skenion-runtime-${target}.tar.gz`;
      manifest.components.runtime.binaries[target].name = oldName;
      manifest.components.runtime.binaries[target].source["asset-name"] = oldName;
    },
    expectedOutput: [`skenion-runtime-v${version}-${target}.tar.gz`],
  });
  runCase("reject-runtime-registry-gate", {
    mutate(manifest) {
      manifest["release-gates"]["registry-packages"]["runtime-crate"] = {
        required: true,
        status: "passed",
        package: {
          ecosystem: "crates.io",
          name: "skenion-runtime",
          version,
        },
      };
    },
    expectedOutput: ["release-gates.registry-packages.runtime-crate"],
  });
} finally {
  await rm(tempRoot, { force: true, recursive: true });
}

console.log("validated release train negative cases");

function runCase(name, options = {}) {
  const manifest = validManifest();
  options.mutate?.(manifest);
  writeFileSync(conductorManifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  const result = spawnSync(process.execPath, [
    validator,
    "--manifest",
    conductorManifestFile,
    "--train-version",
    version,
    "--mode",
    "publish",
    "--runtime-target",
    target,
    "--target-ref",
    commitSha,
    "--manifest-ref",
    manifestRef,
    "--manifest-repository",
    options.manifestRepository ?? "skenion/skenion",
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

function runManifestPathCase(name, options) {
  const result = spawnSync(process.execPath, [
    validator,
    "--manifest",
    options.manifestPath,
    "--train-version",
    version,
    "--mode",
    "publish",
    "--runtime-target",
    target,
    "--target-ref",
    commitSha,
    "--manifest-ref",
    manifestRef,
    "--manifest-repository",
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

async function prepareConductorRepo() {
  await mkdir(path.join(conductorRoot, "releases", "trains"), { recursive: true });
  runGit(["init", "--quiet"], conductorRoot);
  runGit(["remote", "add", "origin", "git@github.com:skenion/skenion.git"], conductorRoot);
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

function validManifest() {
  const contractsNpm = pkg("npm", "@skenion/contracts");
  const contractsCrate = pkg("crates.io", "skenion-contracts");
  const sdkNpm = pkg("npm", "@skenion/sdk");
  const runtimeArtifact = artifact({
    id: "runtime-linux-x64",
    kind: "runtime-binary",
    repository: "skenion/skenion-runtime",
    tag: `skenion-runtime-v${version}`,
    "asset-name": `skenion-runtime-v${version}-x86_64-unknown-linux-gnu.tar.gz`,
  });
  const studioDesktop = artifact({
    id: "studio-desktop-linux-x64",
    kind: "studio-desktop-package",
    repository: "skenion/skenion-studio",
    tag: `skenion-studio-v${version}`,
    "asset-name": "skenion-studio-x86_64-unknown-linux-gnu.tar.gz",
  });
  const studioSidecar = artifact({
    id: "studio-runtime-linux-x64",
    kind: "studio-runtime-sidecar",
    repository: "skenion/skenion-studio",
    tag: `skenion-studio-v${version}`,
    "asset-name": "skenion-runtime-sidecar-x86_64-unknown-linux-gnu.tar.gz",
  });
  const studioWebBundle = {
    id: "studio-web-bundle",
    kind: "studio-web-bundle",
    name: `skenion-studio-web-bundle-v${version}.tar.gz`,
    version,
    source: {
      kind: "github-release-asset",
      repository: "skenion/skenion-studio",
      tag: `skenion-studio-v${version}`,
      "asset-name": `skenion-studio-web-bundle-v${version}.tar.gz`,
    },
    checksum: checksum(),
  };

  return {
    schema: "skenion.release-train",
    "schema-version": "0.1.0",
    "train-version": version,
    "train-id": trainId,
    components: {
      contracts: {
        npm: contractsNpm,
        crate: contractsCrate,
      },
      runtime: {
        binaries: {
          [target]: runtimeArtifact,
        },
      },
      sdk: {
        npm: sdkNpm,
      },
      studio: {
        "desktop-packages": {
          [target]: studioDesktop,
        },
        "runtime-sidecars": {
          [target]: studioSidecar,
        },
        "web-bundle": studioWebBundle,
      },
      docs: {
        manual: {
          version,
          path: `/manual/${trainId}/`,
          "pages-url": `https://skenion.github.io/skenion-docs/manual/${trainId}/`,
        },
      },
      examples: {
        repository: "skenion/skenion-examples",
        version,
        tag: `skenion-examples-v${version}`,
        commit: commitSha,
      },
    },
    "release-gates": {
      "examples-conformance": {
        required: true,
        status: "passed",
        repository: "skenion/skenion-examples",
        ref: `skenion-examples-v${version}`,
        version,
      },
      "docs-pages-deployment": {
        required: true,
        status: "passed",
        "manual-version": version,
        "manual-path": `/manual/${trainId}/`,
        "pages-url": `https://skenion.github.io/skenion-docs/manual/${trainId}/`,
      },
      "runtime-smoke": {
        [target]: {
          required: true,
          status: "passed",
          target,
          "artifact-id": runtimeArtifact.id,
        },
      },
      "studio-package-smoke": {
        [target]: {
          required: true,
          status: "passed",
          target,
          "desktop-package-artifact-id": studioDesktop.id,
          "runtime-sidecar-artifact-id": studioSidecar.id,
        },
      },
      "registry-packages": {
        "contracts-npm": gatePackage(contractsNpm),
        "contracts-crate": gatePackage(contractsCrate),
        "sdk-npm": gatePackage(sdkNpm),
      },
      "github-release-assets": {
        runtime: {
          required: true,
          status: "passed",
          tag: `skenion-runtime-v${version}`,
          "artifact-ids": [runtimeArtifact.id],
        },
        studio: {
          required: true,
          status: "passed",
          tag: `skenion-studio-v${version}`,
          "artifact-ids": [studioDesktop.id, studioWebBundle.id, studioSidecar.id],
        },
      },
      "checksum-verification": {
        required: true,
        status: "passed",
        "artifact-ids": [runtimeArtifact.id, studioDesktop.id, studioWebBundle.id, studioSidecar.id],
        "expected-checksums": {
          [runtimeArtifact.id]: checksum(),
          [studioDesktop.id]: checksum(),
          [studioWebBundle.id]: checksum(),
          [studioSidecar.id]: checksum(),
        },
      },
    },
  };
}

function pkg(ecosystem, name) {
  return {
    ecosystem,
    name,
    version,
  };
}

function artifact({ id, kind, repository, tag, "asset-name": assetName }) {
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
  return `https://github.com/skenion/skenion-runtime/releases/download/skenion-runtime-v${version}/skenion-runtime-v${version}-${target}.tar.gz`;
}

function checksum() {
  return {
    algorithm: "sha256",
    value: checksumValue,
  };
}

function gatePackage(packageMetadata) {
  return {
    required: true,
    status: "passed",
    package: packageMetadata,
  };
}
