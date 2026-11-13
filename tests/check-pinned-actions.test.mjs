import test from "node:test";
import assert from "node:assert/strict";
import {
  checkWorkflowsDir,
  findUnpinnedActionRefs,
} from "../scripts/check-pinned-actions.mjs";

test("accepts full SHA pins with version comments", () => {
  const yaml = `
jobs:
  build:
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
`;
  assert.deepEqual(findUnpinnedActionRefs(yaml), []);
});

test("rejects mutable tags and branches", () => {
  const yaml = `
jobs:
  build:
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@main
`;
  const problems = findUnpinnedActionRefs(yaml, "ci.yml");
  assert.equal(problems.length, 2);
  assert.match(problems[0], /unpinned uses ref "v7"/);
  assert.match(problems[1], /unpinned uses ref "main"/);
});

test("allows local composite actions", () => {
  const yaml = `
jobs:
  build:
    steps:
      - uses: ./.github/actions/setup
`;
  assert.deepEqual(findUnpinnedActionRefs(yaml), []);
});

test("repo workflows are all SHA-pinned", async () => {
  const problems = await checkWorkflowsDir();
  assert.deepEqual(problems, []);
});
