import test from "node:test";
import assert from "node:assert/strict";
import { classifyBump, isAutomatedReleaseCommit } from "../scripts/version-bump.mjs";

test("recognizes the automated release commit", () => {
  assert.equal(isAutomatedReleaseCommit("chore(release): v1.4.3"), true);
  assert.equal(isAutomatedReleaseCommit("chore(release): bump version to v1.4.3 [skip version-bump]"), true);
  assert.equal(isAutomatedReleaseCommit("chore(release): verify the deploy"), false);
});

test("does not bump again for the release commit", () => {
  assert.equal(classifyBump(["chore(release): v1.4.3"]), null);
  assert.equal(classifyBump(["feat: add a cow", "chore(release): v1.4.3"]), "minor");
  assert.equal(classifyBump(["chore: tidy"]), "patch");
});
