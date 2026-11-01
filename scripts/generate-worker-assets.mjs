import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const LOCALES = [
  { id: "en", name: "English", database: null },
  { id: "de", name: "Deutsch", database: "de" },
  { id: "es", name: "Español", database: "es" },
  { id: "pt", name: "Português", database: "brasil" },
];

const STRFILE_HEADER_LENGTH = 24;
const STR_ROTATED = 0x4;
const RESOURCE_NAME = /^[A-Za-z0-9._-]+$/;

export function parseStrfileIndex(dat) {
  const count = dat.readUInt32BE(4);
  const flags = dat.readUInt32BE(16);
  const delimiter = dat[20];
  // Debian ships no rotated databases outside the offensive set we never install.
  if (flags & STR_ROTATED)
    throw new Error("Rotated fortune databases are not supported");
  const offsets = Array.from({ length: count }, (_, index) =>
    dat.readUInt32BE(STRFILE_HEADER_LENGTH + index * 4),
  );
  return { count, delimiter, offsets };
}

// Mirrors fortune-mod's display loop: print lines from the indexed offset
// until a line consisting of just the delimiter, so output stays byte-identical.
export function readFortunes(text, dat) {
  const { delimiter, offsets } = parseStrfileIndex(dat);
  return offsets.map((offset) => {
    let end = offset;
    while (end < text.length) {
      const newline = text.indexOf(0x0a, end);
      const lineEnd = newline === -1 ? text.length : newline + 1;
      if (text[end] === delimiter && text[end + 1] === 0x0a) break;
      end = lineEnd;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(
      text.subarray(offset, end),
    );
  });
}

// Same set `fortune -f <dir>` reports: indexed regular files, no directories.
export function listDatabases(directory) {
  return readdirSync(directory)
    .filter(
      (name) =>
        !name.endsWith(".dat") &&
        statSync(join(directory, name)).isFile() &&
        existsSync(join(directory, `${name}.dat`)),
    )
    .sort();
}

export function parseCowNames(output) {
  return output
    .split("\n")
    .filter((line) => !line.startsWith("Cow files in "))
    .flatMap((line) => line.split(/\s+/))
    .filter((name) => RESOURCE_NAME.test(name))
    .sort();
}

export function parseCowArt(output) {
  const art = output.replace(/\n$/, "").split("\n").slice(3).join("\n");
  if (!art) throw new Error("Failed to parse cow");
  return art;
}

// cowsay `do`s the .cow file. Asset generation only keeps the figure, so it
// does not need Perl or the Text::CharWidth module the speech bubble uses.
export function renderCow(source) {
  const marker = source.match(
    /<<(?:"([A-Za-z0-9_]+)"|'([A-Za-z0-9_]+)'|([A-Za-z0-9_]+));?\n/,
  );
  const terminator = marker?.[1] ?? marker?.[2] ?? marker?.[3];
  if (!terminator) throw new Error("Failed to parse cow");
  const start = marker.index + marker[0].length;
  const end = source.indexOf(`\n${terminator}`, start);
  if (end === -1) throw new Error("Failed to parse cow");
  const body = source.slice(start, end);
  // A single-quoted heredoc is literal.
  if (marker[2]) return body;

  let eyes = "oo";
  // three-eyes.cow: chop one eye character, then repeat that character twice.
  if (source.includes("$extra = chop($eyes);")) {
    const extra = eyes.slice(-1);
    eyes = `${eyes.slice(0, -1)}${extra.repeat(2)}`;
  }
  return interpolateCow(body, { eyes, tongue: "  ", thoughts: "\\" });
}

function interpolateCow(body, vars) {
  let art = "";
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (character === "\\" && index + 1 < body.length) {
      art += body[index + 1];
      index += 1;
      continue;
    }
    if (character === "@") {
      const arrayName = /^[A-Za-z_][A-Za-z0-9_]*|^[0-9]+/.exec(body.slice(index + 1));
      if (arrayName) {
        index += arrayName[0].length;
        continue;
      }
    }
    if (character === "$") {
      let cursor = index + 1;
      while (cursor < body.length && /[ \t\n\r\f]/.test(body[cursor])) cursor += 1;
      const braced = /^\{([A-Za-z_][A-Za-z0-9_]*)\}/.exec(body.slice(cursor));
      const plain = /^[A-Za-z_][A-Za-z0-9_]*/.exec(body.slice(cursor));
      if (braced || plain) {
        const name = braced?.[1] ?? plain[0];
        art += vars[name] ?? "";
        index = cursor + (braced ?? plain)[0].length - 1;
        continue;
      }
      // cowsay reads the empty message before loading the cow, so $. is 0.
      // calvin.cow interpolates it across the newline.
      if (body[cursor] === ".") {
        art += "0";
        index = cursor;
        continue;
      }
    }
    art += character;
  }
  return art;
}

function readDatabase(path) {
  return readFortunes(readFileSync(path), readFileSync(`${path}.dat`));
}

function localeDatabases(fortuneDir, locale) {
  if (locale.database === null) {
    const localized = new Set(LOCALES.map(({ database }) => database));
    return listDatabases(fortuneDir)
      .filter((name) => !localized.has(name))
      .map((name) => ({ name, path: join(fortuneDir, name), category: true }));
  }
  const path = join(fortuneDir, locale.database);
  if (statSync(path).isDirectory()) {
    return listDatabases(path).map((name) => ({
      name,
      path: join(path, name),
      category: true,
    }));
  }
  // A single-file locale database has no categories, matching `fortune -f`.
  return [{ name: locale.database, path, category: false }];
}

export function generate({ fortuneDir, outDir, cowDir }) {
  rmSync(outDir, { recursive: true, force: true });
  const manifest = { locales: [], cows: [] };

  for (const locale of LOCALES) {
    const databases = {};
    const categories = [];
    for (const { name, path, category } of localeDatabases(
      fortuneDir,
      locale,
    )) {
      const fortunes = readDatabase(path);
      if (fortunes.length === 0) continue;
      databases[name] = fortunes.length;
      if (category) categories.push(name);
      mkdirSync(join(outDir, "fortunes", locale.id), { recursive: true });
      writeFileSync(
        join(outDir, "fortunes", locale.id, `${name}.json`),
        JSON.stringify(fortunes),
      );
    }
    if (Object.keys(databases).length === 0)
      throw new Error(`No fortunes for locale ${locale.id}`);
    manifest.locales.push({
      id: locale.id,
      name: locale.name,
      categories,
      databases,
    });
  }

  if (!cowDir) throw new Error("cowDir is required");
  mkdirSync(join(outDir, "cows"), { recursive: true });
  const names = readdirSync(cowDir)
    .filter((name) => name.endsWith(".cow"))
    .map((name) => name.slice(0, -4))
    .filter((name) => RESOURCE_NAME.test(name))
    .sort();
  for (const name of names) {
    writeFileSync(
      join(outDir, "cows", `${name}.txt`),
      renderCow(readFileSync(join(cowDir, `${name}.cow`), "utf8")),
    );
    manifest.cows.push(name);
  }
  if (!manifest.cows.includes("default"))
    throw new Error("The default cow is missing");

  writeFileSync(
    join(outDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const fortuneDir = process.env.FORTUNE_DATA_DIR;
  const cowDir = process.env.COWPATH?.split(delimiter)[0];
  if (!fortuneDir || !cowDir) {
    console.error(
      "FORTUNE_DATA_DIR and COWPATH are required. Run inside `nix develop`.",
    );
    process.exit(1);
  }
  const outDir = resolve(process.argv[2] || "build/worker-assets");
  const manifest = generate({ fortuneDir, outDir, cowDir });
  const total = manifest.locales.map(
    ({ id, databases }) =>
      `${id}=${Object.values(databases).reduce((sum, count) => sum + count, 0)}`,
  );
  console.log(
    `Wrote ${outDir}: fortunes ${total.join(" ")}, ${manifest.cows.length} cows`,
  );
}
