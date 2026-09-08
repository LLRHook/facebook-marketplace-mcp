import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import type { BrowserContext } from "playwright";
import { isMainModule, runFacebookLogin } from "../src/facebook/login.js";

test("entry point detection handles native Windows paths, spaces, and URL encoding", () => {
  const entry = path.resolve("folder with spaces", "login #1.ts");
  assert.equal(isMainModule(pathToFileURL(entry).href, entry), true);
  assert.equal(isMainModule(pathToFileURL(entry).href, path.resolve("different.ts")), false);
});

test("the real compiled CLI prints help from a path containing spaces and a hash", t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "fb-login-cli-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const copy = path.join(temp, "project with spaces #1");
  fs.mkdirSync(copy);
  fs.cpSync(path.resolve("dist"), path.join(copy, "dist"), { recursive: true });
  fs.writeFileSync(path.join(copy, "package.json"), '{"type":"module"}');
  fs.symlinkSync(path.resolve("node_modules"), path.join(copy, "node_modules"), process.platform === "win32" ? "junction" : "dir");
  const result = execFileSync(process.execPath, [path.join(copy, "dist/facebook/login.js"), "--help"], { encoding: "utf8", cwd: os.tmpdir() });
  assert.match(result, /Usage: npm run login/);
  assert.match(result, /FACEBOOK_SESSION_FILE/);
});

test("login respects FACEBOOK_SESSION_FILE, filters unrelated cookies, and closes its browser", async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "fb-login-test-"));
  const file = path.join(temp, "custom path", "session.json");
  const original = process.env.FACEBOOK_SESSION_FILE;
  process.env.FACEBOOK_SESSION_FILE = file;
  t.after(() => {
    if (original === undefined) delete process.env.FACEBOOK_SESSION_FILE;
    else process.env.FACEBOOK_SESSION_FILE = original;
    fs.rmSync(temp, { recursive: true, force: true });
  });
  let closed = false;
  const page = { goto: async () => {}, url: () => "https://www.facebook.com/marketplace/", evaluate: async () => "Mozilla/5.0 (Windows NT 10.0) Chrome/150.0.0.0" };
  const context = {
    on: () => {}, pages: () => [page],
    cookies: async () => ["c_user", "xs"].map(name => ({ name, value: "fixture-only", domain: ".facebook.com", path: "/", expires: -1, secure: true, httpOnly: true })),
    close: async () => { closed = true; },
  } as unknown as BrowserContext;
  assert.equal(await runFacebookLogin({ launch: async () => context, log: () => {} }), file);
  assert.equal(closed, true);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).cookies.length, 2);
});

test("an unfinished login closes the browser without saving a session", async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "fb-login-timeout-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const file = path.join(temp, "session.json");
  let closed = false;
  const context = {
    on: () => {}, pages: () => [{ goto: async () => {} }],
    close: async () => { closed = true; },
  } as unknown as BrowserContext;
  await assert.rejects(runFacebookLogin({ sessionFile: file, timeoutMs: 0, launch: async () => context, log: () => {} }), /timed out/);
  assert.equal(closed, true);
  assert.equal(fs.existsSync(file), false);
});

test("login survives a navigation replacing the page execution context", async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "fb-login-navigation-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  let evaluations = 0;
  let closed = false;
  const page = {
    goto: async () => {}, url: () => "https://www.facebook.com/marketplace/",
    evaluate: async () => {
      if (++evaluations === 1) throw new Error("Execution context was destroyed, most likely because of a navigation");
      return "Mozilla/5.0 Chrome/150.0.0.0";
    },
  };
  const context = {
    on: () => {}, pages: () => [page],
    cookies: async () => ["c_user", "xs"].map(name => ({ name, value: "fixture-only", domain: ".facebook.com", path: "/", expires: -1, secure: true, httpOnly: true })),
    close: async () => { closed = true; },
  } as unknown as BrowserContext;
  const file = path.join(temp, "session.json");
  assert.equal(await runFacebookLogin({ sessionFile: file, launch: async () => context, log: () => {} }), file);
  assert.equal(evaluations, 2);
  assert.equal(closed, true);
});
