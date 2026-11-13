import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WORKFLOWS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".github",
  "workflows",
);

/** Full 40-char lowercase hex SHA, optionally followed by a version comment. */
const PINNED_REF =
  /^[0-9a-f]{40}(?:\s+#\s*v?\d[\w.+-]*)?$/i;

/**
 * Return unpinned `uses:` refs found in workflow YAML text.
 * Local actions (`./…`) are allowed; everything else must use a full commit SHA.
 */
export function findUnpinnedActionRefs(source, fileLabel = "<workflow>") {
  const problems = [];
  const lines = source.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const match = line.match(/^\s*(?:-\s*)?uses:\s*(.+?)\s*$/);
    if (!match) continue;

    const value = match[1].replace(/^['"]|['"]$/g, "");
    if (value.startsWith("./") || value.startsWith(".\\")) continue;

    const at = value.lastIndexOf("@");
    if (at === -1) {
      problems.push(`${fileLabel}:${i + 1}: missing @ref in uses: ${value}`);
      continue;
    }

    const ref = value.slice(at + 1).trim();
    if (!PINNED_REF.test(ref)) {
      problems.push(
        `${fileLabel}:${i + 1}: unpinned uses ref "${ref}" (want 40-char SHA with version comment)`,
      );
    }
  }

  return problems;
}

export async function checkWorkflowsDir(dir = WORKFLOWS_DIR) {
  const entries = await readdir(dir);
  const problems = [];

  for (const name of entries.sort()) {
    if (!/\.ya?ml$/i.test(name)) continue;
    const filePath = path.join(dir, name);
    const source = await readFile(filePath, "utf8");
    problems.push(...findUnpinnedActionRefs(source, name));
  }

  return problems;
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const problems = await checkWorkflowsDir();
  if (problems.length > 0) {
    console.error("Unpinned GitHub Actions detected:");
    for (const problem of problems) console.error(`  ${problem}`);
    console.error(
      "Pin each uses: owner/action@<40-char-sha> # vX.Y.Z (Dependabot keeps SHAs current).",
    );
    process.exit(1);
  }
  console.log("All workflow actions are pinned to full commit SHAs.");
}
