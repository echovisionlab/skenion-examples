import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const defaultLocalContractsPackage = ".deps/skenion-contracts/packages/ts/dist/index.js";

export function resolveContractsPackage(root) {
  const releaseMode = process.env.SKENION_RELEASE_MODE === "1";
  const explicitPackage = process.env.SKENION_CONTRACTS_PACKAGE;
  const useLocalContracts = process.env.SKENION_USE_LOCAL_CONTRACTS === "1";

  if (releaseMode && explicitPackage && explicitPackage !== "@skenion/contracts") {
    throw new Error("release mode must use the released @skenion/contracts package, not a SKENION_CONTRACTS_PACKAGE override");
  }

  if (releaseMode && useLocalContracts) {
    throw new Error("release mode must use the released @skenion/contracts package, not SKENION_USE_LOCAL_CONTRACTS");
  }

  if (releaseMode && existsSync(path.join(root, defaultLocalContractsPackage))) {
    throw new Error("release mode must not consume .deps/skenion-contracts; remove the sibling checkout from the release job");
  }

  if (explicitPackage) {
    return explicitPackage;
  }

  if (useLocalContracts) {
    const localContractsPackage = path.join(root, defaultLocalContractsPackage);
    if (!existsSync(localContractsPackage)) {
      throw new Error(`SKENION_USE_LOCAL_CONTRACTS=1 requires built Contracts package at ${defaultLocalContractsPackage}`);
    }
    return defaultLocalContractsPackage;
  }

  return "@skenion/contracts";
}

export async function importContracts(root, contractsPackage) {
  if (contractsPackage.startsWith(".") || path.isAbsolute(contractsPackage)) {
    const entry = contractsPackage.endsWith(".js")
      ? contractsPackage
      : path.join(contractsPackage, "index.js");
    return import(pathToFileURL(path.resolve(root, entry)).href);
  }

  return import(contractsPackage);
}
