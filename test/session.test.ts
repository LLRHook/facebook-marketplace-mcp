import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getSessionFile, getLoginProfile, loadFacebookAuth, saveFacebookSession, validateSession, type SavedFacebookSession } from "../src/facebook/session.js";

function fixture(): SavedFacebookSession {
  return { version: 1, userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/150.0.0.0", cookies: ["c_user", "xs"].map(name => ({ domain: ".facebook.com", name, value: "fixture-only", path: "/", expires: -1, secure: true, httpOnly: true })) };
}

test("session and profile paths use stable home defaults and support spaces in overrides", () => {
  assert.equal(getSessionFile({}), path.join(os.homedir(), ".fb-marketplace", "session.json"));
  assert.equal(getLoginProfile({}), path.join(os.homedir(), ".fb-marketplace", "browser-profile"));
  assert.equal(getSessionFile({ FACEBOOK_SESSION_FILE: "folder with spaces/session.json" }), path.resolve("folder with spaces/session.json"));
  assert.equal(getLoginProfile({ FACEBOOK_LOGIN_PROFILE: "folder with spaces/browser" }), path.resolve("folder with spaces/browser"));
});

test("Windows loads a saved session without accessing Chrome or Keychain", async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "fb-session-test-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const file = path.join(temp, "folder with spaces", "session.json");
  saveFacebookSession(file, fixture());
  const result = await loadFacebookAuth({ sessionFile: file, platform: "win32" });
  assert.equal(result.cookies.length, 2);
  assert.equal(result.cookies[0].host, ".facebook.com");
  assert.equal(result.userAgent, fixture().userAgent);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ["session.json"]);
});

test("missing Windows session gives a login instruction", async () => {
  await assert.rejects(loadFacebookAuth({ sessionFile: path.join(os.tmpdir(), `nonexistent-${crypto.randomUUID()}.json`), platform: "win32" }), /npm run login/);
});

test("corrupt JSON does not disclose its contents", async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "fb-corrupt-session-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const file = path.join(temp, "session.json");
  fs.writeFileSync(file, '{"secret":"fixture-private",invalid');
  await assert.rejects(loadFacebookAuth({ sessionFile: file }), error => error instanceof Error && /Invalid Facebook session JSON/.test(error.message) && !error.message.includes("fixture-private"));
});

test("session validation rejects missing and expired login cookies", () => {
  const data = fixture();
  assert.throws(() => validateSession({ ...data, cookies: data.cookies.slice(0, 1) }), /login is missing/);
  assert.throws(() => validateSession({ ...data, cookies: data.cookies.map(cookie => ({ ...cookie, expires: 1 })) }), /login is missing/);
});

test("session validation filters foreign domains, subdomain-only cookies, and header injection", () => {
  const data = fixture();
  const extra = data.cookies[0];
  data.cookies.push({ ...extra, domain: "evilfacebook.com", name: "foreign" }, { ...extra, domain: "facebook.com.evil.test", name: "foreign2" }, { ...extra, domain: "business.facebook.com", name: "subdomain" }, { ...extra, name: "injected", value: "value; other=secret" }, { ...extra, name: "newline", value: "value\r\nsecret" });
  assert.deepEqual(validateSession(data).cookies.map(cookie => cookie.name), ["c_user", "xs"]);
  assert.throws(() => validateSession({ ...data, userAgent: "Mozilla\r\nCookie: injected" }), /Invalid Facebook session/);
});

test("an invalid replacement preserves the existing session", t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "fb-preserve-session-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const file = path.join(temp, "session.json");
  saveFacebookSession(file, fixture());
  const original = fs.readFileSync(file, "utf8");
  assert.throws(() => saveFacebookSession(file, { ...fixture(), cookies: [] }), /login is missing/);
  assert.equal(fs.readFileSync(file, "utf8"), original);
});
