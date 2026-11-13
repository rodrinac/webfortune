import { pathToFileURL } from "node:url";

// Optional helper before a manual production smoke (`npm run smoke`). The previous
// Worker also returns {"status":"ok"}, so a live health check is not proof
// that this release is serving. /health includes the crate version, which is
// the tag without the leading v.
export const DEFAULT_ATTEMPTS = 30;
export const DEFAULT_INTERVAL_MS = 10_000;

export function releaseHealth(body, version) {
  let health;
  try {
    health = JSON.parse(body);
  } catch {
    return false;
  }
  return (
    health !== null &&
    typeof health === "object" &&
    !Array.isArray(health) &&
    health.status === "ok" &&
    health.version === version
  );
}

function oneLine(text) {
  return text.replace(/\s+/g, " ").trim().slice(0, 200) || "empty";
}

export async function waitForRelease({
  apiUrl,
  version,
  attempts = DEFAULT_ATTEMPTS,
  intervalMs = DEFAULT_INTERVAL_MS,
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = (message) => {
    console.error(message);
  },
  write = (body) => {
    process.stdout.write(body);
  },
} = {}) {
  if (typeof apiUrl !== "string" || apiUrl.length === 0) {
    throw new Error("API_URL is required.");
  }
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(
      `EXPECTED_VERSION must be the release tag without the leading v (x.y.z), got ${JSON.stringify(version)}.`,
    );
  }
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 120) {
    throw new Error(`attempts must be an integer from 1 to 120, got ${attempts}.`);
  }
  if (!Number.isInteger(intervalMs) || intervalMs < 0 || intervalMs > 60_000) {
    throw new Error(
      `intervalMs must be an integer from 0 to 60000, got ${intervalMs}.`,
    );
  }

  const healthUrl = `${apiUrl.replace(/\/$/, "")}/health`;
  const gap = intervalMs % 1000 === 0 ? `${intervalMs / 1000}s` : `${intervalMs}ms`;
  let last = "";

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let detail = "";
    try {
      const response = await fetchImpl(healthUrl, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(20_000),
      });
      const body = await response.text();
      last = body;
      if (response.ok && releaseHealth(body, version)) {
        write(body.endsWith("\n") ? body : `${body}\n`);
        return;
      }
      detail = body;
    } catch (error) {
      detail = error instanceof Error ? error.message : String(error);
      last = detail;
    }
    log(
      `Attempt ${attempt}/${attempts}: ${healthUrl} is not version ${version} yet (${oneLine(detail)})`,
    );
    if (attempt < attempts) await sleep(intervalMs);
  }

  throw new Error(
    [
      `Timed out after ${attempts} attempts, ${gap} apart, waiting for ${healthUrl} to report version ${version}.`,
      'The previous Worker also returns {"status":"ok"}. Workers Builds deploys this release separately, so the smoke test was not run.',
      `Last response: ${oneLine(last)}`,
    ].join("\n"),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  waitForRelease({
    apiUrl: process.env.API_URL,
    version: process.env.EXPECTED_VERSION,
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
