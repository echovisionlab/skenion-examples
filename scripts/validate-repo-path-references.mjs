import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const pathKeys = new Set([
  "copyableFragment",
  "fixture",
  "patch",
  "project",
  "projectPath",
  "promoteOperation",
  "path"
]);
const repoPathPrefixes = [
  "compatibility/",
  "extensions/",
  "fixtures/",
  "projects/",
  "scripts/",
  "tutorials/"
];
const skippedDirectories = new Set([
  ".deps",
  ".git",
  "node_modules"
]);

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(fullPath));
    } else if (entry.name.endsWith(".json")) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

function isRepoPathCandidate(value) {
  return repoPathPrefixes.some((prefix) => value.startsWith(prefix));
}

function validatePathReference(file, keyPath, value, failures) {
  if (!isRepoPathCandidate(value)) {
    return;
  }

  const resolved = path.resolve(root, value);
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    failures.push(`${file} ${keyPath}: path escapes repository: ${value}`);
    return;
  }

  if (!existsSync(resolved)) {
    failures.push(`${file} ${keyPath}: missing repo path ${value}`);
  }
}

function inspectValue(file, value, keyPath, failures) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectValue(file, item, `${keyPath}[${index}]`, failures));
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const childKeyPath = keyPath ? `${keyPath}.${key}` : key;
    if (pathKeys.has(key) && typeof child === "string") {
      validatePathReference(file, childKeyPath, child, failures);
    }
    inspectValue(file, child, childKeyPath, failures);
  }
}

const files = await walk(root);
const failures = [];
for (const file of files) {
  inspectValue(file, await readJson(file), "", failures);
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}

console.log(`validated repo-relative JSON path references in ${files.length} files`);
