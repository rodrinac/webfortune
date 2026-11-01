import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import {
  DEFAULT_ATTEMPTS,
  DEFAULT_INTERVAL_MS,
  releaseHealth,
  waitForRelease,
} from "../scripts/wait-for-release.mjs";

test("production wait is 30 attempts, 10s apart", () => {
  assert.equal(DEFAULT_ATTEMPTS, 30);
  assert.equal(DEFAULT_INTERVAL_MS, 10_000);
});

test("status ok from the previous Worker is not this release", () => {
  assert.equal(releaseHealth('{"status":"ok"}\n', "1.5.0"), false);
  assert.equal(
    releaseHealth('{"status":"ok","version":"1.4.4"}\n', "1.5.0"),
    false,
  );
  assert.equal(
    releaseHealth('{"status":"degraded","version":"1.5.0"}\n', "1.5.0"),
    false,
  );
  assert.equal(releaseHealth("not json", "1.5.0"), false);
  assert.equal(
    releaseHealth('{"status":"ok","version":"1.5.0"}\n', "1.5.0"),
    true,
  );
});

test("waits between attempts and stops when the version matches", async () => {
  const bodies = [
    '{"status":"ok"}\n',
    '{"status":"ok","version":"1.4.4"}\n',
    '{"status":"ok","version":"1.5.0"}\n',
  ];
  const sleeps = [];
  const written = [];
  let calls = 0;
  await waitForRelease({
    apiUrl: "https://api.webfortune.app/",
    version: "1.5.0",
    attempts: 30,
    intervalMs: 10_000,
    fetchImpl: async (url) => {
      assert.equal(url, "https://api.webfortune.app/health");
      calls += 1;
      return new Response(bodies[calls - 1], { status: 200 });
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    log: () => {},
    write: (body) => {
      written.push(body);
    },
  });
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [10_000, 10_000]);
  assert.deepEqual(written, ['{"status":"ok","version":"1.5.0"}\n']);
});

test("retries when /health is down and does not sleep after the last failure", async () => {
  const sleeps = [];
  const logs = [];
  let calls = 0;
  await assert.rejects(
    () =>
      waitForRelease({
        apiUrl: "https://api.webfortune.app",
        version: "1.5.0",
        attempts: 3,
        intervalMs: 10,
        fetchImpl: async () => {
          calls += 1;
          if (calls === 1) throw new Error("connect ECONNREFUSED");
          return new Response("Fortune service unavailable.\n", { status: 503 });
        },
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        log: (message) => {
          logs.push(message);
        },
      }),
    (error) => {
      assert.match(error.message, /version 1\.5\.0/);
      assert.match(error.message, /3 attempts, 10ms apart/);
      assert.match(error.message, /smoke test was not run/);
      assert.match(error.message, /Fortune service unavailable/);
      return true;
    },
  );
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [10, 10]);
  assert.equal(logs.length, 3);
  assert.match(logs[0], /ECONNREFUSED/);
});

test("rejects a tag that still has the leading v before polling", async () => {
  await assert.rejects(
    () =>
      waitForRelease({
        apiUrl: "https://api.webfortune.app",
        version: "v1.5.0",
        attempts: 1,
        intervalMs: 0,
        fetchImpl: () => {
          throw new Error("should not fetch");
        },
      }),
    /without the leading v/,
  );
});

test("polls a live server until /health reports the release", async () => {
  let hits = 0;
  const server = createServer((request, response) => {
    assert.equal(request.url, "/health");
    hits += 1;
    response.setHeader("content-type", "application/json; charset=utf-8");
    if (hits < 3) {
      response.end('{"status":"ok"}\n');
      return;
    }
    response.end('{"status":"ok","version":"1.6.0"}\n');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const written = [];
  try {
    await waitForRelease({
      apiUrl: `http://127.0.0.1:${port}`,
      version: "1.6.0",
      attempts: 5,
      intervalMs: 10,
      log: () => {},
      write: (body) => {
        written.push(body);
      },
    });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
  assert.equal(hits, 3);
  assert.deepEqual(written, ['{"status":"ok","version":"1.6.0"}\n']);
});
