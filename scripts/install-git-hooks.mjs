#!/usr/bin/env node
/**
 * Point this repo at .githooks/ for local pre-push gates.
 * No-op in CI or when .git is missing (e.g. extracted archives).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

if (process.env.CI === "true" || process.env.CI === "1") {
  process.exit(0);
}

if (!existsSync(join(root, ".git"))) {
  process.exit(0);
}

const hooksPath = ".githooks";
const result = spawnSync("git", ["config", "core.hooksPath", hooksPath], {
  cwd: root,
  encoding: "utf8",
});

if (result.status !== 0) {
  console.warn(
    `install-git-hooks: could not set core.hooksPath (${result.stderr?.trim() || "git error"}); skipping.`,
  );
  process.exit(0);
}
