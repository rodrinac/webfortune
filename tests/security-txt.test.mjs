import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { preview } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const ADVISORY_URL =
  "https://github.com/rodrinac/webfortune/security/advisories/new";
const POLICY_URL =
  "https://github.com/rodrinac/webfortune/blob/main/SECURITY.md";
const CANONICAL_URL = "https://webfortune.app/.well-known/security.txt";
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const RFC3339_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function parseAndValidateSecurityTxt(text, { now = Date.now() } = {}) {
  assert.equal(typeof text, "string", "security.txt must be a string");
  assert.ok(text.endsWith("\n"), "security.txt must end with a newline");

  const fields = new Map();
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === "" || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z][A-Za-z0-9-]*):[ \t]+(\S.*)$/);
    assert.ok(match, `Invalid RFC 9116 line ${index + 1}: ${line}`);
    const [, rawName, rawValue] = match;
    const name = rawName.toLowerCase();
    const value = rawValue.trim();
    const list = fields.get(name) ?? [];
    list.push(value);
    fields.set(name, list);
  }

  const contacts = fields.get("contact") ?? [];
  assert.ok(contacts.length > 0, "security.txt is missing required Contact");
  for (const contact of contacts) {
    assert.match(
      contact,
      /^(https:\/\/|mailto:|tel:)/,
      `Contact must use https://, mailto:, or tel: (${contact})`,
    );
  }

  const expiresList = fields.get("expires") ?? [];
  assert.equal(
    expiresList.length,
    1,
    "security.txt must contain exactly one Expires field",
  );
  const expiresRaw = expiresList[0];
  assert.match(
    expiresRaw,
    RFC3339_RE,
    `Expires must be an RFC 3339 timestamp (${expiresRaw})`,
  );
  const expiresMs = Date.parse(expiresRaw);
  assert.ok(!Number.isNaN(expiresMs), `Unparseable Expires date: ${expiresRaw}`);
  assert.ok(
    expiresMs > now,
    `security.txt Expires date (${expiresRaw}) is in the past`,
  );
  assert.ok(
    expiresMs - now <= ONE_YEAR_MS,
    `security.txt Expires date (${expiresRaw}) is more than one year ahead`,
  );

  for (const uriField of ["policy", "canonical", "acknowledgments", "encryption", "hiring", "csaf"]) {
    for (const value of fields.get(uriField) ?? []) {
      const parsed = new URL(value);
      assert.equal(
        parsed.protocol,
        "https:",
        `${uriField} must use https:// (${value})`,
      );
    }
  }

  const languages = fields.get("preferred-languages") ?? [];
  assert.ok(
    languages.length <= 1,
    "Preferred-Languages must not appear more than once",
  );
  if (languages.length === 1) {
    for (const tag of languages[0].split(",").map((part) => part.trim())) {
      assert.match(
        tag,
        /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/,
        `Invalid language tag in Preferred-Languages: ${tag}`,
      );
    }
  }

  return fields;
}

function validateBuiltSecurityTxt(outDir, options) {
  const builtPath = join(outDir, ".well-known/security.txt");
  assert.ok(
    existsSync(builtPath),
    `Missing ${builtPath} from production build output`,
  );
  const content = readFileSync(builtPath, "utf8");
  return {
    content,
    fields: parseAndValidateSecurityTxt(content, options),
  };
}

test("RFC 9116 validator fails when security.txt is missing or Expires is in the past", () => {
  const emptyDir = mkdtempSync(join(tmpdir(), "webfortune-security-empty-"));
  try {
    assert.throws(
      () => validateBuiltSecurityTxt(emptyDir),
      /Missing .*\.well-known\/security\.txt/,
    );

    const wellKnownDir = join(emptyDir, ".well-known");
    mkdirSync(wellKnownDir, { recursive: true });
    writeFileSync(
      join(wellKnownDir, "security.txt"),
      [
        `Contact: ${ADVISORY_URL}`,
        "Expires: 2020-01-01T00:00:00.000Z",
        "",
      ].join("\n"),
    );

    assert.throws(
      () =>
        validateBuiltSecurityTxt(emptyDir, {
          now: Date.parse("2026-11-27T00:00:00.000Z"),
        }),
      /Expires date .* is in the past/,
    );

    assert.throws(
      () =>
        parseAndValidateSecurityTxt(
          [
            `Contact: ${ADVISORY_URL}`,
            "Expires: 2029-01-01T00:00:00.000Z",
            "",
          ].join("\n"),
          { now: Date.parse("2026-11-27T00:00:00.000Z") },
        ),
      /more than one year ahead/,
    );
  } finally {
    rmSync(emptyDir, { recursive: true, force: true });
  }
});

test("SECURITY.md documents scope, supported version, private reporting, and expectations", () => {
  const securityMd = readFileSync(join(root, "SECURITY.md"), "utf8");
  assert.match(securityMd, /api\.webfortune\.app/);
  assert.match(securityMd, /webfortune\.app/);
  assert.match(securityMd, /\.github\/workflows\//);
  assert.match(securityMd, /vX\.Y\.Z/);
  assert.ok(
    securityMd.includes(ADVISORY_URL),
    "SECURITY.md must link to GitHub private vulnerability reporting",
  );
  assert.match(securityMd, /Report a vulnerability/);
  assert.match(securityMd, /72 hours/i);
  assert.match(securityMd, /do \*\*not\*\* open a public GitHub issue/i);
});

test("the production build ships /.well-known/security.txt and serves it as 200 text/plain", async () => {
  const outDir = join(root, "build/security-txt-dist");
  execFileSync(
    "npx",
    [
      "vite",
      "build",
      "--outDir",
      join("..", "build/security-txt-dist"),
      "--emptyOutDir",
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        VITE_API_URL: "https://api.webfortune.app",
      },
      stdio: "pipe",
    },
  );

  const source = readFileSync(
    join(root, "web/public/.well-known/security.txt"),
    "utf8",
  );
  const { content, fields } = validateBuiltSecurityTxt(outDir);
  assert.equal(content, source);
  assert.deepEqual(fields.get("contact"), [ADVISORY_URL]);
  assert.deepEqual(fields.get("policy"), [POLICY_URL]);
  assert.deepEqual(fields.get("canonical"), [CANONICAL_URL]);
  assert.deepEqual(fields.get("preferred-languages"), ["en"]);

  const server = await preview({
    logLevel: "silent",
    build: { outDir },
    preview: { host: "127.0.0.1", port: 0, strictPort: false },
  });
  try {
    const address = server.httpServer.address();
    const response = await fetch(
      `http://127.0.0.1:${address.port}/.well-known/security.txt`,
    );
    assert.equal(response.status, 200);
    assert.match(
      response.headers.get("content-type") ?? "",
      /^text\/plain\b/i,
    );
    const body = await response.text();
    assert.equal(body, source);
    parseAndValidateSecurityTxt(body);
  } finally {
    await new Promise((resolve) => server.httpServer.close(resolve));
  }
});
