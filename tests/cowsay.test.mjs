import test from "node:test";
import assert from "node:assert/strict";
import { cowsay, wrapFortune } from "../web/cowsay.js";

test("single and multiline bubbles have matching borders", () => {
  assert.match(cowsay("Moo."), /< Moo\. >/);
  const lines = cowsay("A little wisdom for a little cow.", 15).split("\n");
  assert.match(lines[1], /^\/ .*\\$/);
  assert.match(lines[3], /^\\ .*\/$/);
  assert.equal(lines[1].length, lines[2].length);
  assert.ok(cowsay("Moo").includes("(oo)"));
});
test("wraps long words and retains paragraph breaks", () => {
  assert.deepEqual(wrapFortune("abcdefghijkl\n\nmoo", 5), [
    "abcde",
    "fghij",
    "kl",
    "",
    "moo",
  ]);
  for (const line of wrapFortune("a 😀😀😀😀😀😀 text", 5))
    assert.ok(Array.from(line).length <= 5);
});
test("preserves accented fortune text", () => {
  const localized = "À vaca é sábia; amanhã dirá: î, ó, ü, ñ.";
  assert.ok(cowsay(localized).includes(localized));
});
test("strips terminal controls without treating content as markup", () => {
  assert.ok(cowsay("<script>alert(1)</script>\u0007").includes("<script>"));
  assert.ok(!cowsay("hi\u0007").includes("\u0007"));
});
