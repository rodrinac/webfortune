import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deploy, ensureWorkerBuild } from "../scripts/worker-deploy.mjs";

test("uses worker-build already on PATH", () => {
  const bin = mkdtempSync(join(tmpdir(), "worker-build-"));
  writeFileSync(join(bin, "worker-build"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  chmodSync(join(bin, "worker-build"), 0o755);
  const env = ensureWorkerBuild({
    env: { HOME: join(bin, "home"), PATH: bin },
    run: () => {
      throw new Error("toolchain install should not run");
    },
  });
  assert.equal(env.PATH, bin);
});

test("installs rustup and worker-build when both are missing", () => {
  const calls = [];
  assert.throws(
    () =>
      ensureWorkerBuild({
        env: { HOME: "/tmp/webfortune-no-cargo", PATH: "" },
        run: (command) => {
          calls.push(command);
        },
      }),
    /not on PATH/,
  );
  assert.deepEqual(calls, ["bash", "cargo"]);
});

test("compiles the worker before wrangler deploy", async () => {
  const calls = [];
  const generated = [];
  await deploy({
    root: "/repo",
    wranglerArgs: ["--dry-run", "--outdir", "../build/worker-dry-run"],
    env: { PATH: "/usr/bin", HOME: "/home/tester", WRANGLER_SEND_METRICS: "false" },
    run: (command, args, options) => {
      calls.push({
        command,
        args,
        cwd: options.cwd,
        skip: options.env.WEBFORTUNE_SKIP_WORKER_BUILD,
      });
    },
    prepareFortune: async ({ env }) => ({
      env,
      fortuneDir: "/fortunes",
      cowsay: "/usr/bin/cowsay",
    }),
    prepareToolchain: ({ env }) => env,
    generateAssets: (options) => generated.push(options),
  });

  assert.deepEqual(generated, [
    {
      fortuneDir: "/fortunes",
      outDir: "/repo/build/worker-assets",
      cowsay: "/usr/bin/cowsay",
    },
  ]);
  assert.equal(calls[0].command, "worker-build");
  assert.deepEqual(calls[0].args, ["--release"]);
  assert.equal(calls[0].cwd, "/repo/worker");
  assert.equal(calls[0].skip, undefined);
  assert.equal(calls[1].command, "wrangler");
  assert.deepEqual(calls[1].args, [
    "deploy",
    "--dry-run",
    "--outdir",
    "../build/worker-dry-run",
  ]);
  assert.equal(calls[1].cwd, "/repo/worker");
  assert.equal(calls[1].skip, "1");
});
