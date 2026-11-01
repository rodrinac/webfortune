import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import {
  debconfDefault,
  downloadDebianPackage,
  ensureFortuneData,
  installDebianFortuneData,
  loadDebianPackages,
  readAr,
  sriSha256,
} from "../scripts/fortune-data.mjs";

function arMember(name, data) {
  const header = Buffer.alloc(60, 0x20);
  header.write(name);
  header.write(String(data.length), 48);
  header.write("`\n", 58);
  const pad = data.length % 2 ? Buffer.from("\n") : Buffer.alloc(0);
  return Buffer.concat([header, data, pad]);
}

function deb(files) {
  return Buffer.concat([
    Buffer.from("!<arch>\n"),
    ...Object.entries(files).map(([name, data]) => arMember(name, data)),
  ]);
}

function tarGz(directory) {
  const archive = join(tmpdir(), `webfortune-archive-${process.pid}.tar`);
  execFileSync("tar", ["-cf", archive, "-C", directory, "."]);
  const compressed = gzipSync(readFileSync(archive));
  rmSync(archive);
  return compressed;
}

test("reads ar members and ignores the even-byte padding", () => {
  const archive = deb({ "debian-binary": Buffer.from("2.0\n"), "data.tar.gz": Buffer.from("xyz") });
  assert.deepEqual(
    readAr(archive).map(({ name, data }) => [name, data.toString()]),
    [
      ["debian-binary", "2.0\n"],
      ["data.tar.gz", "xyz"],
    ],
  );
  assert.equal(sriSha256(Buffer.from("abc")), "sha256-ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=");
});

test("reads the fortunes-de debconf default", () => {
  const templates = [
    "Template: other/template",
    "Default: no",
    "Template: fortunes-de/fortunes_to_install",
    "Type: multiselect",
    "Default: Witze, Zitate",
    "Description: Fortunes",
    "Template: later/template",
    "Default: later",
  ].join("\n");
  assert.equal(
    debconfDefault(templates, "fortunes-de/fortunes_to_install"),
    "Witze, Zitate",
  );
});

test("installs fortune databases and enables the fortunes-de selection", () => {
  const tree = mkdtempSync(join(tmpdir(), "fortune-tree-"));
  const data = join(tree, "data");
  mkdirSync(join(data, "usr/share/games/fortunes/de"), { recursive: true });
  mkdirSync(join(data, "usr/share/games/fortunes-de"), { recursive: true });
  mkdirSync(join(data, "usr/share/cowsay/cows"), { recursive: true });
  mkdirSync(join(data, "usr/games"), { recursive: true });
  writeFileSync(join(data, "usr/share/games/fortunes/de/witze"), "Witz.\n");
  symlinkSync("witze", join(data, "usr/share/games/fortunes/de/witze.u8"));
  writeFileSync(join(data, "usr/share/games/fortunes-de/witze.dat"), "index");
  writeFileSync(join(data, "usr/share/cowsay/cows/default.cow"), "$the_cow");
  writeFileSync(join(data, "usr/games/cowsay"), "#!/bin/sh\n");
  chmodSync(join(data, "usr/games/cowsay"), 0o755);

  const control = join(tree, "control");
  mkdirSync(control);
  writeFileSync(
    join(control, "templates"),
    "Template: fortunes-de/fortunes_to_install\nDefault: Witze\n",
  );
  writeFileSync(
    join(control, "postinst"),
    `#!/bin/bash
set -e
. /usr/share/debconf/confmodule
db_version 2.0
db_get fortunes-de/fortunes_to_install
test "$RET" = "Witze"
ln -sf /usr/share/games/fortunes-de/witze.dat /usr/share/games/fortunes/de/witze.dat
`.replaceAll("$RET", "${RET}"),
  );

  const dest = mkdtempSync(join(tmpdir(), "fortune-out-"));
  const installed = installDebianFortuneData(
    [deb({ "data.tar.gz": tarGz(data), "control.tar.gz": tarGz(control) })],
    dest,
  );

  assert.equal(installed.fortuneDir, join(dest, "share/games/fortunes"));
  assert.equal(
    readlinkSync(join(installed.fortuneDir, "de/witze.dat")),
    join(dest, "share/games/fortunes-de/witze.dat"),
  );
  assert.equal(lstatSync(join(installed.fortuneDir, "de/witze.dat")).isSymbolicLink(), true);
  assert.equal(readlinkSync(join(installed.fortuneDir, "de/witze.u8")), "witze");
  assert.match(readFileSync(installed.cowsay, "utf8"), /exec perl/);
});

test("rejects a package whose hash does not match the pin", async () => {
  await assert.rejects(
    downloadDebianPackage(
      { path: "c/cowsay/cowsay.deb", hash: "sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa=" },
      async () => ({ ok: true, arrayBuffer: async () => new TextEncoder().encode("nope").buffer }),
    ),
    /Hash mismatch/,
  );
});

test("keeps fortune data that is already configured", async () => {
  const root = mkdtempSync(join(tmpdir(), "fortune-root-"));
  const result = await ensureFortuneData({
    root,
    env: {
      PATH: root,
      FORTUNE_DATA_DIR: "/already/fortunes",
      COWPATH: "/already/cows:/unused",
    },
    fetchImpl: async () => {
      throw new Error("packages should not be downloaded");
    },
  });
  assert.equal(result.fortuneDir, "/already/fortunes");
  assert.equal(result.cowDir, "/already/cows");
});

test("pins the same Debian packages the Nix shell reads", () => {
  const flake = readFileSync(new URL("../flake.nix", import.meta.url), "utf8");
  assert.match(flake, /debian-fortune-packages\.json/);
  const packages = loadDebianPackages();
  assert.equal(packages.length, 6);
  for (const pkg of packages) {
    assert.match(pkg.path, /^[a-z]\/.+\.deb$/);
    assert.match(pkg.hash, /^sha256-[A-Za-z0-9+/]+=$/);
  }
});
