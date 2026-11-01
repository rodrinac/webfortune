import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  aptInstall,
  ensureFortuneData,
  resolveCommand,
} from "./fortune-data.mjs";
import { generate } from "./generate-worker-assets.mjs";

// Matches the `worker` crate in worker/Cargo.toml. Workers Builds runs this
// script as its only command and does not run wrangler's custom build.
export const WORKER_BUILD_VERSION = "0.8.7";

export function repoRoot() {
  return fileURLToPath(new URL("..", import.meta.url));
}

function opensslReady() {
  if (!resolveCommand("pkg-config")) return false;
  try {
    execFileSync("pkg-config", ["--exists", "openssl"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function wasmTargetReady(env) {
  const rustc = resolveCommand("rustc", env);
  if (!rustc) return false;
  try {
    execFileSync(
      rustc,
      ["--print", "target-libdir", "--target", "wasm32-unknown-unknown"],
      { env, stdio: "ignore" },
    );
    return true;
  } catch {
    return false;
  }
}

export function ensureWorkerBuild({ env, run = execFileSync }) {
  const cargoBin = env.HOME ? join(env.HOME, ".cargo/bin") : null;
  let next = { ...env };
  if (resolveCommand("worker-build", next)) return next;
  if (cargoBin && existsSync(join(cargoBin, "worker-build")))
    next = { ...next, PATH: `${cargoBin}${delimiter}${next.PATH ?? ""}` };
  if (resolveCommand("worker-build", next)) return next;
  if (!env.HOME)
    throw new Error("HOME is required to install the Rust wasm toolchain.");
  if (!resolveCommand("cargo", next)) {
    run(
      "bash",
      [
        "-c",
        "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --target wasm32-unknown-unknown",
      ],
      { env: next, stdio: "inherit" },
    );
    next = { ...next, PATH: `${cargoBin}${delimiter}${next.PATH ?? ""}` };
  } else if (!wasmTargetReady(next)) {
    if (!resolveCommand("rustup", next)) {
      throw new Error(
        "rustc is missing the wasm32-unknown-unknown target and rustup is not installed.",
      );
    }
    run("rustup", ["target", "add", "wasm32-unknown-unknown"], {
      env: next,
      stdio: "inherit",
    });
  }
  if (!resolveCommand("worker-build", next)) {
    if (!opensslReady() && resolveCommand("apt-get", next))
      aptInstall(["pkg-config", "libssl-dev"], run);
    run(
      "cargo",
      ["install", "worker-build", "--version", WORKER_BUILD_VERSION, "--locked"],
      { env: next, stdio: "inherit" },
    );
    next = { ...next, PATH: `${cargoBin}${delimiter}${next.PATH ?? ""}` };
  }
  if (!resolveCommand("worker-build", next)) {
    throw new Error(
      `worker-build ${WORKER_BUILD_VERSION} is not on PATH after installation.`,
    );
  }
  return next;
}

export async function deploy({
  wranglerArgs = [],
  env = process.env,
  run = execFileSync,
  prepareFortune = ensureFortuneData,
  prepareToolchain = ensureWorkerBuild,
  generateAssets = generate,
  root = repoRoot(),
} = {}) {
  let next = {
    ...env,
    PATH: `${join(root, "node_modules/.bin")}${delimiter}${env.PATH ?? ""}`,
    WRANGLER_SEND_METRICS: env.WRANGLER_SEND_METRICS ?? "false",
  };
  const fortune = await prepareFortune({ root, env: next });
  next = fortune.env;
  generateAssets({
    fortuneDir: fortune.fortuneDir,
    outDir: join(root, "build/worker-assets"),
    cowDir: fortune.cowDir,
  });
  next = prepareToolchain({ env: next, run });
  run("worker-build", ["--release"], {
    cwd: join(root, "worker"),
    env: next,
    stdio: "inherit",
  });
  run("wrangler", ["deploy", ...wranglerArgs], {
    cwd: join(root, "worker"),
    env: { ...next, WEBFORTUNE_SKIP_WORKER_BUILD: "1" },
    stdio: "inherit",
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  deploy({ wranglerArgs: process.argv.slice(2) }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
