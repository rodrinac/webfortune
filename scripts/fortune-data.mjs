import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  accessSync,
  constants,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { gunzipSync } from "node:zlib";

const PACKAGES_URL = new URL("./debian-fortune-packages.json", import.meta.url);
const MIRRORS = [
  "https://deb.debian.org/debian/pool/main/",
  "https://snapshot.debian.org/archive/debian/20251001T000000Z/pool/main/",
];

export function loadDebianPackages() {
  return JSON.parse(readFileSync(PACKAGES_URL, "utf8"));
}

export function sriSha256(bytes) {
  return `sha256-${createHash("sha256").update(bytes).digest("base64")}`;
}

export function resolveCommand(name, env = process.env) {
  if (name.includes("/") && isExecutable(name)) return name;
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

function isExecutable(path) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// Debian packages are `ar` archives. Members we need use short names.
export function readAr(buffer) {
  if (buffer.toString("utf8", 0, 8) !== "!<arch>\n")
    throw new Error("Not a Debian ar archive");
  const entries = [];
  let offset = 8;
  while (offset + 60 <= buffer.length) {
    const header = buffer.toString("latin1", offset, offset + 60);
    const name = header.slice(0, 16).trim();
    const size = Number(header.slice(48, 58).trim());
    if (!Number.isInteger(size) || size < 0)
      throw new Error(`Bad ar member size for ${name || "(unnamed)"}`);
    const start = offset + 60;
    entries.push({ name, data: buffer.subarray(start, start + size) });
    offset = start + size + (size % 2);
  }
  return entries;
}

export function debconfDefault(templates, templateName) {
  const lines = templates.split("\n");
  let found = false;
  for (const line of lines) {
    if (line === `Template: ${templateName}`) found = true;
    else if (found && line.startsWith("Default: "))
      return line.slice("Default: ".length);
    else if (found && line.startsWith("Template: ")) break;
  }
  throw new Error(`No debconf default for ${templateName}`);
}

function member(entries, prefix) {
  return entries.find((entry) => entry.name.startsWith(prefix));
}

function decompress(name, bytes) {
  if (name.endsWith(".gz")) return gunzipSync(bytes);
  if (name.endsWith(".xz")) return xzDecompress(bytes);
  if (name.endsWith(".tar")) return bytes;
  throw new Error(`Unsupported Debian archive ${name}`);
}

function xzDecompress(bytes) {
  const dir = mkdtempSync(join(tmpdir(), "webfortune-xz-"));
  const input = join(dir, "archive.xz");
  const output = join(dir, "archive.tar");
  writeFileSync(input, bytes);
  try {
    if (resolveCommand("python3")) {
      execFileSync(
        "python3",
        [
          "-c",
          "import lzma, pathlib, sys; pathlib.Path(sys.argv[2]).write_bytes(lzma.decompress(pathlib.Path(sys.argv[1]).read_bytes()))",
          input,
          output,
        ],
        { stdio: "inherit" },
      );
    } else if (resolveCommand("xz")) {
      const tar = execFileSync("xz", ["-dc", input]);
      writeFileSync(output, tar);
    } else {
      throw new Error(
        "Unpacking Debian packages needs python3 or xz, and neither is installed.",
      );
    }
    return readFileSync(output);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function extractTar(bytes, dest) {
  const dir = mkdtempSync(join(tmpdir(), "webfortune-tar-"));
  const archive = join(dir, "archive.tar");
  writeFileSync(archive, bytes);
  try {
    mkdirSync(dest, { recursive: true });
    execFileSync("tar", ["-xf", archive, "-C", dest], { stdio: "inherit" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function readExtracted(dir, filename) {
  const candidates = [join(dir, filename), join(dir, filename.replace(/^\.\//, ""))];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return readFileSync(candidate, "utf8");
  }
  return null;
}

export function installDebianFortuneData(debs, dest) {
  rmSync(dest, { recursive: true, force: true });
  const root = join(dest, "root");
  mkdirSync(root, { recursive: true });
  let postinst = null;
  let templates = null;
  for (const deb of debs) {
    const entries = readAr(deb);
    const data = member(entries, "data.tar");
    if (!data) throw new Error("Debian package is missing data.tar");
    extractTar(decompress(data.name, data.data), root);
    const controlDir = mkdtempSync(join(tmpdir(), "webfortune-control-"));
    try {
      const control = member(entries, "control.tar");
      if (!control) continue;
      extractTar(decompress(control.name, control.data), controlDir);
      const nextPostinst = readExtracted(controlDir, "postinst");
      const nextTemplates = readExtracted(controlDir, "templates");
      if (nextPostinst && nextTemplates) {
        postinst = nextPostinst;
        templates = nextTemplates;
      }
    } finally {
      rmSync(controlDir, { recursive: true, force: true });
    }
  }
  if (!postinst || !templates)
    throw new Error("fortunes-de postinst did not arrive with the Debian packages");

  mkdirSync(join(dest, "share"), { recursive: true });
  mkdirSync(join(dest, "libexec"), { recursive: true });
  const copy = { recursive: true, verbatimSymlinks: true };
  cpSync(join(root, "usr/share/games"), join(dest, "share/games"), copy);
  cpSync(join(root, "usr/share/cowsay"), join(dest, "share/cowsay"), copy);
  cpSync(join(root, "usr/games/cowsay"), join(dest, "libexec/cowsay"), copy);

  const defaultFortunes = debconfDefault(
    templates,
    "fortunes-de/fortunes_to_install",
  );
  const quoted = execFileSync("bash", ["-c", 'printf %q "$1"', "bash", defaultFortunes], {
    encoding: "utf8",
  });
  const confmodule = join(dest, "confmodule");
  writeFileSync(
    confmodule,
    `db_version() { :; }\ndb_get() { RET=${quoted}; }\n`,
  );
  const script = postinst
    .replaceAll("/usr/share/debconf/confmodule", confmodule)
    .replaceAll("/usr/share/games/", `${dest}/share/games/`);
  const postinstPath = join(dest, "postinst");
  writeFileSync(postinstPath, script, { mode: 0o755 });
  execFileSync("bash", [postinstPath, "configure"], { stdio: "inherit" });

  const bin = join(dest, "bin");
  mkdirSync(bin, { recursive: true });
  const cowsay = join(bin, "cowsay");
  writeFileSync(
    cowsay,
    `#!/bin/sh\nexport COWPATH="\${COWPATH:-${dest}/share/cowsay/cows}"\nexec perl ${dest}/libexec/cowsay "$@"\n`,
    { mode: 0o755 },
  );
  rmSync(root, { recursive: true, force: true });
  return {
    fortuneDir: join(dest, "share/games/fortunes"),
    cowsay,
    cowpath: join(dest, "share/cowsay/cows"),
  };
}

export async function downloadDebianPackage(pkg, fetchImpl = fetch) {
  let lastError;
  for (const mirror of MIRRORS) {
    const url = mirror + pkg.path;
    try {
      const response = await fetchImpl(url);
      if (!response.ok) throw new Error(`${response.status} for ${url}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const actual = sriSha256(bytes);
      if (actual !== pkg.hash)
        throw new Error(`Hash mismatch for ${pkg.path}: ${actual}`);
      return bytes;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export function aptInstall(packages, run = execFileSync) {
  if (!resolveCommand("apt-get")) {
    throw new Error(
      `Install ${packages.join(" ")} and retry. apt-get is not available.`,
    );
  }
  const root = typeof process.getuid === "function" && process.getuid() === 0;
  const env = { ...process.env, DEBIAN_FRONTEND: "noninteractive" };
  const apt = root
    ? (args) => run("apt-get", args, { env, stdio: "inherit" })
    : (args) =>
        run("sudo", ["-E", "apt-get", ...args], { env, stdio: "inherit" });
  apt(["update"]);
  apt(["install", "-y", ...packages]);
}

export async function ensureFortuneData({
  root,
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  if (env.FORTUNE_DATA_DIR && env.COWPATH) {
    return {
      env,
      fortuneDir: env.FORTUNE_DATA_DIR,
      cowDir: env.COWPATH.split(delimiter)[0],
    };
  }
  const packages = loadDebianPackages();
  const dest = join(root, "build/fortune-data");
  const stamp = sriSha256(Buffer.from(JSON.stringify(packages)));
  const stampPath = join(dest, ".packages-stamp");
  let installed;
  if (existsSync(stampPath) && readFileSync(stampPath, "utf8") === stamp) {
    installed = {
      fortuneDir: join(dest, "share/games/fortunes"),
      cowsay: join(dest, "bin/cowsay"),
      cowpath: join(dest, "share/cowsay/cows"),
    };
  } else {
    const debs = [];
    for (const pkg of packages) debs.push(await downloadDebianPackage(pkg, fetchImpl));
    installed = installDebianFortuneData(debs, dest);
    writeFileSync(stampPath, stamp);
  }
  return {
    env: {
      ...env,
      FORTUNE_DATA_DIR: installed.fortuneDir,
      COWPATH: installed.cowpath,
      PATH: `${join(dest, "bin")}${delimiter}${env.PATH ?? ""}`,
    },
    fortuneDir: installed.fortuneDir,
    cowDir: installed.cowpath,
  };
}
