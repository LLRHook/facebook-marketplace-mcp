import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { launchFacebookBrowser } from '../dist/facebook/browser.js';
import { saveFacebookSession, loadFacebookAuth } from '../dist/facebook/session.js';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-browser-smoke-'));
const profile = path.join(temporary, 'profile with spaces');
const sessionFile = path.join(temporary, 'session with spaces.json');
let browser;
try {
  browser = await launchFacebookBrowser({ profile, headless: true });
  const page = browser.pages()[0];
  await page.goto('data:text/html,<title>Windows browser smoke</title>');
  assert.equal(await page.title(), 'Windows browser smoke');
  const userAgent = await page.evaluate(() => navigator.userAgent);
  // Fixture cookies stay in the temporary browser profile; Facebook is never contacted.
  await browser.addCookies(['c_user', 'xs'].map(name => ({ name, value: 'fixture-only', domain: '.facebook.com', path: '/', expires: Math.floor(Date.now() / 1000) + 3600, httpOnly: true, secure: true, sameSite: 'Lax' })));
  saveFacebookSession(sessionFile, { version: 1, cookies: await browser.cookies('https://www.facebook.com/'), userAgent });
  await browser.close();
  browser = await launchFacebookBrowser({ profile, headless: true });
  assert.equal((await browser.cookies('https://www.facebook.com/')).length, 2);
  const auth = await loadFacebookAuth({ sessionFile });
  assert.equal(auth.cookies.length, 2);
  assert.equal(auth.userAgent, userAgent);
  console.log(`PASS: real browser launch, profile persistence and session round-trip (${process.platform}, ${process.version}). No Facebook requests made.`);
} finally {
  await browser?.close();
  const resolved = fs.realpathSync(temporary);
  if (path.dirname(resolved).toLowerCase() !== fs.realpathSync(os.tmpdir()).toLowerCase() || !path.basename(resolved).startsWith('fb-browser-smoke-')) throw new Error('Unexpected temporary cleanup path');
  fs.rmSync(resolved, { recursive: true, force: true });
}
