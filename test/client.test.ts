import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FacebookClient } from "../src/facebook/client.js";
import { saveFacebookSession } from "../src/facebook/session.js";
import { buildSearchVariables } from "../src/facebook/queries.js";

const params = { query: "desk", latitude: 40, longitude: -74, radiusKm: 50, limit: 1 };
const listingResponse = { data: { marketplace_search: { feed_units: {
  edges: [{ node: { listing: { id: "123", marketplace_listing_title: "Desk" } } }],
  page_info: { has_next_page: false },
} } } };

function preparedClient(timeout = 30_000): FacebookClient {
  const client = new FacebookClient({ requestTimeoutMs: timeout });
  Object.assign(client, {
    session: { cookies: [], cookieHeader: "xs=synthetic-private-cookie",
      userId: "fixture", fbDtsg: "synthetic-private-token", lsd: "fixture",
      jazoest: "", clientRevision: "1" },
    rateLimiter: { wait: async () => undefined },
  });
  return client;
}

async function mockResponse(body: unknown, run: (client: FacebookClient) => Promise<void>, status = 200) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    typeof body === "string" ? body : JSON.stringify(body), { status });
  try { await run(preparedClient()); }
  finally { globalThis.fetch = original; }
}

test("HTTP 200 GraphQL errors are explicit and never expose response secrets", async () => {
  for (const body of [
    { errors: [{ message: "synthetic-private-token" }] },
    { error: 1357001, errorDescription: "synthetic-private-cookie" },
    { data: listingResponse.data, errors: [{ message: "partial failure" }] },
  ]) {
    await mockResponse(body, async client => {
      await assert.rejects(client.searchListings(params), error => {
        assert.match(String(error), /GraphQL errors/);
        assert.doesNotMatch(String(error), /synthetic-private/);
        return true;
      });
    });
  }
});

test("malformed GraphQL bodies and unfamiliar response shapes cannot appear empty", async () => {
  for (const body of [
    '<html>synthetic-private-cookie{"data":{}}</html>',
    "[]", "null", { data: {} }, { unexpected: [] },
  ]) {
    await mockResponse(body, async client => {
      await assert.rejects(client.searchListings(params), error => {
        assert.doesNotMatch(String(error), /synthetic-private/);
        return true;
      });
    });
  }
});

test("the known anti-JSONP prefix parses without stripping arbitrary content", async () => {
  await mockResponse("for (;;);" + JSON.stringify(listingResponse), async client => {
    assert.equal((await client.searchListings(params)).listings[0].title, "Desk");
  });
});

test("location and listing tools reject invalid successful HTTP responses", async () => {
  await mockResponse({ data: {} }, async client => {
    await assert.rejects(client.searchLocation("New York"), /unrecognized format/);
  });
  await mockResponse('<html><form action="/login/"></form></html>', async client => {
    await assert.rejects(client.getListingDetail("123"), /requested listing was not found/);
  });
});

test("HTTP authorization errors clear the cached session", async () => {
  await mockResponse("synthetic-private-token", async client => {
    await assert.rejects(client.searchListings(params), /Session expired or access blocked/);
    assert.equal((client as any).session, null);
  }, 403);
});

test("request deadlines and transport failures return sanitized errors", async () => {
  const original = globalThis.fetch;
  let observedSignal: AbortSignal | null | undefined;
  globalThis.fetch = async (_url, options) => {
    observedSignal = options?.signal;
    throw new Error("synthetic-private-cookie");
  };
  try {
    await assert.rejects(preparedClient(1000).searchListings(params), error => {
      assert.match(String(error), /failed or timed out/);
      assert.doesNotMatch(String(error), /synthetic-private/);
      return true;
    });
    assert.ok(observedSignal instanceof AbortSignal);
  } finally { globalThis.fetch = original; }
});

test("a stalled request is aborted when its deadline expires", async () => {
  const original = globalThis.fetch;
  // AbortSignal timers are unref'ed; keep the test process alive until the assertion settles.
  const keepAlive = setTimeout(() => undefined, 1000);
  globalThis.fetch = async (_url, options) => new Promise<Response>((_resolve, reject) => {
    const signal = options!.signal!;
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
  try {
    await assert.rejects(preparedClient(10).searchListings(params), /failed or timed out/);
  } finally {
    clearTimeout(keepAlive);
    globalThis.fetch = original;
  }
});

test("an abort during body download also produces a sanitized error", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    text: async () => { throw new Error("synthetic-private-token"); },
  }) as Response;
  try {
    await assert.rejects(preparedClient().searchListings(params), /failed or timed out/);
  } finally { globalThis.fetch = original; }
});

test("saved sessions supply the user agent during bootstrap and GraphQL calls", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "fb-client-test-"));
  const sessionFile = path.join(directory, "session.json");
  saveFacebookSession(sessionFile, {
    version: 1, userAgent: "FixtureWindowsChrome/150.0",
    cookies: ["c_user", "xs"].map(name => ({ name, value: "fixture",
      domain: ".facebook.com", path: "/", expires: -1, secure: true, httpOnly: true })),
  });
  const oldSessionFile = process.env.FACEBOOK_SESSION_FILE;
  const original = globalThis.fetch;
  process.env.FACEBOOK_SESSION_FILE = sessionFile;
  const observed: Headers[] = [];
  globalThis.fetch = async (_url, options) => {
    observed.push(new Headers(options?.headers));
    return new Response(observed.length === 1
      ? '["DTSGInitData",[],{"token":"fixture"}]'
      : JSON.stringify(listingResponse), { status: 200 });
  };
  try {
    const client = new FacebookClient();
    Object.assign(client, { rateLimiter: { wait: async () => undefined } });
    assert.equal((await client.searchListings(params)).listings.length, 1);
    assert.equal(observed.length, 2);
    for (const headers of observed) {
      assert.equal(headers.get("User-Agent"), "FixtureWindowsChrome/150.0");
      assert.equal(headers.has("sec-ch-ua-platform"), false);
      assert.equal(headers.has("sec-ch-ua"), false);
    }
  } finally {
    globalThis.fetch = original;
    if (oldSessionFile === undefined) delete process.env.FACEBOOK_SESSION_FILE;
    else process.env.FACEBOOK_SESSION_FILE = oldSessionFile;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("request variables retain free-only searches and the refreshed category shape", () => {
  const variables = buildSearchVariables({ ...params, maxPrice: 0, category: "furniture" }) as any;
  assert.equal(variables.params.browse_request_params.filter_price_upper_bound, 0);
  assert.deepEqual(variables.params.browse_request_params.commerce_search_and_rp_category_id, ["furniture"]);
  assert.equal(variables.scale, 2);
  assert.equal("cursor" in variables, false);
});
