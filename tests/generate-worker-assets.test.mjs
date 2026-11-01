import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  generate,
  listDatabases,
  parseCowArt,
  parseCowNames,
  readFortunes,
  renderCow,
} from "../scripts/generate-worker-assets.mjs";

// Builds the strfile index the same way strfile(1) does for "%"-delimited files.
function strfile(text) {
  const bytes = Buffer.from(text);
  const offsets = [0];
  for (let index = 0; index < bytes.length; ) {
    const newline = bytes.indexOf(0x0a, index);
    const next = newline === -1 ? bytes.length : newline + 1;
    if (bytes[index] === 0x25 && bytes[index + 1] === 0x0a) offsets.push(next);
    index = next;
  }
  if (offsets.at(-1) >= bytes.length) offsets.pop();
  const dat = Buffer.alloc(24 + offsets.length * 4);
  dat.writeUInt32BE(2, 0);
  dat.writeUInt32BE(offsets.length, 4);
  dat[20] = 0x25;
  offsets.forEach((offset, index) => dat.writeUInt32BE(offset, 24 + index * 4));
  return { text: bytes, dat };
}

function writeDatabase(path, text) {
  const { text: bytes, dat } = strfile(text);
  writeFileSync(path, bytes);
  writeFileSync(`${path}.dat`, dat);
}

test("reads fortunes byte-for-byte up to the delimiter line", () => {
  const { text, dat } = strfile(
    "Moo.\n%\nTwo\n  lines ü\n%\nNo trailing delimiter\n",
  );
  assert.deepEqual(readFortunes(text, dat), [
    "Moo.\n",
    "Two\n  lines ü\n",
    "No trailing delimiter\n",
  ]);
});

test("rejects rotated databases", () => {
  const { text, dat } = strfile("Zbb.\n");
  dat.writeUInt32BE(0x4, 16);
  assert.throws(() => readFortunes(text, dat), /Rotated/);
});

test("lists only indexed regular files", () => {
  const directory = mkdtempSync(join(tmpdir(), "fortunes-"));
  writeDatabase(join(directory, "zippy"), "Yow!\n");
  writeDatabase(join(directory, "art"), "Art.\n");
  symlinkSync("art", join(directory, "art.u8"));
  writeFileSync(join(directory, "unindexed"), "Nope.\n");
  mkdirSync(join(directory, "de"));
  assert.deepEqual(listDatabases(directory), ["art", "zippy"]);
});

test("parses cow names and strips the empty speech bubble", () => {
  assert.deepEqual(
    parseCowNames("Cow files in /cows:\ntux default\n../evil apt\n"),
    ["apt", "default", "tux"],
  );
  assert.equal(parseCowArt(" __\n<  >\n --\n  \\\n   moo\n"), "  \\\n   moo");
  assert.throws(() => parseCowArt(" __\n<  >\n --\n"), /parse cow/);
});

test("renders cow templates the way cowsay interpolates them", () => {
  assert.equal(
    renderCow(`$the_cow = <<"EOC";
        $thoughts   ^__^
         $thoughts  ($eyes)\\\\_______
            (__)\\\\       )\\\\/\\\\
             $tongue ||----w |
                ||     ||
EOC
`),
    "        \\   ^__^\n         \\  (oo)\\_______\n            (__)\\       )\\/\\\n                ||----w |\n                ||     ||",
  );
  assert.equal(
    renderCow(`$extra = chop($eyes);\n$eyes .= ($extra x 2);\n$the_cow = <<EOC;\n($eyes)\nEOC\n`),
    "(ooo)",
  );
  assert.equal(
    renderCow('$the_cow = <<EOC;\nU${eyes}U\\\\.\'\\@\\@`.\nEOC\n'),
    "UooU\\.'@@`.",
  );
  assert.equal(
    renderCow("$the_cow = <<EOC;\n.==\\ /_\\\n(oo)\\_______\nEOC\n"),
    ".== /_\n(oo)_______",
  );
  assert.equal(
    renderCow("$the_cow = <<EOC;\n             @9@mmBmmmmmQM$\n             ..MMMM\nEOC\n"),
    "             0.MMMM",
  );
  assert.throws(() => renderCow("not a cow"), /parse cow/);
});

test("generates locale databases, categories and cows", () => {
  const fortuneDir = mkdtempSync(join(tmpdir(), "fortunes-"));
  const outDir = mkdtempSync(join(tmpdir(), "assets-"));
  writeDatabase(join(fortuneDir, "computers"), "Bug.\n%\nFeature.\n");
  writeDatabase(join(fortuneDir, "brasil"), "Olá.\n");
  for (const locale of ["de", "es"]) {
    mkdirSync(join(fortuneDir, locale));
    writeDatabase(join(fortuneDir, locale, "witze"), `${locale}.\n`);
  }
  const cowDir = join(fortuneDir, "cows");
  mkdirSync(cowDir);
  writeFileSync(
    join(cowDir, "default.cow"),
    "$the_cow = <<EOC;\n  \\$thoughts\n   moo\nEOC\n",
  );
  writeFileSync(
    join(cowDir, "tux.cow"),
    '$the_cow = <<"EOC";\n  ${thoughts} tux\nEOC\n',
  );

  const manifest = generate({ fortuneDir, outDir, cowDir });

  assert.deepEqual(manifest.locales, [
    {
      id: "en",
      name: "English",
      categories: ["computers"],
      databases: { computers: 2 },
    },
    {
      id: "de",
      name: "Deutsch",
      categories: ["witze"],
      databases: { witze: 1 },
    },
    {
      id: "es",
      name: "Español",
      categories: ["witze"],
      databases: { witze: 1 },
    },
    { id: "pt", name: "Português", categories: [], databases: { brasil: 1 } },
  ]);
  assert.deepEqual(manifest.cows, ["default", "tux"]);
  assert.deepEqual(
    JSON.parse(
      readFileSync(join(outDir, "fortunes", "en", "computers.json"), "utf8"),
    ),
    ["Bug.\n", "Feature.\n"],
  );
  assert.equal(readFileSync(join(outDir, "cows", "tux.txt"), "utf8"), "  \\ tux");
  assert.equal(
    readFileSync(join(outDir, "cows", "default.txt"), "utf8"),
    "  $thoughts\n   moo",
  );
  assert.deepEqual(
    JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8")),
    manifest,
  );
});
