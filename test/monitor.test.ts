import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Load storage only after isolating os.homedir(), just as the MCP smoke test does.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "fb-monitor-test-"));
const originalHome = process.env.HOME;
const originalProfile = process.env.USERPROFILE;
process.env.HOME = directory;
process.env.USERPROFILE = directory;
const storage = await import("../src/storage/monitors.js");
const tools = await import("../src/tools/monitor.js");
const file = path.join(directory, ".fb-marketplace", "monitors.json");
const params = { query: "desk", latitude: 40, longitude: -74, radiusKm: 50, limit: 24 };
beforeEach(() => { fs.rmSync(file, { force: true }); });
after(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = originalProfile;
  fs.rmSync(directory, { recursive: true, force: true });
});

test("invalid monitor inputs fail without writing monitor storage", async () => {
  const create = tools.createMonitorSearchHandler();
  for (const fields of [{ name: " " }, { query: " " }, { latitude: 91 }, { longitude: -181 },
    { radius_km: -1 }, { min_price: 5, max_price: 1 }]) {
    const result = await create({ name: "invalid", ...params, radius_km: 50, ...fields });
    assert.equal(result.isError, true, JSON.stringify(fields));
    assert.equal(fs.existsSync(file), false, "Invalid input must not persist a monitor");
  }
});

test("monitor creation normalizes names and phrases and applies the default radius", async () => {
  const result = await tools.createMonitorSearchHandler()({
    name: "  desk alerts  ", query: "  desk  ", latitude: 40, longitude: -74,
  });
  assert.notEqual(result.isError, true);
  const saved = storage.getMonitor("desk alerts");
  assert.equal(saved?.params.query, "desk");
  assert.equal(saved?.params.radiusKm, 50);
  const duplicate = await tools.createMonitorSearchHandler()({
    name: " desk alerts ", query: "desk", latitude: 40, longitude: -74,
  });
  assert.equal(duplicate.isError, true);
  assert.equal(storage.loadMonitors().length, 1);
});

test("a blank monitor name cannot accidentally check all saved searches", async () => {
  storage.addMonitor("existing", params);
  let calls = 0;
  const result = await tools.createCheckMonitorsHandler({ searchListings: async () => {
    calls++;
    return { listings: [], hasNextPage: false, endCursor: null };
  } })({ monitor_name: " " });
  assert.equal(result.isError, true);
  assert.equal(calls, 0);
  const deleted = await tools.createDeleteMonitorHandler()({ name: " " });
  assert.equal(deleted.isError, true);
  assert.equal(storage.loadMonitors().length, 1);
});

test("corrupt or malformed monitor files are reported and never overwritten", async () => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (const contents of ["{synthetic-private-data", "null", "{}", "[null]", '[{"name":"broken"}]']) {
    fs.writeFileSync(file, contents);
    assert.throws(() => storage.loadMonitors(), error => {
      assert.match(String(error), /monitor/i);
      assert.doesNotMatch(String(error), /synthetic-private-data/);
      return true;
    });
    assert.throws(() => storage.addMonitor("new", params));
    assert.equal(fs.readFileSync(file, "utf8"), contents);
    const listed = await tools.createListMonitorsHandler()();
    assert.equal(listed.isError, true);
    const deleted = await tools.createDeleteMonitorHandler()({ name: "new" });
    assert.equal(deleted.isError, true);
    assert.equal(fs.readFileSync(file, "utf8"), contents);
  }
  fs.rmSync(file);
});

test("valid monitor state survives saves and duplicate listing IDs are retained once", () => {
  const created = storage.addMonitor("valid", params);
  assert.equal(storage.loadMonitors()[0].id, created.id);
  storage.updateMonitorSeenIds("valid", ["123", "123", "456"]);
  assert.deepEqual(storage.getMonitor("valid")?.seenIds, ["123", "456"]);
  assert.ok(storage.getMonitor("valid")?.lastChecked);
  assert.equal(storage.deleteMonitor("valid"), true);
  assert.deepEqual(storage.loadMonitors(), []);
});

test("a failed atomic save leaves the previous monitor file intact", context => {
  storage.addMonitor("keep", params);
  const before = fs.readFileSync(file, "utf8");
  context.mock.method(fs, "renameSync", () => { throw new Error("Synthetic rename failure"); });
  assert.throws(() => storage.addMonitor("not-saved", params), /Synthetic rename failure/);
  assert.equal(fs.readFileSync(file, "utf8"), before);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ["monitors.json"]);
  context.mock.restoreAll();
  storage.deleteMonitor("keep");
});

test("a failing monitor does not discard results from other successfully checked monitors", async () => {
  storage.addMonitor("successful", params);
  storage.addMonitor("failing", { ...params, query: "chair" });
  storage.addMonitor("after-failure", { ...params, query: "table" });
  const checked: string[] = [];
  const check = tools.createCheckMonitorsHandler({ searchListings: async request => {
    checked.push(request.query);
    if (request.query === "chair") throw new Error("Synthetic query failure");
    const row = { id: request.query, title: `Fixture ${request.query}`, price: "$20", location: "Town",
      imageUrl: "", sellerName: "Seller", postedDate: "", url: "https://example.com/listing", isPending: false };
    return { listings: [row, row], hasNextPage: false, endCursor: null };
  } });
  const result = await check({});
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Fixture desk/);
  assert.match(result.content[0].text, /Synthetic query failure/);
  assert.match(result.content[0].text, /Fixture table/);
  assert.match(result.content[0].text, /1 listing\(s\) new/);
  assert.doesNotMatch(result.content[0].text, /2 listing\(s\) new/);
  assert.deepEqual(checked, ["desk", "chair", "table"]);
  assert.deepEqual(storage.getMonitor("successful")?.seenIds, ["desk"]);
  assert.equal(storage.getMonitor("failing")?.lastChecked, null);
  assert.deepEqual(storage.getMonitor("after-failure")?.seenIds, ["table"]);
  for (const name of ["successful", "failing", "after-failure"]) storage.deleteMonitor(name);
});
